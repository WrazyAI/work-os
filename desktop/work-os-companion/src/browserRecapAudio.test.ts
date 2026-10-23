import { afterEach, describe, expect, it, vi } from "vitest";
import { browserRecapAudio } from "./recapSpeechPlayer";

/** A minimal Web Audio surface: enough for the adapter's clock, decode, and
 * source lifecycle, with the values the tests need to observe. */
function fakeAudioContext() {
  const sources: Array<{ offset: number | null; stopped: number }> = [];
  const contexts: Array<{ currentTime: number; resumed: number; closed: number }> = [];
  let duration = 30;
  let decodeNext: (() => Promise<{ duration: number }>) | null = null;
  let resumeGate: Promise<void> | null = null;
  class FakeSource {
    buffer: unknown = null;
    onended: (() => void) | null = null;
    offset: number | null = null;
    stopped = 0;
    connect(): void {}
    start(_when = 0, offset = 0): void { this.offset = offset; sources.push(this); }
    stop(): void { this.stopped += 1; }
  }
  class FakeContext {
    currentTime = 0;
    destination = {};
    resumed = 0;
    closed = 0;
    constructor() { contexts.push(this); }
    resume(): Promise<void> { this.resumed += 1; return resumeGate ?? Promise.resolve(); }
    async close(): Promise<void> { this.closed += 1; }
    decodeAudioData(): Promise<{ duration: number }> { return decodeNext ? decodeNext() : Promise.resolve({ duration }); }
    createBufferSource(): FakeSource { return new FakeSource(); }
  }
  vi.stubGlobal("window", { AudioContext: FakeContext });
  return {
    contexts,
    sources,
    setDuration: (next: number) => { duration = next; },
    setDecode: (next: () => Promise<{ duration: number }>) => { decodeNext = next; },
    setResumeGate: (next: Promise<void>) => { resumeGate = next; },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("browser recap audio", () => {
  it("starts a newly loaded clip at its beginning after an earlier read reached the end", async () => {
    const fake = fakeAudioContext();
    const audio = browserRecapAudio();
    await audio.load(new ArrayBuffer(8), "audio/wav");
    await audio.play();
    // The first clip ran to its end; pausing keeps that position.
    fake.contexts[0].currentTime = 30;
    audio.pause();

    // The next recap's clip is slightly longer. Without clearing the offset
    // the reused context would start it 30 seconds in.
    fake.setDuration(35);
    await audio.load(new ArrayBuffer(8), "audio/wav");
    await audio.play();

    expect(fake.sources.at(-1)?.offset).toBe(0);
    audio.close?.();
  });

  it("does not let a superseded decode replace the clip that is loading now", async () => {
    const fake = fakeAudioContext();
    const audio = browserRecapAudio();
    const pending: Array<(value: { duration: number }) => void> = [];
    fake.setDecode(() => new Promise((resolve) => { pending.push(resolve); }));
    const first = audio.load(new ArrayBuffer(8), "audio/wav");
    const second = audio.load(new ArrayBuffer(8), "audio/wav");
    // The second recap's decode wins the race.
    pending[1]({ duration: 20 });
    await second;
    expect(audio.duration).toBe(20);
    // The first (superseded) decode lands late and must not overwrite it.
    pending[0]({ duration: 50 });
    await first;
    expect(audio.duration).toBe(20);
    audio.close?.();
  });

  it("stops a playing source before loading the next clip", async () => {
    const fake = fakeAudioContext();
    const audio = browserRecapAudio();
    await audio.load(new ArrayBuffer(8), "audio/wav");
    await audio.play();
    expect(fake.sources).toHaveLength(1);
    // The exported adapter does not require callers to pause first: loading a
    // new clip must silence the old source instead of leaving it playing.
    await audio.load(new ArrayBuffer(8), "audio/wav");
    expect(fake.sources[0].stopped).toBe(1);
    audio.close?.();
  });

  it("does not start a source when playback is stopped while the context is resuming", async () => {
    const fake = fakeAudioContext();
    const audio = browserRecapAudio();
    await audio.load(new ArrayBuffer(8), "audio/wav");
    let resume: () => void = () => undefined;
    fake.setResumeGate(new Promise<void>((resolve) => { resume = resolve; }));
    const playing = audio.play();
    // The employee presses Stop while resume() is still pending.
    audio.pause();
    resume();
    await playing;
    expect(fake.sources).toHaveLength(0);
    audio.close?.();
  });

  it("closes the one context it opened when the adapter is closed", () => {
    const fake = fakeAudioContext();
    const audio = browserRecapAudio();
    expect(fake.contexts).toHaveLength(1);
    audio.close?.();
    expect(fake.contexts[0].closed).toBe(1);
  });
});
