import { describe, expect, it, vi } from "vitest";
import { startVoiceCapture } from "./voiceInput";

function fakeStream() {
  const stop = vi.fn();
  return { stream: { getTracks: () => [{ stop }] } as unknown as MediaStream, stop };
}

function fakeRecorder(start = vi.fn()) {
  return { start, mimeType: "audio/webm" } as unknown as MediaRecorder;
}

describe("voice capture start gate", () => {
  it("waits for the ownership gate before opening the microphone, then records", async () => {
    let releaseGate: (message: string | null) => void = () => undefined;
    const gate = new Promise<string | null>((resolve) => { releaseGate = resolve; });
    const media = fakeStream();
    const startRecorder = vi.fn();
    const recorder = fakeRecorder(startRecorder);
    const getUserMedia = vi.fn(async () => media.stream);
    const onRecorder = vi.fn();
    const pending = startVoiceCapture({
      beforeCapture: () => gate,
      getUserMedia,
      createRecorder: () => recorder,
      isTypeSupported: () => true,
      isCancelled: () => false,
      onRecorder,
    });
    // The microphone has not opened while the lease/stop gate is pending.
    expect(getUserMedia).not.toHaveBeenCalled();
    releaseGate(null);
    const result = await pending;
    expect(result.ok).toBe(true);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(onRecorder).toHaveBeenCalledWith(recorder);
    expect(startRecorder).toHaveBeenCalledWith(250);
    expect(onRecorder.mock.invocationCallOrder[0]).toBeLessThan(startRecorder.mock.invocationCallOrder[0]);
  });

  it("a refused gate never opens the microphone", async () => {
    const media = fakeStream();
    const getUserMedia = vi.fn(async () => media.stream);
    const result = await startVoiceCapture({
      beforeCapture: () => "Audio is playing in another companion window.",
      getUserMedia,
      createRecorder: () => fakeRecorder(),
      isCancelled: () => false,
    });
    expect(result).toEqual({ ok: false, failure: "start", message: "Audio is playing in another companion window." });
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("cancelling while the gate is pending opens nothing", async () => {
    let releaseGate: (message: string | null) => void = () => undefined;
    const gate = new Promise<string | null>((resolve) => { releaseGate = resolve; });
    let cancelled = false;
    const getUserMedia = vi.fn(async () => fakeStream().stream);
    const pending = startVoiceCapture({
      beforeCapture: () => gate,
      getUserMedia,
      createRecorder: () => fakeRecorder(),
      isCancelled: () => cancelled,
    });
    cancelled = true;
    releaseGate(null);
    const result = await pending;
    expect(result).toEqual({ ok: false, failure: "cancelled" });
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("a stream that arrives after cancellation is closed without a recorder", async () => {
    let finishMedia: (stream: MediaStream) => void = () => undefined;
    let cancelled = false;
    const first = fakeStream();
    const createRecorder = vi.fn(() => fakeRecorder());
    const pending = startVoiceCapture({
      getUserMedia: () => new Promise<MediaStream>((resolve) => { finishMedia = resolve; }),
      createRecorder,
      isCancelled: () => cancelled,
    });
    await Promise.resolve();
    cancelled = true;
    finishMedia(first.stream);
    const result = await pending;
    expect(result).toEqual({ ok: false, failure: "cancelled" });
    expect(first.stop).toHaveBeenCalledTimes(1);
    expect(createRecorder).not.toHaveBeenCalled();
  });

  it("a recorder that cannot start closes the microphone", async () => {
    const media = fakeStream();
    const recorder = fakeRecorder(vi.fn(() => { throw new Error("start failed"); }));
    const result = await startVoiceCapture({
      getUserMedia: async () => media.stream,
      createRecorder: () => recorder,
      isTypeSupported: () => true,
      isCancelled: () => false,
    });
    expect(result).toEqual({ ok: false, failure: "start" });
    expect(media.stop).toHaveBeenCalledTimes(1);
  });
});
