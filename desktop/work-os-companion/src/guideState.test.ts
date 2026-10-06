import { describe, expect, it } from "vitest";
import * as guideStateModule from "./guideState";
import { EMPTY_GUIDE_STATE, GUIDE_VIEWS, decideGuideOpen, guideAutoOpens, isGuideView, normalizeGuideState, reconcileGuideState, type CachedGuideState, type GuideState, type GuideView } from "./guideState";

const org = "org-1";

function cache(state: CachedGuideState["state"], pendingAutoOpen: boolean | null = null, organizationId = org): CachedGuideState {
  return { organizationId, savedAt: "2026-10-06T10:00:00.000Z", state, pendingAutoOpen };
}

type GuideStateModuleWithLifecycle = typeof guideStateModule & {
  markGuideSeen?: (state: GuideState, view: GuideView, seenAt: string) => GuideState;
  mergeGuideServerState?: (current: GuideState, incoming: GuideState, pendingAutoOpen: boolean | null) => GuideState;
};

const lifecycle = guideStateModule as GuideStateModuleWithLifecycle;

describe("page guide state", () => {
  it("normalizes malformed payloads to the historical default", () => {
    expect(normalizeGuideState(null)).toEqual({ guides: {}, autoOpen: true });
    expect(normalizeGuideState("nope")).toEqual({ guides: {}, autoOpen: true });
    expect(normalizeGuideState({ guides: { day: "2026-10-06T10:00:00.000Z", evidence: "x", tasks: 7, review: " " }, autoOpen: "off" }))
      .toEqual({ guides: { day: "2026-10-06T10:00:00.000Z" }, autoOpen: true });
  });

  it("treats only the five workspace pages as guided", () => {
    expect([...GUIDE_VIEWS]).toEqual(["day", "tasks", "review", "insights", "settings"]);
    expect(isGuideView("day")).toBe(true);
    expect(isGuideView("evidence")).toBe(false);
  });

  it("auto-opens only an unseen guide while automatic guides are on", () => {
    expect(guideAutoOpens(EMPTY_GUIDE_STATE, "tasks")).toBe(true);
    expect(guideAutoOpens({ guides: { tasks: "2026-10-06T10:00:00.000Z" }, autoOpen: true }, "tasks")).toBe(false);
    expect(guideAutoOpens({ guides: {}, autoOpen: false }, "tasks")).toBe(false);
  });

  it("spends one chance per page visit and never ambushes a blocked screen", () => {
    const base = {
      enabled: true,
      trusted: true,
      activeView: "tasks" as const,
      evaluatedView: null as string | null,
      blocked: false,
      state: EMPTY_GUIDE_STATE,
    };
    expect(decideGuideOpen(base)).toEqual({ action: "schedule", view: "tasks" });
    expect(decideGuideOpen({ ...base, blocked: true })).toEqual({ action: "skip" });
    expect(decideGuideOpen({ ...base, state: { guides: { tasks: "seen" }, autoOpen: true } })).toEqual({ action: "skip" });
    expect(decideGuideOpen({ ...base, state: { guides: {}, autoOpen: false } })).toEqual({ action: "skip" });
    expect(decideGuideOpen({ ...base, evaluatedView: "tasks" })).toEqual({ action: "wait" });
    expect(decideGuideOpen({ ...base, trusted: false })).toEqual({ action: "wait" });
    expect(decideGuideOpen({ ...base, enabled: false })).toEqual({ action: "wait" });
    expect(decideGuideOpen({ ...base, activeView: null })).toEqual({ action: "wait" });
    expect(decideGuideOpen({ ...base, activeView: "insights", evaluatedView: "tasks" })).toEqual({ action: "schedule", view: "insights" });
  });

  it("acknowledges a dismissed guide once and preserves its first seen timestamp", () => {
    expect(lifecycle.markGuideSeen).toBeTypeOf("function");
    const once = lifecycle.markGuideSeen!(EMPTY_GUIDE_STATE, "insights", "2026-10-06T10:00:00.000Z");
    const twice = lifecycle.markGuideSeen!(once, "insights", "2026-10-06T10:05:00.000Z");
    expect(twice).toEqual({
      guides: { insights: "2026-10-06T10:00:00.000Z" },
      autoOpen: true,
    });
    expect(guideAutoOpens(twice, "insights")).toBe(false);
  });

  it("never lets an older server response erase a local seen mark or pending guide preference", () => {
    expect(lifecycle.mergeGuideServerState).toBeTypeOf("function");
    const current: GuideState = {
      guides: {
        day: "2026-10-06T10:00:00.000Z",
        tasks: "2026-10-06T10:01:00.000Z",
      },
      autoOpen: false,
    };
    const staleServer: GuideState = {
      guides: { day: "2026-10-06T10:00:00.000Z" },
      autoOpen: true,
    };
    expect(lifecycle.mergeGuideServerState!(current, staleServer, false)).toEqual(current);
  });



  it("does not let a stale mutation response change the current auto-open preference", () => {
    expect(lifecycle.mergeGuideServerState).toBeTypeOf("function");
    const current: GuideState = {
      guides: { day: "2026-10-06T10:00:00.000Z" },
      autoOpen: false,
    };
    const staleServer: GuideState = {
      guides: { day: "2026-10-06T10:00:00.000Z" },
      autoOpen: true,
    };
    expect(lifecycle.mergeGuideServerState!(current, staleServer, null).autoOpen).toBe(false);
  });
  it("re-pushes local seen marks the server never stored", () => {
    const server = { guides: { day: "2026-10-06T09:00:00.000Z" }, autoOpen: true };
    const local = cache({ guides: { day: "2026-10-06T09:00:00.000Z", tasks: "2026-10-06T09:30:00.000Z" }, autoOpen: true });
    const reconciled = reconcileGuideState(server, local, org);
    expect(reconciled.state.guides).toEqual({ day: "2026-10-06T09:00:00.000Z", tasks: "2026-10-06T09:30:00.000Z" });
    expect(reconciled.pushGuides).toEqual(["tasks"]);
    expect(reconciled.pushAutoOpen).toBeNull();
  });

  it("ignores a cache from another account on this device", () => {
    const server = { guides: {}, autoOpen: true };
    const reconciled = reconcileGuideState(server, cache({ guides: { day: "2026-10-06T09:00:00.000Z" }, autoOpen: false }, true, "org-2"), org);
    expect(reconciled.state).toEqual(server);
    expect(reconciled.pushGuides).toEqual([]);
    expect(reconciled.pushAutoOpen).toBeNull();
  });

  it("retries an opt-out or opt-in that never reached the server", () => {
    const optedOut = reconcileGuideState({ guides: {}, autoOpen: true }, cache({ guides: {}, autoOpen: false }, false), org);
    expect(optedOut.state.autoOpen).toBe(false);
    expect(optedOut.pushAutoOpen).toBe(false);
    const optedIn = reconcileGuideState({ guides: {}, autoOpen: false }, cache({ guides: {}, autoOpen: true }, true), org);
    expect(optedIn.state.autoOpen).toBe(true);
    expect(optedIn.pushAutoOpen).toBe(true);
    const settled = reconcileGuideState({ guides: {}, autoOpen: false }, cache({ guides: {}, autoOpen: false }, null), org);
    expect(settled.pushAutoOpen).toBeNull();
  });
});
