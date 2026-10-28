import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminOttoSpeechChangedError } from "./api";
import { createAdminSpeechFetcher, type AdminSpeechFetch, type AdminSpeechSpeak } from "./speech";
import { FIXTURE_CONFIRMED_RECAP, FIXTURE_REVIEWED_RECAP } from "./fixtures";
import { createRecapSpeechPlayer, RECAP_SLOW_AFTER_MS, type RecapAudio, type RecapSpeechSnapshot } from "../recapSpeechPlayer";

function fakeAudio() {
  const listeners = new Map<string, Array<() => void>>();
  const audio: RecapAudio & { played: number; paused: number; fire(type: string): void } = {
    currentTime: 0,
    duration: 30,
    played: 0,
    paused: 0,
    async load() {},
    async play() { audio.played += 1; },
    pause() { audio.paused += 1; },
    addEventListener(type, handler) { listeners.set(type, [...(listeners.get(type) ?? []), handler]); },
    fire(type) { for (const handler of listeners.get(type) ?? []) handler(); },
  };
  return audio;
}

const clipFor = (reviewKey: string, lines = [{ text: "The reviewed recap.", time: null }]): Awaited<ReturnType<AdminSpeechFetch>> => ({
  bytes: new ArrayBuffer(8),
  mimeType: "audio/wav",
  revision: null,
  reviewKey,
  lines,
  stale: false,
});

const speakClipFor = (reviewKey: string, lines = [{ text: "The reviewed recap.", time: null }]): Awaited<ReturnType<AdminSpeechSpeak>> => ({
  bytes: new ArrayBuffer(8),
  mimeType: "audio/wav",
  voice: "Kore",
  reviewKey,
  scriptHash: "hash",
  lines,
});

function harness(fetchClip: AdminSpeechFetch, options: Partial<Parameters<typeof createRecapSpeechPlayer>[0]> = {}) {
  const audios: Array<ReturnType<typeof fakeAudio>> = [];
  const snapshots: RecapSpeechSnapshot[] = [];
  const failures: string[] = [];
  const player = createRecapSpeechPlayer({
    fetchClip: (input) => fetchClip(input),
    createAudio: () => {
      const audio = fakeAudio();
      audios.push(audio);
      return audio;
    },
    onSnapshot: (snapshot) => snapshots.push(snapshot),
    onFailure: (message) => failures.push(message),
    onStaleCard: () => undefined,
    ...options,
  });
  return { player, audios, snapshots, failures };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("admin recap speech", () => {
  it("loading_slow_cancel_retry_match_existing_player", async () => {
    vi.useFakeTimers();
    const calls: Array<{ reviewKey?: string | null }> = [];
    let resolve!: (value: Awaited<ReturnType<AdminSpeechFetch>>) => void;
    const fetchClip: AdminSpeechFetch = (input) => {
      calls.push({ reviewKey: input.reviewKey });
      return new Promise((done) => { resolve = done; });
    };
    const h = harness(fetchClip);
    const first = h.player.toggle({ intervalId: FIXTURE_REVIEWED_RECAP.intervalId, revision: null, reviewKey: "key-1", voice: "Kore", enabled: true });
    expect(h.player.snapshot().status).toBe("loading");
    expect(h.player.snapshot().reviewKey).toBe("key-1");
    await vi.advanceTimersByTimeAsync(RECAP_SLOW_AFTER_MS);
    expect(h.player.snapshot().slow).toBe(true);
    h.player.stop();
    expect(h.player.snapshot().status).toBe("idle");
    resolve({ bytes: new ArrayBuffer(8), mimeType: "audio/wav", lines: [{ text: "Too late", time: null }], revision: null, reviewKey: "key-1", stale: false });
    await first;
    expect(h.audios[0]?.played ?? 0).toBe(0);

    // The retry speaks the same reviewed key explicitly.
    let resolveRetry!: (value: Awaited<ReturnType<AdminSpeechFetch>>) => void;
    const retryFetch = harness((input) => {
      calls.push({ reviewKey: input.reviewKey });
      return new Promise((done) => { resolveRetry = done; });
    });
    const retry = retryFetch.player.toggle({ intervalId: FIXTURE_REVIEWED_RECAP.intervalId, revision: null, reviewKey: "key-1", voice: "Kore", enabled: true });
    resolveRetry({ bytes: new ArrayBuffer(8), mimeType: "audio/wav", lines: [{ text: "The reviewed recap.", time: null }], revision: null, reviewKey: "key-1", stale: false });
    await retry;
    expect(retryFetch.player.snapshot().status).toBe("playing");
    expect(retryFetch.audios[0].played).toBe(1);
    // Stop is not a finished read.
    retryFetch.player.stop();
    expect(retryFetch.player.snapshot().status).toBe("idle");
    expect(calls.map((call) => call.reviewKey)).toEqual(["key-1", "key-1"]);
  });

  it("stale_key_refresh_requires_explicit_listen", async () => {
    const oldKey = "old-review-key";
    const newKey = "new-review-key";
    const asked: Array<string | null | undefined> = [];
    const changes: string[] = [];
    const failures: string[] = [];
    const fetchClip: AdminSpeechFetch = async (input) => {
      asked.push(input.reviewKey);
      if (input.reviewKey === oldKey) {
        throw new AdminOttoSpeechChangedError("This recap changed.", FIXTURE_CONFIRMED_RECAP);
      }
      return { ...clipFor(input.reviewKey ?? newKey, [{ text: "The updated recap.", time: null }]), stale: false };
    };
    const h = harness(fetchClip, {
      onReviewChanged: (error) => {
        if (!(error instanceof AdminOttoSpeechChangedError)) return false;
        changes.push(error.current.reviewKey);
        return true;
      },
      onFailure: (message) => failures.push(message),
    });

    await h.player.toggle({ intervalId: FIXTURE_REVIEWED_RECAP.intervalId, revision: null, reviewKey: oldKey, voice: "Kore", enabled: true });
    expect(h.player.snapshot().status).toBe("idle");
    expect(h.audios[0].played).toBe(0);
    expect(changes).toEqual([FIXTURE_CONFIRMED_RECAP.reviewKey]);
    expect(failures).toHaveLength(0);

    // The refreshed key is not played automatically: only an explicit Listen
    // starts the new reviewed version.
    await Promise.resolve();
    expect(h.audios[0].played).toBe(0);
    await h.player.toggle({ intervalId: FIXTURE_REVIEWED_RECAP.intervalId, revision: null, reviewKey: newKey, voice: "Kore", enabled: true });
    expect(h.audios.at(-1)?.played).toBe(1);
    expect(asked).toEqual([oldKey, newKey]);
    expect(h.player.snapshot().reviewKey).toBe(newKey);
    h.player.dispose();
  });

  it("uses admin speech only in admin mode and refuses a stale epoch before the provider call", async () => {
    const speak = vi.fn<AdminSpeechSpeak>(async () => speakClipFor("key-1"));
    const fetcher = createAdminSpeechFetcher({
      scope: { userId: "actor", organizationId: "org", mode: "employee" },
      epoch: 3,
      isCurrent: () => true,
      speak,
    });
    await expect(fetcher({ intervalId: FIXTURE_REVIEWED_RECAP.intervalId, reviewKey: "key-1", voice: "Kore" }))
      .rejects.toThrow(/administration/i);
    expect(speak).not.toHaveBeenCalled();

    const adminFetcher = createAdminSpeechFetcher({
      scope: { userId: "actor", organizationId: "org", mode: "admin" },
      epoch: 3,
      isCurrent: () => false,
      speak,
    });
    await expect(adminFetcher({ intervalId: FIXTURE_REVIEWED_RECAP.intervalId, reviewKey: "key-1", voice: "Kore" }))
      .rejects.toThrow(/changed|available|administration/i);
    expect(speak).not.toHaveBeenCalled();
  });

  it("prevents a late provider response from playing after the scope changes", async () => {
    let resolve!: (value: Awaited<ReturnType<AdminSpeechSpeak>>) => void;
    let current = true;
    const speak = vi.fn<AdminSpeechSpeak>(() => new Promise((done) => { resolve = done; }));
    const fetcher = createAdminSpeechFetcher({
      scope: { userId: "actor", organizationId: "org", mode: "admin" },
      epoch: 9,
      isCurrent: () => current,
      speak,
    });
    const pending = fetcher({ intervalId: FIXTURE_REVIEWED_RECAP.intervalId, reviewKey: "key-1", voice: "Kore" });
    current = false;
    resolve(speakClipFor("key-1"));
    await expect(pending).rejects.toThrow(/changed|available|administration/i);
    // The shared player rejects the same late clip and never starts audio.
    const h = harness(async () => {
      try { return await pending; } catch { throw new Error("Reading that recap is unavailable."); }
    });
    await h.player.toggle({ intervalId: FIXTURE_REVIEWED_RECAP.intervalId, revision: null, reviewKey: "key-1", voice: "Kore", enabled: true });
    expect(h.audios[0].played).toBe(0);
  });
});
