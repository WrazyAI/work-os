import { afterEach, expect, it, vi } from "vitest";
import { fetchDay } from "./workOsQueries";
import { apiRequest } from "./api";
import { installRequestAbortCompatibility } from "./requestAbortCompatibility";

vi.mock("./vault", () => ({ secureState: {
  session: async () => ({ token: "fixture", organizationId: "fixture", apiBase: "https://example.test", expiresAt: "2099-01-01" }),
} }));
vi.mock("./diagnostics", () => ({ diagnostics: { withSpan: (_name: string, action: () => unknown) => action(), warn() {}, info() {}, error() {} } }));
afterEach(() => vi.unstubAllGlobals());

it("can load the initial day on WebKit without AbortSignal.any", async () => {
  vi.stubGlobal("AbortSignal", { timeout: globalThis.AbortSignal.timeout.bind(globalThis.AbortSignal) });
  installRequestAbortCompatibility();
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ tasks: [], taskHistory: [], evidence: [], proposals: [], plan: null })));
  const day = await fetchDay({ variant: "compact", signal: new AbortController().signal });
  expect(day.tasks).toEqual([]);
});

it("stops a day request as soon as the caller cancels", async () => {
  vi.stubGlobal("AbortSignal", { timeout: globalThis.AbortSignal.timeout.bind(globalThis.AbortSignal) });
  installRequestAbortCompatibility();
  const caller = new AbortController();
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  }));
  const request = fetchDay({ variant: "compact", signal: caller.signal });
  setTimeout(() => caller.abort(new DOMException("Stopped.", "AbortError")), 10);
  await expect(request).rejects.toMatchObject({ name: "AbortError" });
});

it("can validate the device session on WebKit without AbortSignal.timeout", async () => {
  vi.stubGlobal("AbortSignal", {});
  installRequestAbortCompatibility();
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ role: "employee" })));
  expect(await apiRequest("/api/work-os/session")).toEqual({ role: "employee" });
});

it("still ends an unanswered request at its deadline", async () => {
  vi.useFakeTimers();
  try {
    vi.stubGlobal("AbortSignal", {});
    installRequestAbortCompatibility();
    let aborted = false;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => { aborted = true; reject(init.signal?.reason); });
    }));
    const request = apiRequest("/api/work-os/session");
    const assertion = expect(request).rejects.toMatchObject({ status: null });
    await vi.advanceTimersByTimeAsync(20_001);
    await assertion;
    expect(aborted).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

it("combines a caller's cancellation with the request deadline", async () => {
  vi.stubGlobal("AbortSignal", {});
  installRequestAbortCompatibility();
  const caller = new AbortController();
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  }));
  const request = apiRequest("/api/work-os/session", { signal: caller.signal });
  setTimeout(() => caller.abort(new DOMException("Stopped.", "AbortError")), 10);
  await expect(request).rejects.toMatchObject({ name: "AbortError" });
});
