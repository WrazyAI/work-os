import { describe, expect, it } from "vitest";
import type { RecapSpeechClip } from "./api";
import { createRecapSpeechPlayer, type RecapAudio, type RecapSpeechSnapshot } from "./recapSpeechPlayer";

function fakeAudio() {
  const listeners = new Map<string, Array<() => void>>();
  const audio: RecapAudio & { currentTime: number; fire(type: string): void; played: number; paused: number } = {
    currentTime: 0,
    duration: 30,
    played: 0,
    paused: 0,
    async play() { audio.played += 1; },
    pause() { audio.paused += 1; },
    addEventListener(type, handler) {
      listeners.set(type, [...(listeners.get(type) ?? []), handler]);
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
  const released: string[] = [];
  const fetched: Array<{ intervalId: string; revision: number | null; voice: string }> = [];
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
    toObjectUrl: () => "blob:clip",
    releaseObjectUrl: (url) => { released.push(url); },
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
  return { player, snapshots, failures, stale, audios, released, fetched, setClip: (next: RecapSpeechClip) => { clip = next; } };
}

describe("recap speech player", () => {
  it("loads, plays, and follows the audio's own clock", async () => {
    const h = harness();
    await h.player.toggle({ intervalId: "interval-1", revision: 4, voice: "Kore", enabled: true });
    expect(h.snapshots.map((snapshot) => snapshot.status)).toEqual(["loading", "playing"]);
    expect(h.player.snapshot().lines).toHaveLength(3);
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
    expect(h.audios).toHaveLength(1); // one audio element for the whole window
  });

  it("switching recaps replaces the read instead of stacking a second one", async () => {
    const h = harness();
    await h.player.toggle({ intervalId: "interval-1", revision: 1, voice: "Kore", enabled: true });
    await h.player.toggle({ intervalId: "interval-2", revision: 2, voice: "Kore", enabled: true });
    expect(h.player.snapshot().intervalId).toBe("interval-2");
    expect(h.player.snapshot().status).toBe("playing");
    expect(h.fetched.map((call) => call.intervalId)).toEqual(["interval-1", "interval-2"]);
  });

  it("says nothing and does nothing when the capability or the recap is missing", async () => {
    const h = harness();
    await h.player.toggle({ intervalId: "interval-1", revision: 1, voice: "Kore", enabled: false });
    await h.player.toggle({ intervalId: null, revision: null, voice: "Kore", enabled: true });
    expect(h.fetched).toHaveLength(0);
    expect(h.player.snapshot().status).toBe("idle");
  });

  it("a failed read tells the employee, stays retryable, and leaves no audio behind", async () => {
    let fail = true;
    const h = harness({
      fetchClip: async () => {
        if (fail) throw Object.assign(new Error("Reading a recap is unavailable right now. Try again in a moment."), { name: "ApiRequestError" });
        return { bytes: new ArrayBuffer(8), mimeType: "audio/wav", lines: [{ text: "Lead", time: null }], revision: 1, stale: false };
      },
    });
    await h.player.toggle({ intervalId: "interval-1", revision: 1, voice: "Kore", enabled: true });
    expect(failuresOf(h)).toEqual(["Reading a recap is unavailable right now. Try again in a moment."]);
    expect(h.player.snapshot().status).toBe("idle");
    expect(h.audios).toHaveLength(0);
    fail = false;
    await h.player.toggle({ intervalId: "interval-1", revision: 1, voice: "Kore", enabled: true });
    expect(h.player.snapshot().status).toBe("playing");
  });

  it("refreshes the card when the recap has moved on, before it plays", async () => {
    const h = harness();
    h.setClip({ bytes: new ArrayBuffer(8), mimeType: "audio/wav", lines: [{ text: "Newer words", time: null }], revision: 5, stale: true });
    await h.player.toggle({ intervalId: "interval-1", revision: 4, voice: "Kore", enabled: true });
    expect(h.stale).toEqual(["interval-1"]);
    expect(h.player.snapshot().lines).toEqual([{ text: "Newer words", time: null }]);
    expect(h.player.snapshot().revision).toBe(5);
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
    expect(h.audios).toHaveLength(0);
    expect(h.failures).toHaveLength(0);
  });

  it("ending the clip keeps the words on screen and frees the clip's url", async () => {
    const h = harness();
    await h.player.toggle({ intervalId: "interval-1", revision: 4, voice: "Kore", enabled: true });
    h.audios[0].fire("ended");
    // The decision the employee pressed Listen for is now theirs to make, with
    // the words still in front of them.
    expect(h.player.snapshot().status).toBe("finished");
    expect(h.player.snapshot().lines).toHaveLength(3);
    expect(h.player.snapshot().progress).toBe(1);
    expect(h.player.snapshot().activeIndex).toBe(2);
    expect(h.released).toContain("blob:clip");
    // A second press reads it again rather than resuming, and pressing Stop
    // (the dismiss in the bubble) returns the bubble to its resting shape.
    await h.player.toggle({ intervalId: "interval-1", revision: 4, voice: "Kore", enabled: true });
    expect(h.player.snapshot().status).toBe("idle");
    expect(h.player.snapshot().lines).toEqual([]);
  });
});

function failuresOf(h: ReturnType<typeof harness>) {
  return h.failures;
}
