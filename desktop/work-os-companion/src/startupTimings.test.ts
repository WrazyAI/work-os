import { describe, expect, it } from "vitest";
import { createStartupTimings, startupWindowLabel } from "./bootTrace";

describe("startup measurements", () => {
  it("reports a bounded window label, phase and monotonic elapsed time once", () => {
    let now = 100;
    const events: unknown[] = [];
    const trace = createStartupTimings("avatar", () => now, event => events.push(event));
    now = 840;
    trace.mark("vault_wait", 200, true);
    trace.mark("vault_wait", 200, false);
    now = 900;
    trace.mark("content_frame");
    expect(events).toEqual([
      { window: "avatar", phase: "vault_wait", elapsedMs: 740, durationMs: 640, reused: true },
      { window: "avatar", phase: "content_frame", elapsedMs: 800, durationMs: 800 },
    ]);
  });
  it("never puts a query token, path or unknown label into timing metadata", () => {
    expect(startupWindowLabel("?window=avatar&token=private-fixture")).toBe("avatar");
    expect(startupWindowLabel("?window=/secret/path&token=private-fixture")).toBe("main");
    expect(startupWindowLabel("?window=debug")).toBe("debug");
  });
  it("diagnostic failure cannot fail boot", () => {
    const trace = createStartupTimings("main", () => 1, () => { throw new Error("unavailable"); });
    expect(() => trace.mark("cache_restore")).not.toThrow();
  });
});
