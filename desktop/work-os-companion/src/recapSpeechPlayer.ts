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

export type RecapSpeechStatus = "idle" | "loading" | "playing";

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

export function createRecapSpeechPlayer(deps: RecapSpeechPlayerDeps): RecapSpeechPlayer {
  let snapshot: RecapSpeechSnapshot = IDLE;
  let weights: number[] = [];
  let audio: RecapAudio | null = null;
  let objectUrl: string | null = null;
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
    let clip: Awaited<ReturnType<RecapSpeechPlayerDeps["fetchClip"]>>;
    try {
      clip = await deps.fetchClip(input);
    } catch (error) {
      if (mine !== token) return;
      publish({ ...IDLE, intervalId: input.intervalId });
      deps.onFailure(error instanceof Error && error.message ? error.message : "Reading a recap is unavailable right now. Try again in a moment.");
      return;
    }
    if (mine !== token) return;
    if (clip.stale) deps.onStaleCard(input.intervalId);
    weights = lineWeights(clip.lines);
    release();
    objectUrl = deps.toObjectUrl(clip.bytes, clip.mimeType);
    audio = deps.createAudio(objectUrl);
    audio.addEventListener("timeupdate", onTick);
    audio.addEventListener("ended", () => {
      if (mine !== token) return;
      // The read is over: the bubble returns to its resting shape, and the next
      // press starts a fresh clip rather than resuming.
      stop();
    });
    audio.addEventListener("error", () => {
      if (mine !== token) return;
      release();
      publish({ ...IDLE, intervalId: input.intervalId });
      deps.onFailure("Reading a recap is unavailable right now. Try again in a moment.");
    });
    publish({ status: "playing", lines: clip.lines, revision: clip.revision, intervalId: input.intervalId, progress: 0, activeIndex: 0 });
    try {
      await audio.play();
    } catch {
      if (mine !== token) return;
      release();
      publish({ ...IDLE, intervalId: input.intervalId });
      deps.onFailure("Reading a recap is unavailable right now. Try again in a moment.");
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
      if (!input.enabled || !input.intervalId) return;
      stop();
      await start({ intervalId: input.intervalId, revision: input.revision, voice: input.voice });
    },
    stop,
    dispose() {
      stop();
    },
  };
}
