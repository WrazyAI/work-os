/**
 * One recap read at a time, in one place.
 *
 * The companion's floating window owns exactly one audio player: the tray menu,
 * the expand/collapse of the panel, the recorder, and the Listen controls all
 * route through here, so two readings can never overlap and a recording can
 * never start on top of one (the design's "one audio owner" rule).
 *
 * The clock and the clip's bytes go through `RecapAudio`, which the browser
 * implements with Web Audio. That matters: synthesis can take longer than a
 * webview honours a press, and a media element refuses to start after that. An
 * audio context opened during the press stays usable, so the clip plays however
 * long it took to arrive.
 *
 * The machine is separated from React so the interesting behaviour — the clock
 * driving the prompter, stopping cleanly, retrying a failure — is tested with a
 * fake player instead of a browser.
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
  /** True once the wait has passed the usual generation window. */
  slow: boolean;
  /** The recap whose last read was cancelled or failed, if any. */
  retryIntervalId: string | null;
}

export interface RecapAudio {
  /** Decode the clip; resolves when it is ready to play. */
  load(bytes: ArrayBuffer, mimeType: string): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  /** Release the audio context. Called once, when the player is disposed. */
  close?(): void;
  currentTime: number;
  readonly duration: number;
  addEventListener(type: "timeupdate" | "ended" | "error", handler: () => void): void;
  /** Reusable adapters must be able to drop a finished read's listeners. */
  removeEventListener(type: "timeupdate" | "ended" | "error", handler: () => void): void;
}

export interface RecapSpeechPlayerDeps {
  fetchClip: (input: { intervalId: string; revision: number | null; voice: string }) => Promise<{
    bytes: ArrayBuffer;
    mimeType: string;
    lines: RecapSpeechLine[];
    revision: number | null;
    stale: boolean;
  }>;
  createAudio: () => RecapAudio;
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

export const IDLE_RECAP_SPEECH: RecapSpeechSnapshot = { status: "idle", lines: [], progress: 0, activeIndex: 0, revision: null, intervalId: null, slow: false, retryIntervalId: null };

/** How long a read is expected to take before the employee is told it is
 * taking longer. The provider budget stays well beyond this (the route allows
 * minutes, not seconds), so passing this line never cuts the work short — it
 * only changes what the bubble says and offers. */
export const RECAP_SLOW_AFTER_MS = 20_000;
const UNAVAILABLE = "Reading a recap is unavailable right now. Try again in a moment.";

/**
 * The browser player, on Web Audio.
 *
 * The context is created and resumed by `createAudio`, which the caller invokes
 * inside the press. Decoding and starting the clip happen later without asking
 * the browser for another gesture, which a media element would require — and
 * would refuse after a slow synthesis.
 */
export function browserRecapAudio(): RecapAudio {
  type ContextConstructor = new () => AudioContext;
  const Constructor = (window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: ContextConstructor }).webkitAudioContext) as ContextConstructor | undefined;
  if (!Constructor) throw new Error("Audio is not available in this window.");
  const context = new Constructor();
  void context.resume().catch(() => undefined);

  let buffer: AudioBuffer | null = null;
  let source: AudioBufferSourceNode | null = null;
  let startedAt = 0;
  let offset = 0;
  let playing = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  /** A load and a play can both be awaiting the browser. These tokens make a
   * superseded one return instead of committing a stale clip or starting a
   * source after Stop. */
  let loadGeneration = 0;
  let playGeneration = 0;
  const listeners = new Map<string, Array<() => void>>();
  const emit = (type: string) => {
    for (const handler of listeners.get(type) ?? []) handler();
  };
  const stopTimer = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
  const stopSource = () => {
    playing = false;
    stopTimer();
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
      source = null;
    }
  };
  const elapsed = () => (playing ? offset + (context.currentTime - startedAt) : offset);

  return {
    async load(bytes) {
      const attempt = (loadGeneration += 1);
      playGeneration += 1;
      // The adapter can be asked to load while the old clip still plays.
      // Silence it (and stop its clock) before resetting the position.
      stopSource();
      // A reused context keeps the previous clip's clock. The next read is a
      // different clip, so its position starts at zero even if the old one ran
      // to its end (a longer new clip would otherwise begin mid-sentence).
      offset = 0;
      const decoded = await context.decodeAudioData(bytes.slice(0));
      // A newer read started while this one decoded: its clip owns the context.
      if (attempt !== loadGeneration) return;
      buffer = decoded;
    },
    async play() {
      if (!buffer) throw new Error("The recap audio could not be decoded.");
      if (playing) return;
      const attempt = (playGeneration += 1);
      // One context serves every read; a context the browser suspended while
      // idle has to be resumed before the reused source starts.
      await context.resume().catch(() => undefined);
      // Stop, a new clip, or a close arrived while the context was resuming.
      if (attempt !== playGeneration) return;
      if (offset >= buffer.duration) offset = 0;
      source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => {
        if (!playing) return;
        playing = false;
        offset = buffer ? buffer.duration : 0;
        stopTimer();
        emit("ended");
      };
      source.start(0, offset);
      startedAt = context.currentTime;
      playing = true;
      stopTimer();
      // The element's `timeupdate` becomes a quiet poll of the context's clock.
      timer = setInterval(() => {
        if (playing) emit("timeupdate");
      }, 100);
    },
    pause() {
      playGeneration += 1;
      if (!playing) return;
      const at = elapsed();
      offset = Math.min(buffer?.duration ?? 0, Math.max(0, at));
      stopSource();
    },
    get currentTime() {
      return Math.min(buffer?.duration ?? 0, Math.max(0, elapsed()));
    },
    get duration() {
      return buffer?.duration ?? 0;
    },
    addEventListener(type, handler) {
      listeners.set(type, [...(listeners.get(type) ?? []), handler]);
    },
    removeEventListener(type, handler) {
      listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry !== handler));
    },
    close() {
      playGeneration += 1;
      loadGeneration += 1;
      stopSource();
      void context.close().catch(() => undefined);
    },
  };
}

export function createRecapSpeechPlayer(deps: RecapSpeechPlayerDeps): RecapSpeechPlayer {
  let snapshot: RecapSpeechSnapshot = IDLE_RECAP_SPEECH;
  let weights: number[] = [];
  let audio: RecapAudio | null = null;
  /** The listeners this read registered on the shared adapter. A reused
   * adapter keeps its listeners unless the read that added them removes them,
   * and one clock tick would then publish once per completed read. */
  let detach: (() => void) | null = null;
  /** Guards a slow clip arriving after the read was stopped. */
  let token = 0;
  let slowTimer: ReturnType<typeof setTimeout> | null = null;
  const clearSlow = () => {
    if (slowTimer !== null) {
      clearTimeout(slowTimer);
      slowTimer = null;
    }
  };

  const publish = (next: Partial<RecapSpeechSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    deps.onSnapshot(snapshot);
  };

  const release = () => {
    clearSlow();
    detach?.();
    detach = null;
    // Keep the context for the next read. Browsers cap live contexts, and a
    // fresh one per press leaked one every time; the web player already keeps
    // a single context for the same reason.
    audio?.pause();
  };

  const stop = () => {
    // Cancelling a wait keeps the request in flight: the server finishes the
    // clip and caches it, so Try again is ready far sooner than a fresh call.
    const cancelledWait = snapshot.status === "loading" ? snapshot.intervalId : null;
    token += 1;
    weights = [];
    clearSlow();
    release();
    // Already at rest: nothing to publish (a press on an idle control must not
    // re-render the window).
    if (snapshot.status === "idle" && !snapshot.lines.length && snapshot.intervalId === null) return;
    publish({ ...IDLE_RECAP_SPEECH, retryIntervalId: cancelledWait });
  };

  const onTick = () => {
    if (!audio || snapshot.status !== "playing") return;
    const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    const progress = duration ? Math.min(1, Math.max(0, audio.currentTime / duration)) : 0;
    publish({ progress, activeIndex: activeLineIndex(progress, weights) });
  };

  const start = async (input: { intervalId: string; revision: number | null; voice: string }) => {
    const mine = (token += 1);
    publish({ status: "loading", lines: [], progress: 0, activeIndex: 0, revision: input.revision, intervalId: input.intervalId, slow: false, retryIntervalId: null });
    clearSlow();
    slowTimer = setTimeout(() => {
      if (mine === token && snapshot.status === "loading") publish({ slow: true });
    }, RECAP_SLOW_AFTER_MS);
    // Inside the press, on the first read: the player opens its audio context
    // here, so the clip can start later without the browser asking for another
    // gesture. Later reads reuse it instead of opening another one. A device
    // that cannot be opened fails here, not after a fetch we cannot play.
    let element = audio;
    if (!element) {
      try {
        element = deps.createAudio();
        audio = element;
      } catch {
        release();
        publish({ ...IDLE_RECAP_SPEECH, intervalId: input.intervalId, retryIntervalId: input.intervalId });
        deps.onFailure(UNAVAILABLE);
        return;
      }
    }
    let clip: Awaited<ReturnType<RecapSpeechPlayerDeps["fetchClip"]>>;
    try {
      clip = await deps.fetchClip(input);
    } catch (error) {
      if (mine !== token) return;
      release();
      publish({ ...IDLE_RECAP_SPEECH, intervalId: input.intervalId, retryIntervalId: input.intervalId });
      deps.onFailure(error instanceof Error && error.message ? error.message : UNAVAILABLE);
      return;
    }
    if (mine !== token) return;
    if (clip.stale) deps.onStaleCard(input.intervalId);
    weights = lineWeights(clip.lines);

    try {
      await element.load(clip.bytes, clip.mimeType);
    } catch {
      if (mine !== token) return;
      release();
      publish({ ...IDLE_RECAP_SPEECH, intervalId: input.intervalId, retryIntervalId: input.intervalId });
      deps.onFailure(UNAVAILABLE);
      return;
    }
    if (mine !== token) return;

    const onEnded = () => {
      if (mine !== token) return;
      // The read is over, so the words stay on screen and the bubble asks for
      // the decision the employee pressed Listen to make — confirming a recap
      // without opening anything else. The audio is released immediately; only
      // the words remain.
      weights = [];
      release();
      publish({ status: "finished", progress: 1, activeIndex: Math.max(0, clip.lines.length - 1), lines: clip.lines, revision: clip.revision, intervalId: input.intervalId });
    };
    const onError = () => {
      if (mine !== token) return;
      release();
      publish({ ...IDLE_RECAP_SPEECH, intervalId: input.intervalId, retryIntervalId: input.intervalId });
      deps.onFailure(UNAVAILABLE);
    };
    element.addEventListener("timeupdate", onTick);
    element.addEventListener("ended", onEnded);
    element.addEventListener("error", onError);
    detach = () => {
      element.removeEventListener("timeupdate", onTick);
      element.removeEventListener("ended", onEnded);
      element.removeEventListener("error", onError);
    };
    clearSlow();
    publish({ status: "playing", lines: clip.lines, revision: clip.revision, intervalId: input.intervalId, progress: 0, activeIndex: 0, slow: false });
    try {
      await element.play();
    } catch {
      if (mine !== token) return;
      release();
      publish({ ...IDLE_RECAP_SPEECH, intervalId: input.intervalId, retryIntervalId: input.intervalId });
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
      audio?.close?.();
      audio = null;
    },
  };
}
