import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdminRecapView } from "./AdminRecapView";
import { adminListenedKey } from "./listened";
import { FIXTURE_REVIEWED_RECAP } from "./fixtures";
import { createRecapSpeechPlayer, type RecapAudio, type RecapSpeechSnapshot } from "../recapSpeechPlayer";

function fakeAudio() {
  const listeners = new Map<string, Array<() => void>>();
  let played = 0;
  const audio: RecapAudio & { fire(type: string): void; played(): number } = {
    currentTime: 0,
    duration: 30,
    async load() { /* decoded */ },
    async play() { played += 1; },
    pause() { /* no-op for the fake */ },
    addEventListener(type, handler) {
      listeners.set(type, [...(listeners.get(type) ?? []), handler]);
    },
    fire(type) {
      for (const handler of listeners.get(type) ?? []) handler();
    },
    played: () => played,
  };
  return audio;
}

function playerWithClip(onSnapshot: (snapshot: RecapSpeechSnapshot) => void, overrides: {
  fetch?: () => Promise<{
    bytes: ArrayBuffer; mimeType: string; lines: typeof FIXTURE_REVIEWED_RECAP.speechLines;
    revision: number | null; reviewKey?: string | null; stale: boolean;
  }>;
  isPlaybackAllowed?: () => boolean;
} = {}) {
  const audio = fakeAudio();
  const player = createRecapSpeechPlayer({
    fetchClip: overrides.fetch ?? (async () => ({
      bytes: new ArrayBuffer(8),
      mimeType: "audio/wav",
      lines: FIXTURE_REVIEWED_RECAP.speechLines,
      revision: 1,
      reviewKey: FIXTURE_REVIEWED_RECAP.reviewKey,
      stale: false,
    })),
    createAudio: () => audio,
    isPlaybackAllowed: overrides.isPlaybackAllowed,
    onSnapshot,
    onFailure() {},
    onStaleCard() {},
  });
  return { player, audio };
}

const renderView = (playback: Parameters<typeof AdminRecapView>[0]["playback"]) =>
  renderToStaticMarkup(createElement(AdminRecapView, {
    recap: FIXTURE_REVIEWED_RECAP,
    onListen() {},
    onOpenRecord() {},
    playback,
  }));

describe("admin recap playback events", () => {
  it("shows preparing, then the real finished event as completed without a Stop", async () => {
    const state: { snapshot: RecapSpeechSnapshot | null } = { snapshot: null };
    const pendingFetch: { finish?: () => void } = {};
    const { player, audio } = playerWithClip(
      (next) => { state.snapshot = next; },
      {
        fetch: () => new Promise((resolve) => {
          pendingFetch.finish = () => resolve({
            bytes: new ArrayBuffer(8),
            mimeType: "audio/wav",
            lines: FIXTURE_REVIEWED_RECAP.speechLines,
            revision: 1,
            reviewKey: FIXTURE_REVIEWED_RECAP.reviewKey,
            stale: false,
          });
        }),
      },
    );
    const pending = player.toggle({
      intervalId: FIXTURE_REVIEWED_RECAP.intervalId,
      revision: null,
      reviewKey: FIXTURE_REVIEWED_RECAP.reviewKey,
      voice: "Kore",
      enabled: true,
    });
    const loading = renderView(state.snapshot);
    expect(loading).toContain("Getting your recap…");
    expect(loading).toContain(">Stop<");
    pendingFetch.finish?.();
    await pending;
    expect(state.snapshot?.status).toBe("playing");

    audio.fire("ended");
    expect(state.snapshot?.status).toBe("finished");
    const finished = renderView(state.snapshot);
    expect(finished).toContain("Read complete");
    expect(finished).not.toContain("Otto is reading");
    expect(finished).not.toContain("Stop reading");
    expect(finished).toContain("Listen again");
    expect(finished).toContain("recap-prompter");
  });

  it("marks listened only on the finished snapshot, never on stop or cancel", async () => {
    const state: { snapshot: RecapSpeechSnapshot | null } = { snapshot: null };
    const { player, audio } = playerWithClip((next) => { state.snapshot = next; });
    await player.toggle({
      intervalId: FIXTURE_REVIEWED_RECAP.intervalId,
      revision: null,
      reviewKey: FIXTURE_REVIEWED_RECAP.reviewKey,
      voice: "Kore",
      enabled: true,
    });
    expect(adminListenedKey(state.snapshot!, FIXTURE_REVIEWED_RECAP)).toBe(null);
    audio.fire("ended");
    expect(adminListenedKey(state.snapshot!, FIXTURE_REVIEWED_RECAP))
      .toBe(`${FIXTURE_REVIEWED_RECAP.eventId}:${FIXTURE_REVIEWED_RECAP.reviewKey}`);
    player.stop();
    expect(state.snapshot?.status).toBe("idle");
    expect(adminListenedKey(state.snapshot!, FIXTURE_REVIEWED_RECAP)).toBe(null);
  });

  it("never plays a clip whose recording lease was revoked while it loaded", async () => {
    let allowed = true;
    const pendingFetch: { finish?: () => void } = {};
    const state: { snapshot: RecapSpeechSnapshot | null } = { snapshot: null };
    const { player, audio } = playerWithClip(
      (next) => { state.snapshot = next; },
      {
        fetch: () => new Promise((resolve) => {
          pendingFetch.finish = () => resolve({
            bytes: new ArrayBuffer(8),
            mimeType: "audio/wav",
            lines: FIXTURE_REVIEWED_RECAP.speechLines,
            revision: 1,
            reviewKey: FIXTURE_REVIEWED_RECAP.reviewKey,
            stale: false,
          });
        }),
        isPlaybackAllowed: () => allowed,
      },
    );
    const pending = player.toggle({
      intervalId: FIXTURE_REVIEWED_RECAP.intervalId,
      revision: null,
      reviewKey: FIXTURE_REVIEWED_RECAP.reviewKey,
      voice: "Kore",
      enabled: true,
    });
    allowed = false; // revoked between grant and the first audible frame
    pendingFetch.finish?.();
    await pending;
    expect(audio.played()).toBe(0);
    expect(state.snapshot?.status).toBe("idle");
  });
});
