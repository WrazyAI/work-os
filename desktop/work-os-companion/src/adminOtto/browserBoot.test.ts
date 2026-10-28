import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
describe("browser session boot before React queries", () => {
  it("does not send any request from an offline fixture even with a saved token parameter", async () => {
    vi.stubGlobal("window", { location: { search: "?offline&token=fixture-only" } });
    const fetch = vi.fn(async () => new Response("{}")); vi.stubGlobal("fetch", fetch);
    const { secureState } = await import("../vault");
    await secureState.session();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("resolves an unmapped admin's organization through session, never employee day", async () => {
    vi.stubGlobal("window", { location: { search: "?token=fixture-only" } });
    const fetch = vi.fn<(url: string) => Promise<Response>>(async () => new Response(JSON.stringify({ userId: "admin", organizationId: "org", personId: null, role: "admin" })));
    vi.stubGlobal("fetch", fetch);
    const { secureState } = await import("../vault");
    expect((await secureState.session())?.organizationId).toBe("org");
    expect(fetch.mock.calls[0][0]).toMatch(/\/api\/work-os\/session$/);
  });
});
