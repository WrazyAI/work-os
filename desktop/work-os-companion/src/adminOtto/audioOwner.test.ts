import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOttoAudioBroker,
  createOttoAudioRequester,
  onOttoAudioStop,
  OTTO_AUDIO_DENY_EVENT,
  OTTO_AUDIO_GRANT_EVENT,
  OTTO_AUDIO_REQUEST_EVENT,
  OTTO_AUDIO_REVOKE_EVENT,
  OTTO_AUDIO_STOPPED_EVENT,
  onOttoSpeechStop,
  requestOttoAudioStop,
  requestOttoSpeechStop,
  type OttoAudioBus,
  type OttoAudioPayload,
} from "./audioOwner";

type Handler = (payload: unknown) => void;

function fakeBus() {
  const handlers = new Map<string, Set<Handler>>();
  const emitted: Array<{ event: string; payload: OttoAudioPayload }> = [];
  const bus: OttoAudioBus = {
    async listen(event, handler) {
      const group = handlers.get(event) ?? new Set();
      group.add(handler);
      handlers.set(event, group);
      return () => group.delete(handler);
    },
    async emit(event, payload) {
      emitted.push({ event, payload: payload as OttoAudioPayload });
      for (const handler of handlers.get(event) ?? []) handler(payload);
    },
  };
  return {
    bus,
    emitted,
    events: (name: string) => emitted.filter((entry) => entry.event === name).map((entry) => entry.payload),
    fire(event: string, payload: unknown) {
      for (const handler of handlers.get(event) ?? []) handler(payload);
    },
  };
}

const scope = { userId: "actor", organizationId: "org", mode: "admin" as const };

afterEach(() => {
  vi.useRealTimers();
});

describe("admin Otto audio broker", () => {
  it("simultaneous_starts_never_overlap_and_grant_exactly_one_owner", async () => {
    const h = fakeBus();
    const broker = createOttoAudioBroker({ local: h.bus, remote: h.bus, timeoutMs: 2_000 });
    await broker.start();

    h.fire(OTTO_AUDIO_REQUEST_EVENT, { scope, epoch: 7, windowId: "main", token: "main-owner" });
    h.fire(OTTO_AUDIO_REQUEST_EVENT, { scope, epoch: 7, windowId: "avatar", token: "avatar-next" });
    const revoke = h.events(OTTO_AUDIO_REVOKE_EVENT).at(-1)!;
    expect(revoke).toMatchObject({ scope, epoch: 7, windowId: "main", token: "main-owner" });
    // Nothing is granted until the old owner acknowledges that it stopped.
    expect(h.events(OTTO_AUDIO_GRANT_EVENT).filter((payload) => payload.windowId === "avatar")).toHaveLength(0);

    h.fire(OTTO_AUDIO_STOPPED_EVENT, { scope, epoch: 7, windowId: "main", token: "main-owner" });
    expect(h.events(OTTO_AUDIO_GRANT_EVENT).filter((payload) => payload.windowId === "avatar")).toHaveLength(1);
    expect(broker.snapshot().owner?.windowId).toBe("avatar");

    // While the avatar owns, one main request waits and a second simultaneous
    // request is refused; it can never silently replace the queued owner.
    h.fire(OTTO_AUDIO_REQUEST_EVENT, { scope, epoch: 7, windowId: "main", token: "main-waiting" });
    h.fire(OTTO_AUDIO_REQUEST_EVENT, { scope, epoch: 7, windowId: "avatar", token: "avatar-fourth" });
    expect(h.events(OTTO_AUDIO_DENY_EVENT).at(-1)).toMatchObject({ windowId: "avatar", token: "avatar-fourth" });
    expect(h.events(OTTO_AUDIO_GRANT_EVENT).filter((payload) => payload.token === "avatar-fourth")).toHaveLength(0);

    h.fire(OTTO_AUDIO_STOPPED_EVENT, { scope, epoch: 7, windowId: "avatar", token: "avatar-next" });
    expect(h.events(OTTO_AUDIO_GRANT_EVENT).filter((payload) => payload.token === "main-waiting")).toHaveLength(1);
    expect(broker.snapshot().owner?.windowId).toBe("main");
    await broker.stop();
  });

  it("stale acknowledgements are ignored instead of granting a second owner", async () => {
    const h = fakeBus();
    const broker = createOttoAudioBroker({ local: h.bus, remote: h.bus, timeoutMs: 2_000 });
    await broker.start();
    h.fire(OTTO_AUDIO_REQUEST_EVENT, { scope, epoch: 1, windowId: "avatar", token: "avatar-1" });
    h.fire(OTTO_AUDIO_REQUEST_EVENT, { scope, epoch: 1, windowId: "main", token: "main-1" });
    // A stale token from an earlier ownership period, and even a matching id in
    // the wrong window, cannot clear the live owner.
    h.fire(OTTO_AUDIO_STOPPED_EVENT, { scope, epoch: 1, windowId: "avatar", token: "old-token" });
    h.fire(OTTO_AUDIO_STOPPED_EVENT, { scope, epoch: 1, windowId: "main", token: "avatar-1" });
    expect(broker.snapshot().owner?.token).toBe("avatar-1");
    expect(h.events(OTTO_AUDIO_GRANT_EVENT).filter((payload) => payload.token === "main-1")).toHaveLength(0);

    h.fire(OTTO_AUDIO_STOPPED_EVENT, { scope, epoch: 1, windowId: "avatar", token: "avatar-1" });
    expect(broker.snapshot().owner?.token).toBe("main-1");
    expect(h.events(OTTO_AUDIO_GRANT_EVENT).filter((payload) => payload.token === "main-1")).toHaveLength(1);
    await broker.stop();
  });

  it("fails the waiting request after a two-second stop timeout rather than overlapping", async () => {
    vi.useFakeTimers();
    const h = fakeBus();
    const broker = createOttoAudioBroker({ local: h.bus, remote: h.bus, timeoutMs: 2_000 });
    await broker.start();
    h.fire(OTTO_AUDIO_REQUEST_EVENT, { scope, epoch: 1, windowId: "avatar", token: "avatar-1" });
    const pending = createOttoAudioRequester({ windowId: "main", bus: h.bus, timeoutMs: 3_000 }).request(scope, 1, "speech");
    const settled = pending.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(h.events(OTTO_AUDIO_DENY_EVENT)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    const failure = await settled;
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/busy|another window/i);
    expect(h.events(OTTO_AUDIO_DENY_EVENT).at(-1)).toMatchObject({ windowId: "main", token: expect.any(String) });
    // The old owner is untouched; no second owner was granted.
    expect(broker.snapshot().owner?.token).toBe("avatar-1");
    await broker.stop();
  });

  it("window destruction releases the owner and grants the queued request", async () => {
    const h = fakeBus();
    const broker = createOttoAudioBroker({ local: h.bus, remote: h.bus, timeoutMs: 2_000 });
    await broker.start();
    h.fire(OTTO_AUDIO_REQUEST_EVENT, { scope, epoch: 1, windowId: "avatar", token: "avatar-1" });
    const waiting = createOttoAudioRequester({ windowId: "main", bus: h.bus, timeoutMs: 2_000 }).request(scope, 1, "speech");
    broker.windowDestroyed("avatar");
    await waiting;
    expect(broker.snapshot().owner?.windowId).toBe("main");
    await broker.stop();
  });

  it("carries only scope, epoch, window id and request token across the wire", async () => {
    const h = fakeBus();
    const broker = createOttoAudioBroker({ local: h.bus, remote: h.bus, timeoutMs: 2_000 });
    await broker.start();
    const avatar = createOttoAudioRequester({ windowId: "avatar", bus: h.bus, timeoutMs: 2_000 });
    const lease = await avatar.request(scope, 4, "recording");
    const request = h.events(OTTO_AUDIO_REQUEST_EVENT).at(-1)!;
    expect(Object.keys(request).sort()).toEqual(["epoch", "scope", "token", "windowId"]);
    expect(Object.keys(request.scope).sort()).toEqual(["mode", "organizationId", "userId"]);
    expect(request).not.toHaveProperty("kind");
    expect(request.token).toBe(lease.token);
    lease.release();
    await broker.stop();
    avatar.dispose();
  });

  it("times out a request when no broker answers", async () => {
    vi.useFakeTimers();
    const h = fakeBus();
    const requester = createOttoAudioRequester({ windowId: "avatar", bus: h.bus, timeoutMs: 2_000 });
    const pending = requester.request(scope, 1, "speech");
    const settled = pending.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(2_000);
    const failure = await settled;
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/busy|another window/i);
    // A late grant for the abandoned token must never play audio.
    h.fire(OTTO_AUDIO_GRANT_EVENT, h.events(OTTO_AUDIO_REQUEST_EVENT).at(-1));
    expect(requester.active()).toBe(null);
    requester.dispose();
  });

  it("revokes an owner through the registered stop seam before acknowledging", async () => {
    const h = fakeBus();
    const stopped = vi.fn();
    const requester = createOttoAudioRequester({
      windowId: "avatar",
      bus: h.bus,
      timeoutMs: 2_000,
      onRevoke: () => stopped(),
    });
    const broker = createOttoAudioBroker({ local: h.bus, remote: h.bus, timeoutMs: 2_000 });
    await broker.start();
    const lease = await requester.request(scope, 2, "speech");
    const other = createOttoAudioRequester({ windowId: "main", bus: h.bus, timeoutMs: 2_000 });
    const next = other.request(scope, 2, "recording");
    await next;
    expect(stopped).toHaveBeenCalledTimes(1);
    // The stop acknowledgement is emitted after the actual stop.
    expect(h.events(OTTO_AUDIO_STOPPED_EVENT).at(-1)?.token).toBe(lease.token);
    lease.release();
    other.dispose();
    requester.dispose();
    await broker.stop();
  });

  it("a second window's real player stops before the next lease resolves", async () => {
    const h = fakeBus();
    const broker = createOttoAudioBroker({ local: h.bus, remote: h.bus, timeoutMs: 2_000 });
    await broker.start();
    const mainPlayer = { playing: false };
    const avatarPlayer = { playing: false };
    const main = createOttoAudioRequester({
      windowId: "main",
      bus: h.bus,
      timeoutMs: 2_000,
      onRevoke: (_token, kind) => { if (kind === "speech") mainPlayer.playing = false; },
    });
    const avatar = createOttoAudioRequester({
      windowId: "avatar",
      bus: h.bus,
      timeoutMs: 2_000,
      onRevoke: (_token, kind) => { if (kind === "speech") avatarPlayer.playing = false; },
    });
    const first = await main.request(scope, 5, "speech");
    mainPlayer.playing = true;
    const second = avatar.request(scope, 5, "speech");
    // The broker revokes the main player and waits for its stopped ack before
    // the avatar lease resolves; the employee player never overlaps.
    const next = await second;
    expect(mainPlayer.playing).toBe(false);
    expect(first.isActive()).toBe(false);
    expect(next.isActive()).toBe(true);
    avatarPlayer.playing = true;
    next.release();
    main.dispose();
    avatar.dispose();
    await broker.stop();
  });

  it("a recording revoke closes the microphone, while a speech revoke does not", async () => {
    const h = fakeBus();
    const broker = createOttoAudioBroker({ local: h.bus, remote: h.bus, timeoutMs: 2_000 });
    await broker.start();
    const speechStop = vi.fn();
    const microphoneStop = vi.fn();
    const speechSeam = vi.fn();
    const microphoneSeam = vi.fn();
    const offSpeechSeam = onOttoSpeechStop(speechSeam);
    const offMicrophoneSeam = onOttoAudioStop(microphoneSeam);
    const speech = createOttoAudioRequester({
      windowId: "avatar", bus: h.bus, onRevoke: (_token, kind) => { if (kind === "speech") speechStop(); },
    });
    const speechLease = await speech.request(scope, 1, "speech");
    const other = createOttoAudioRequester({ windowId: "main", bus: h.bus });
    const next = other.request(scope, 1, "recording");
    await next;
    expect(speechStop).toHaveBeenCalledTimes(1);
    expect(speechSeam).toHaveBeenCalledTimes(1);
    expect(microphoneStop).not.toHaveBeenCalled();
    expect(microphoneSeam).not.toHaveBeenCalled();
    speechLease.release();
    // Release the recording lease this phase created, so the next request is
    // granted directly rather than revoking another recording.
    (await next).release();

    const recording = createOttoAudioRequester({
      windowId: "avatar", bus: h.bus, onRevoke: (_token, kind) => { if (kind === "recording") microphoneStop(); },
    });
    const held = await recording.request(scope, 1, "recording");
    const nextOther = createOttoAudioRequester({ windowId: "main", bus: h.bus });
    await nextOther.request(scope, 1, "speech");
    expect(microphoneStop).toHaveBeenCalledTimes(1);
    // The recording revoke stops both narration and the microphone; the
    // speech revoke earlier stopped narration only.
    expect(microphoneSeam).toHaveBeenCalledTimes(1);
    expect(speechSeam).toHaveBeenCalledTimes(2);
    held.release();
    offSpeechSeam();
    offMicrophoneSeam();
    speech.dispose();
    other.dispose();
    recording.dispose();
    nextOther.dispose();
    await broker.stop();
  });

  it("a grant revoked before start is inactive and must not start audio", async () => {
    const h = fakeBus();
    const broker = createOttoAudioBroker({ local: h.bus, remote: h.bus, timeoutMs: 2_000 });
    await broker.start();
    const requester = createOttoAudioRequester({ windowId: "avatar", bus: h.bus, timeoutMs: 2_000 });
    const pending = requester.request(scope, 3, "speech");
    for (let attempt = 0; attempt < 20 && !h.events(OTTO_AUDIO_REQUEST_EVENT).length; attempt += 1) await Promise.resolve();
    const request = h.events(OTTO_AUDIO_REQUEST_EVENT).at(-1)!;
    // Grant the first owner and immediately revoke it for a second owner. The
    // first caller has not started media yet; its lease must report inactive.
    h.fire(OTTO_AUDIO_GRANT_EVENT, request);
    h.fire(OTTO_AUDIO_REQUEST_EVENT, { scope, epoch: 3, windowId: "main", token: "main-next" });
    const lease = await pending;
    expect(lease.isActive()).toBe(false);
    // The revoked owner acknowledged before the broker granted the next owner.
    const events = h.emitted.map((entry) => entry.event);
    expect(events.indexOf(OTTO_AUDIO_STOPPED_EVENT)).toBeLessThan(events.lastIndexOf(OTTO_AUDIO_GRANT_EVENT));
    expect(broker.snapshot().owner?.token).toBe("main-next");
    lease.release();
    requester.dispose();
    await broker.stop();
  });

  it("speech-only stop never cancels a microphone capture", () => {
    const speech = vi.fn();
    const microphone = vi.fn();
    const offSpeech = onOttoSpeechStop(speech);
    const offMic = onOttoAudioStop(microphone);
    requestOttoSpeechStop();
    expect(speech).toHaveBeenCalledTimes(1);
    expect(microphone).not.toHaveBeenCalled();
    // The all-audio seam still reaches both.
    requestOttoAudioStop();
    expect(speech).toHaveBeenCalledTimes(2);
    expect(microphone).toHaveBeenCalledTimes(1);
    offSpeech();
    offMic();
  });

  it("keeps the existing mode stop seam working", () => {
    const first = vi.fn();
    const second = vi.fn(() => { throw new Error("already disposed"); });
    const offFirst = onOttoAudioStop(first);
    const offSecond = onOttoAudioStop(second);
    requestOttoAudioStop();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    offFirst();
    offSecond();
    requestOttoAudioStop();
    expect(first).toHaveBeenCalledTimes(1);
  });
});
