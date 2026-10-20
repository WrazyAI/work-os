/**
 * One recap read at a time, in one place.
 *
 * The companion's floating window owns exactly one audio element: the tray menu,
 * the expand/collapse of the panel, the recorder, and the Listen controls all
 * route through here, so two readings can never overlap and a recording can
 * never start on top of one (the design's "one audio owner" rule).
 *
 * The machine is separated from React so the interesting behaviour — the clock
 * driving the prompter, stopping cleanly, retrying a failure — is tested with a
 * fake audio element instead of a browser.
 */

import { activeLineIndex, lineWeights, type RecapSpeechLine } from "./recapSpeech";

export type RecapSpeechStatus = "idle" | "loading" | "playing" | "finished";

export interface RecapSpeechSnapshot {
  status: RecapSpeechStatus;
  /** The words being spoken; empty while idle. */
  lines: RecapSpeechLine[];
  /** 0–1 of the clip's own duration. */
  progress: number;
  activeIndex: number;
  /** The revision the current clip speaks, or null. */
  revision: number | null;
  /** The recap this read belongs to, or null. */
  intervalId: string | null;
}

export interface RecapAudio {
  play(): Promise<void>;
  pause(): void;
  /** Point the same element at new audio, keeping playback permission. */
  setSource(src: string): void;
  currentTime: number;
  readonly duration: number;
  addEventListener(type: "timeupdate" | "ended" | "error", handler: () => void): void;
  removeEventListener?(type: "timeupdate" | "ended" | "error", handler: () => void): void;
}

export interface RecapSpeechPlayerDeps {
  fetchClip: (input: { intervalId: string; revision: number | null; voice: string }) => Promise<{
    bytes: ArrayBuffer;
    mimeType: string;
    lines: RecapSpeechLine[];
    revision: number | null;
    stale: boolean;
  }>;
  toObjectUrl: (bytes: ArrayBuffer, mimeType: string) => string;
  releaseObjectUrl: (url: string) => void;
  createAudio: (src: string) => RecapAudio;
  onSnapshot: (snapshot: RecapSpeechSnapshot) => void;
  /** A bounded, employee-facing reason; the caller shows it and stops. */
  onFailure: (message: string) => void;
  /** The card moved on since it was rendered, so refresh it before playing. */
  onStaleCard: (intervalId: string) => void;
}

export interface RecapSpeechPlayer {
  snapshot(): RecapSpeechSnapshot;
  toggle(input: { intervalId: string | null; revision: number | null; voice: string; enabled: boolean }): Promise<void>;
  stop(): void;
  dispose(): void;
}

const IDLE: RecapSpeechSnapshot = { status: "idle", lines: [], progress: 0, activeIndex: 0, revision: null, intervalId: null };

/** The real browser element behind `RecapAudio`. */
export function browserRecapAudio(src: string): RecapAudio {
  const element = new Audio(src);
  return {
    play: () => element.play(),
    pause: () => element.pause(),
    setSource(next) {
      element.src = next;
      element.load();
    },
    get currentTime() { return element.currentTime; },
    get duration() { return element.duration; },
    addEventListener: (type, handler) => element.addEventListener(type, handler),
    removeEventListener: (type, handler) => element.removeEventListener(type, handler),
  };
}

/** A quarter second of silence, as a valid PCM WAV. */
function silentWav(): ArrayBuffer {
  const sampleRate = 8000;
  const samples = Math.floor(sampleRate / 4);
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples * 2, true);
  // The sample bytes stay zero: silence.
  return buffer;
}

export function createRecapSpeechPlayer(deps: RecapSpeechPlayerDeps): RecapSpeechPlayer {
  let snapshot: RecapSpeechSnapshot = IDLE;
  let weights: number[] = [];
  let audio: RecapAudio | null = null;
  let objectUrl: string | null = null;
  let primeUrl: string | null = null;
  /** Guards a slow clip arriving after the read was stopped. */
  let token = 0;

  const publish = (next: Partial<RecapSpeechSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    deps.onSnapshot(snapshot);
  };

  const release = () => {
    if (audio) {
      audio.pause();
      audio = null;
    }
    if (objectUrl) {
      deps.releaseObjectUrl(objectUrl);
      objectUrl = null;
    }
    if (primeUrl) {
      deps.releaseObjectUrl(primeUrl);
      primeUrl = null;
    }
  };

  /** Start a silent clip inside the press.
   *
   * A clip takes seconds to synthesize, and a webview only honours a gesture
   * for a few seconds: by the time the audio arrives, `play()` is refused and
   * the read is silent. Playing a silent source on the element that will carry
   * the clip marks that element as allowed, so the real `play()` succeeds. */
  const prime = () => {
    try {
      primeUrl = deps.toObjectUrl(silentWav(), "audio/wav");
      audio = deps.createAudio(primeUrl);
      void audio.play().catch(() => { /* best effort: the clip still tries */ });
    } catch {
      /* Priming is an optimisation; the real play reports its own failure. */
    }
  };

  const stop = () => {
    token += 1;
    weights = [];
    release();
    // Already at rest: nothing to publish (a press on an idle control must not
    // re-render the window).
    if (snapshot.status === "idle" && !snapshot.lines.length && snapshot.intervalId === null) return;
    publish({ ...IDLE });
  };

  const onTick = () => {
    if (!audio || snapshot.status !== "playing") return;
    const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    const progress = duration ? Math.min(1, Math.max(0, audio.currentTime / duration)) : 0;
    publish({ progress, activeIndex: activeLineIndex(progress, weights) });
  };

  const start = async (input: { intervalId: string; revision: number | null; voice: string }) => {
    const mine = (token += 1);
    publish({ status: "loading", lines: [], progress: 0, activeIndex: 0, revision: input.revision, intervalId: input.intervalId });
    // Before the await: this is still the press.
    prime();
    let clip: Awaited<ReturnType<RecapSpeechPlayerDeps["fetchClip"]>>;
    try {
      clip = await deps.fetchClip(input);
    } catch (error) {
      if (mine !== token) return;
      // A failed request still owns the primed element: stop it and free both
      // sources, so a retry starts clean.
      release();
      publish({ ...IDLE, intervalId: input.intervalId });
      deps.onFailure(error instanceof Error && error.message ? error.message : "Reading a recap is unavailable right now. Try again in a moment.");
      return;
    }
    if (mine !== token) return;
    if (clip.stale) deps.onStaleCard(input.intervalId);
    weights = lineWeights(clip.lines);
    // Hand the clip to the element that was primed in the press; if priming
    // failed there is no element yet, so make one.
    const element = audio ?? deps.createAudio("");
    element.pause();
    if (primeUrl) {
      deps.releaseObjectUrl(primeUrl);
      primeUrl = null;
    }
    objectUrl = deps.toObjectUrl(clip.bytes, clip.mimeType);
    element.setSource(objectUrl);
    audio = element;
    element.addEventListener("timeupdate", onTick);
    element.addEventListener("ended", () => {
      if (mine !== token) return;
      // The read is over, so the words stay on screen and the bubble asks for
      // the decision the employee pressed Listen to make — confirming a recap
      // without opening anything else. The audio is released immediately; only
      // the words remain.
      weights = [];
      release();
      publish({ status: "finished", progress: 1, activeIndex: Math.max(0, clip.lines.length - 1), lines: clip.lines, revision: clip.revision, intervalId: input.intervalId });
    });
    element.addEventListener("error", () => {
      if (mine !== token) return;
      release();
      publish({ ...IDLE, intervalId: input.intervalId });
      deps.onFailure("Reading a recap is unavailable right now. Try again in a moment.");
    });
    publish({ status: "playing", lines: clip.lines, revision: clip.revision, intervalId: input.intervalId, progress: 0, activeIndex: 0 });
    try {
      await element.play();
    } catch {
      if (mine !== token) return;
      release();
      publish({ ...IDLE, intervalId: input.intervalId });
      deps.onFailure("Your device blocked the audio. Press Listen again to play this recap.");
    }
  };

  return {
    snapshot: () => snapshot,
    async toggle(input) {
      const isThisRecap = snapshot.intervalId !== null && snapshot.intervalId === input.intervalId;
      if (snapshot.status !== "idle" && isThisRecap) {
        stop();
        return;
      }
      if (!input.intervalId) {
        deps.onFailure("That recap is no longer available.");
        return;
      }
      if (!input.enabled) {
        deps.onFailure("Reading recaps aloud is turned off for this workspace.");
        return;
      }
      stop();
      await start({ intervalId: input.intervalId, revision: input.revision, voice: input.voice });
    },
    stop,
    dispose() {
      stop();
    },
  };
}
