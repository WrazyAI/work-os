import { describe, expect, it, vi } from "vitest";
import type { RecapSpeechClip } from "./api";
import { RECAP_SLOW_AFTER_MS, createRecapSpeechPlayer, type RecapAudio, type RecapSpeechSnapshot } from "./recapSpeechPlayer";

function fakeAudio() {
  const listeners = new Map<string, Array<() => void>>();
  const audio: RecapAudio & {
    currentTime: number;
    fire(type: string): void;
    played: number;
    paused: number;
    closed: number;
    loads: Array<{ bytes: number; mimeType: string }>;
  } = {
    currentTime: 0,
    duration: 30,
    played: 0,
    paused: 0,
    closed: 0,
    loads: [],
    async load(bytes, mimeType) {
      audio.loads.push({ bytes: bytes.byteLength, mimeType });
    },
    async play() { audio.played += 1; },
    pause() { audio.paused += 1; },
    close() { audio.closed += 1; },
    addEventListener(type, handler) {
      listeners.set(type, [...(listeners.get(type) ?? []), handler]);
    },
    removeEventListener(type, handler) {
      listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry !== handler));
    },
    fire(type) {
      for (const handler of listeners.get(type) ?? []) handler();
    },
  };
  return audio;
}

function harness(overrides: Partial<Parameters<typeof createRecapSpeechPlayer>[0]> = {}) {
  const snapshots: RecapSpeechSnapshot[] = [];
  const failures: string[] = [];
  const stale: string[] = [];
  const audios: Array<ReturnType<typeof fakeAudio>> = [];
  const fetched: Array<{ intervalId: string; revision: number | null; reviewKey?: string | null; voice: string }> = [];
  let clip: RecapSpeechClip = {
    bytes: new ArrayBuffer(8),
    mimeType: "audio/wav",
    lines: [
      { text: "Software-development review across three repositories.", time: null },
      { text: "Reviewed the cursor-pagination code", time: "7:21 PM" },
      { text: "Read the blocker notes", time: null },
    ],
    revision: 4,
    stale: false,
  };
  const player = createRecapSpeechPlayer({
    fetchClip: async (input) => {
      fetched.push(input);
      return clip;
    },
    createAudio: () => {
      const audio = fakeAudio();
      audios.push(audio);
      return audio;
    },
    onSnapshot: (snapshot) => { snapshots.push(snapshot); },
    onFailure: (message) => { failures.push(message); },
    onStaleCard: (intervalId) => { stale.push(intervalId); },
    ...overrides,
  });
  return { player, snapshots, failures, stale, audios, fetched, setClip: (next: RecapSpeechClip) => { clip = next; } };
}

describe("recap speech player", () => {
  it("loads, plays, and follows the audio's own clock", async () => {
    const h = harness();
    await h.player.toggle({ intervalId: "interval-1", revision: 4, voice: "Kore", enabled: true });
    expect(h.snapshots.map((snapshot) => snapshot.status)).toEqual(["loading", "playing"]);
    expect(h.player.snapshot().lines).toHaveLength(3);
    expect(h.audios[0].loads).toEqual([{ bytes: 8, mimeType: "audio/wav" }]);
    expect(h.audios[0].played).toBe(1);
    h.audios[0].currentTime = 15;
    h.audios[0].fire("timeupdate");
    expect(h.player.snapshot().progress).toBeCloseTo(0.5, 5);
    expect(h.player.snapshot().activeIndex).toBeGreaterThan(0);
    h.audios[0].currentTime = 30;
    h.audios[0].fire("timeupdate");
    expect(h.player.snapshot().activeIndex).toBe(2);
  });

  it("stops on a second press of the same recap, and never overlaps itself", async () => {
    const h = harness();
    await h.player.toggle({ intervalId: "interval-1", revision: 4, voice: "Kore", enabled: true });
    await h.player.toggle({ intervalId: "interval-1", revision: 4, voice: "Kore", enabled: true });
    expect(h.player.snapshot().status).toBe("idle");
    expect(h.player.snapshot().lines).toEqual([]);
    expect(h.audios[0].paused).toBeGreaterThan(0);
    expect(h.audios).toHaveLength(1); // one player for the whole window
  });

  it("switching recaps replaces the read instead of stacking a second one", async () => {
    const h = harness();
    await h.player.toggle({ intervalId: "interval-1", revision: 1, voice: "Kore", enabled: true });
    await h.player.toggle({ intervalId: "interval-2", revision: 2, voice: "Kore", enabled: true });
    expect(h.player.snapshot().intervalId).toBe("interval-2");
    expect(h.player.snapshot().status).toBe("playing");
    expect(h.fetched.map((call) => call.intervalId)).toEqual(["interval-1", "interval-2"]);
  });

  it("explains a press it cannot serve instead of swallowing it", async () => {
    const h = harness();
    await h.player.toggle({ intervalId: "interval-1", revision: 1, voice: "Kore", enabled: false });
    await h.player.toggle({ intervalId: null, revision: null, voice: "Kore", enabled: true });
    expect(h.fetched).toHaveLength(0);
    expect(h.player.snapshot().status).toBe("idle");
    expect(h.failures).toEqual([
      "Reading recaps aloud is turned off for this workspace.",
      "That recap is no longer available.",
    ]);
  });

  it("opens the player inside the press, before the clip exists", async () => {
    let resolve: (clip: RecapSpeechClip) => void = () => undefined;
    const h = harness({ fetchClip: () => new Promise<RecapSpeechClip>((done) => { resolve = done; }) });
    const pending = h.player.toggle({ intervalId: "interval-1", revision: 1, voice: "Kore", enabled: true });
    // The player exists while the network is still working: a slow synthesis
    // cannot outlive the press and leave the clip unplayable.
    expect(h.audios).toHaveLength(1);
    expect(h.audios[0].loads).toHaveLength(0);
    expect(h.audios[0].played).toBe(0);
    resolve({ bytes: new ArrayBuffer(8), mimeType: "audio/wav", lines: [{ text: "Lead", time: null }], revision: 1, stale: false });
    await pending;
    expect(h.audios[0].loads).toHaveLength(1);
    expect(h.audios[0].played).toBe(1);
    expect(h.player.snapshot().status).toBe("playing");
  });

  it("says it is taking longer only after the usual window, and keeps the request alive", async () => {
    vi.useFakeTimers();
    try {
      let resolve: (clip: RecapSpeechClip) => void = () => undefined;
      const h = harness({ fetchClip: () => new Promise<RecapSpeechClip>((done) => { resolve = done; }) });
      const pending = h.player.toggle({ intervalId: "interval-1", revision: 1, voice: "Kore", enabled: true });
      expect(h.player.snapshot().slow).toBe(false);
      vi.advanceTimersByTime(RECAP_SLOW_AFTER_MS - 1);
      expect(h.player.snapshot().slow).toBe(false);
      vi.advanceTimersByTime(1);
      // Past the expected wait the bubble says so, but the request is still
      // wanted: the provider is never cut off at the hint.
      expect(h.player.snapshot().slow).toBe(true);
      expect(h.player.snapshot().status).toBe("loading");
      resolve({ bytes: new ArrayBuffer(8), mimeType: "audio/wav", lines: [{ text: "Lead", time: null }], revision: 1, stale: false });
      await pending;
      expect(h.player.snapshot().status).toBe("playing");
      expect(h.player.snapshot().slow).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancel leaves the synthesis running and marks the recap for another try", async () => {
    let resolve: (clip: RecapSpeechClip) => void = () => undefined;
    const h = harness({ fetchClip: () => new Promise<RecapSpeechClip>((done) => { resolve = done; }) });
    const pending = h.player.toggle({ intervalId: "interval-1", revision: 1, voice: "Kore", enabled: true });
    h.player.stop();
    expect(h.player.snapshot().status).toBe("idle");
    expect(h.player.snapshot().retryIntervalId).toBe("interval-1");
    // The request was not abandoned; its clip simply arrives too late to play.
    resolve({ bytes: new ArrayBuffer(8), mimeType: "audio/wav", lines: [{ text: "Lead", time: null }], revision: 1, stale: false });
    await pending;
    expect(h.audios.every((audio) => audio.played === 0)).toBe(true);
    // Trying again clears the marker for the length of the new attempt.
    void h.player.toggle({ intervalId: "interval-1", revision: 1, voice: "Kore", enabled: true });
    expect(h.player.snapshot().retryIntervalId).toBeNull();
  });

  it("stopping a read that is already playing is not a retry", async () => {
    const h = harness();
    await h.player.toggle({ intervalId: "interval-1", revision: 1, voice: "Kore", enabled: true });
    h.player.stop();
    expect(h.player.snapshot().retryIntervalId).toBeNull();
  });

  it("a failed read tells the employee, stays retryable, and leaves no audio playing", async () => {
    let fail = true;
    const h = harness({
      fetchClip: async () => {
        if (fail) throw Object.assign(new Error("Reading a recap is unavailable right now. Try again in a moment."), { name: "ApiRequestError" });
        return { bytes: new ArrayBuffer(8), mimeType: "audio/wav", lines: [{ text: "Lead", time: null }], revision: 1, stale: false };
      },
    });
    await h.player.toggle({ intervalId: "interval-1", revision: 1, voice: "Kore", enabled: true });
    expect(h.failures).toEqual(["Reading a recap is unavailable right now. Try again in a moment."]);
    expect(h.player.snapshot().status).toBe("idle");
    expect(h.player.snapshot().retryIntervalId).toBe("interval-1");
    expect(h.audios[0].paused).toBeGreaterThan(0);
    fail = false;
    await h.player.toggle({ intervalId: "interval-1", revision: 1, voice: "Kore", enabled: true });
    expect(h.player.snapshot().status).toBe("playing");
  });

  it("reports an audio device that cannot be opened instead of hanging in loading", async () => {
    const h = harness({ createAudio: () => { throw new Error("Audio is not available in this window."); } });
    await h.player.toggle({ intervalId: "interval-1", revision: 1, voice: "Kore", enabled: true });
    expect(h.player.snapshot().status).toBe("idle");
    expect(h.player.snapshot().retryIntervalId).toBe("interval-1");
    expect(h.failures).toEqual(["Reading a recap is unavailable right now. Try again in a moment."]);
  });

  it("a clip the device cannot decode says so instead of pretending to play", async () => {
    const h = harness({
      createAudio: () => {
        const audio = fakeAudio();
        audio.load = async () => { throw new Error("decode failed"); };
        return audio;
      },
    });
    await h.player.toggle({ intervalId: "interval-1", revision: 1, voice: "Kore", enabled: true });
    expect(h.player.snapshot().status).toBe("idle");
    expect(h.failures).toEqual(["Reading a recap is unavailable right now. Try again in a moment."]);
  });

  it("refreshes the card when the recap has moved on, before it plays", async () => {
    const h = harness();
    h.setClip({ bytes: new ArrayBuffer(8), mimeType: "audio/wav", lines: [{ text: "Newer words", time: null }], revision: 5, stale: true });
    await h.player.toggle({ intervalId: "interval-1", revision: 4, voice: "Kore", enabled: true });
    expect(h.stale).toEqual(["interval-1"]);
    expect(h.player.snapshot().lines).toEqual([{ text: "Newer words", time: null }]);
    expect(h.player.snapshot().revision).toBe(5);
  });

  it("removes a finished read's listeners before the same audio serves the next recap", async () => {
    const h = harness();
    await h.player.toggle({ intervalId: "interval-1", revision: 1, voice: "Kore", enabled: true });
    await h.player.toggle({ intervalId: "interval-2", revision: 2, voice: "Kore", enabled: true });
    // One audio instance now serves every read. If each read left its
    // timeupdate listener behind, one clock tick would publish once per read.
    h.audios[0].currentTime = 5;
    const before = h.snapshots.length;
    h.audios[0].fire("timeupdate");
    expect(h.snapshots.length - before).toBe(1);
  });

  it("reuses one audio context for the window's whole life and closes it on dispose", async () => {
    const h = harness();
    await h.player.toggle({ intervalId: "interval-1", revision: 1, voice: "Kore", enabled: true });
    await h.player.toggle({ intervalId: "interval-2", revision: 2, voice: "Kore", enabled: true });
    // Browsers cap live Web Audio contexts (around six). Each read used to
    // create a new one and never close it, so repeated listening could make
    // Listen fail until the app restarted.
    expect(h.audios).toHaveLength(1);
    expect(h.audios[0].closed).toBe(0);
    h.player.stop();
    expect(h.audios[0].closed).toBe(0);
    h.player.dispose();
    expect(h.audios[0].closed).toBe(1);
  });

  it("a late clip for a stopped read is dropped", async () => {
    let release: (clip: RecapSpeechClip) => void = () => undefined;
    const h = harness({
      fetchClip: () => new Promise<RecapSpeechClip>((resolve) => { release = resolve; }),
    });
    const pending = h.player.toggle({ intervalId: "interval-1", revision: 1, voice: "Kore", enabled: true });
    h.player.stop();
    release({ bytes: new ArrayBuffer(8), mimeType: "audio/wav", lines: [{ text: "Too late", time: null }], revision: 1, stale: false });
    await pending;
    expect(h.player.snapshot().status).toBe("idle");
    expect(h.audios[0].paused).toBeGreaterThan(0);
    expect(h.failures).toHaveLength(0);
  });

  it("ending the clip keeps the words on screen and frees the player", async () => {
    const h = harness();
    await h.player.toggle({ intervalId: "interval-1", revision: 4, voice: "Kore", enabled: true });
    h.audios[0].fire("ended");
    // The decision the employee pressed Listen for is now theirs to make, with
    // the words still in front of them.
    expect(h.player.snapshot().status).toBe("finished");
    expect(h.player.snapshot().lines).toHaveLength(3);
    expect(h.player.snapshot().progress).toBe(1);
    expect(h.player.snapshot().activeIndex).toBe(2);
    expect(h.audios[0].paused).toBeGreaterThan(0);
    // A second press reads it again rather than resuming, and pressing Stop
    // (the dismiss in the bubble) returns the bubble to its resting shape.
    await h.player.toggle({ intervalId: "interval-1", revision: 4, voice: "Kore", enabled: true });
    expect(h.player.snapshot().status).toBe("idle");
    expect(h.player.snapshot().lines).toEqual([]);
  });

  it("keeps the employee personal recap flow unchanged", async () => {
    const h = harness();
    await h.player.toggle({ intervalId: "interval-1", revision: 4, voice: "Kore", enabled: true });
    expect(h.fetched[0]).toEqual({ intervalId: "interval-1", revision: 4, reviewKey: null, voice: "Kore" });
    expect(h.player.snapshot().reviewKey).toBe(null);
    expect(h.player.snapshot().revision).toBe(4);
    expect(h.player.snapshot().status).toBe("playing");
  });
});
