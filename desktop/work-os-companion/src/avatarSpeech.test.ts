import { describe, expect, it } from "vitest";
import { avatarPlaybackAllowed, avatarSpeechNeedsLease, type AvatarAudioContext } from "./avatarSpeech";
import { createRecapSpeechPlayer, type RecapAudio, type RecapSpeechSnapshot } from "./recapSpeechPlayer";

const employee: AvatarAudioContext = { scope: { userId: "user-1", organizationId: "org-1", mode: "employee" }, epoch: 1 };
const admin: AvatarAudioContext = { scope: { userId: "user-1", organizationId: "org-1", mode: "admin" }, epoch: 3 };

function fakeAudio() {
  let played = 0;
  const audio: RecapAudio & { played(): number } = {
    currentTime: 0,
    duration: 30,
    async load() { /* decoded */ },
    async play() { played += 1; },
    pause() { /* no-op for the fake */ },
    addEventListener() { /* no clock in this test */ },
    played: () => played,
  };
  return audio;
}

describe("avatar speech ownership", () => {
  it("requires a lease for every identified actor, not only an administrator", () => {
    expect(avatarSpeechNeedsLease(employee)).toBe(true);
    expect(avatarSpeechNeedsLease(admin)).toBe(true);
    expect(avatarSpeechNeedsLease(null)).toBe(false);
  });

  it("allows direct playback only when no identity is known", () => {
    expect(avatarPlaybackAllowed(null, null)).toBe(true);
    // The regression: an employee context previously fell through to `true`,
    // so the companion spoke beside the main window instead of taking a lease.
    expect(avatarPlaybackAllowed(null, employee)).toBe(false);
    expect(avatarPlaybackAllowed(null, admin)).toBe(false);
    expect(avatarPlaybackAllowed({ isActive: () => true }, employee)).toBe(true);
    expect(avatarPlaybackAllowed({ isActive: () => false }, employee)).toBe(false);
    expect(avatarPlaybackAllowed({ isActive: () => true }, null)).toBe(true);
  });

  it("does not start an employee read before the lease is granted", async () => {
    const audio = fakeAudio();
    const snapshots: RecapSpeechSnapshot[] = [];
    let lease: { isActive: () => boolean } | null = null;
    const player = createRecapSpeechPlayer({
      fetchClip: async () => ({
        bytes: new ArrayBuffer(8),
        mimeType: "audio/wav",
        lines: [{ text: "Read the queue.", time: null }],
        revision: 1,
        reviewKey: null,
        stale: false,
      }),
      createAudio: () => audio,
      isPlaybackAllowed: () => avatarPlaybackAllowed(lease, employee),
      onSnapshot: (snapshot) => snapshots.push(snapshot),
      onFailure: () => undefined,
      onStaleCard: () => undefined,
    });
    await player.toggle({ intervalId: "interval-1", revision: null, voice: "Kore", enabled: true });
    expect(audio.played()).toBe(0);
    expect(snapshots.at(-1)?.retryIntervalId).toBe("interval-1");

    lease = { isActive: () => true };
    await player.toggle({ intervalId: "interval-1", revision: null, voice: "Kore", enabled: true });
    expect(audio.played()).toBe(1);
    player.dispose();
  });
});
