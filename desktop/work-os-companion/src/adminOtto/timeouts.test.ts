import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setDebugSession } from "../api";
import { ADMIN_OTTO_CHAT_TIMEOUT_MS, ADMIN_OTTO_SPEECH_TIMEOUT_MS, ADMIN_OTTO_TRANSCRIPTION_TIMEOUT_MS, fetchAdminOttoContext, sendAdminOttoChat, speakAdminOttoRecap, transcribeAdminOttoAudio } from "./api";

const session = {
  token: "token",
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  organizationId: "org-1",
  apiBase: "https://api.test",
};

function hangingFetch() {
  return vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", { location: { search: "" } });
  setDebugSession(session);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setDebugSession(null);
});

describe("admin Otto provider timeouts", () => {
  it("keeps ordinary admin JSON requests on the 20-second budget", async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const pending = fetchAdminOttoContext();
    const settled = pending.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(19_999);
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].signal?.aborted).toBe(true);
    expect(await settled).toBeInstanceOf(Error);
  });

  it("keeps the three admin budgets explicit", () => {
    expect(ADMIN_OTTO_CHAT_TIMEOUT_MS).toBe(60_000);
    expect(ADMIN_OTTO_SPEECH_TIMEOUT_MS).toBe(90_000);
    expect(ADMIN_OTTO_TRANSCRIPTION_TIMEOUT_MS).toBe(25_000);
  });

  it("gives chat the 60-second server budget", async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const pending = sendAdminOttoChat({ conversationId: null, requestId: "request-1", text: "unfinished work" });
    const settled = pending.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(59_999);
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].signal?.aborted).toBe(true);
    expect(await settled).toBeInstanceOf(Error);
  });

  it("gives reviewed speech the existing 90-second provider budget", async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const pending = speakAdminOttoRecap({ intervalId: "interval-1", reviewKey: "key-1" });
    const settled = pending.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(89_999);
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].signal?.aborted).toBe(true);
    expect(await settled).toBeInstanceOf(Error);
  });

  it("gives transcription the provider budget and propagates cancellation", async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const abort = new AbortController();
    const pending = transcribeAdminOttoAudio(new Blob([new Uint8Array([1])], { type: "audio/webm" }), "en", abort.signal);
    const settled = pending.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(24_999);
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].signal?.aborted).toBe(false);
    abort.abort();
    expect(await settled).toBeInstanceOf(Error);
  });
});
