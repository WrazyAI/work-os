import { describe, expect, it } from "vitest";
import {
  adminAttentionActionLabel,
  adminAttentionEvent,
  dismissAdminAttention,
  eodAttentionFromOverview,
  isAdminAttentionDismissed,
  parseAdminAttentionEvent,
  parseAdminAttentionDismissals,
  parseAdminAttentionSeen,
  recapAttentionItem,
  shouldAutoSwitchWorkspace,
  type AdminAttentionItem,
} from "./attention";
import type { AdminOverview } from "../admin/types";

function overview(input: {
  generatedAt?: string;
  date?: string;
  activity?: AdminOverview["recentActivity"];
} = {}): AdminOverview {
  return {
    date: input.date ?? "2026-11-18",
    generatedAt: input.generatedAt ?? "2026-11-18T17:00:00.000Z",
    counts: {
      people: 3, onShift: 2, paused: 0, offShift: 1, unknown: 0,
      updatesToday: 4, substantiveUpdatesToday: 3,
      recapsToday: 2, recapsReviewedToday: 1, tasksCompletedToday: 1, tasksOpen: 5,
      tasksOverdue: 0, evidenceToday: 1, evidenceActivityToday: 1, evidenceOutputToday: 0,
      reportsDraftedToday: 1, reportsSubmittedToday: 1, reportsPendingReview: 1,
      pendingReviewOldestAt: "2026-11-18T16:00:00.000Z", eodOutstandingPeople: 0,
      eodOutstandingDays: 0, disputedEvidence: 0,
    },
    people: [],
    recentActivity: input.activity ?? [],
    attention: [],
    series: [],
    timeSeries: [],
    freshness: {
      niftySyncedAt: null, niftyTasksToday: 0, worktivityObservedAt: null,
      githubLastEventAt: null, githubEventsToday: 0, lastPlanAt: null, lastReportSubmittedAt: null,
    },
    readiness: null,
  };
}

const submitted = (id: string, at: string, personName = "Maya Chen", personId = "person-1"): AdminOverview["recentActivity"][number] => ({
  id, kind: "eod_submitted", at, personId, personName, title: "Submitted an EOD report", detail: null, provenance: null,
});

describe("admin attention from an overview", () => {
  it("seeds the first read so opening the app never announces old reports", () => {
    const first = eodAttentionFromOverview(overview({ activity: [submitted("e1", "2026-11-18T16:00:00.000Z")] }), null);
    expect(first.item).toBeNull();
    expect(first.seen.ids).toEqual(["e1"]);
    expect(first.seen.watermark).toBe("2026-11-18T16:00:00.000Z");
  });

  it("announces a report that lands after the stored watermark", () => {
    const previous = { scope: "user-1:org-1", day: "2026-11-18", watermark: "2026-11-18T16:00:00.000Z", ids: ["e1"] };
    const next = overview({
      activity: [
        submitted("e1", "2026-11-18T16:00:00.000Z"),
        submitted("e2", "2026-11-18T16:30:00.000Z", "Jordan Lee", "person-2"),
      ],
    });
    const result = eodAttentionFromOverview(next, previous);
    expect(result.item?.kind).toBe("eod_submitted");
    expect(result.item?.count).toBe(1);
    expect(result.item?.body).toContain("Jordan Lee");
    expect(result.item?.section).toBe("review");
    expect(result.item?.personId).toBe("person-2");
    expect(result.seen.ids).toEqual(["e1", "e2"]);
    expect(result.seen.watermark).toBe("2026-11-18T16:30:00.000Z");
  });

  it("groups simultaneous submissions into one counted item", () => {
    const previous = { scope: "user-1:org-1", day: "2026-11-18", watermark: "2026-11-18T16:00:00.000Z", ids: ["e1"] };
    const result = eodAttentionFromOverview(overview({
      activity: [
        submitted("e2", "2026-11-18T16:20:00.000Z", "Maya Chen", "person-1"),
        submitted("e3", "2026-11-18T16:30:00.000Z", "Jordan Lee", "person-2"),
      ],
    }), previous);
    expect(result.item?.count).toBe(2);
    expect(result.item?.title).toBe("2 EOD reports submitted");
    expect(result.item?.body).toContain("Maya Chen and Jordan Lee");
    expect(result.item?.personId).toBeNull();
  });

  it("does not re-announce an id already seen even when its timestamp is newer", () => {
    const previous = { scope: "user-1:org-1", day: "2026-11-18", watermark: "2026-11-18T15:00:00.000Z", ids: ["e2"] };
    const result = eodAttentionFromOverview(overview({ activity: [submitted("e2", "2026-11-18T16:30:00.000Z")] }), previous);
    expect(result.item).toBeNull();
    expect(result.seen.watermark).toBe("2026-11-18T16:30:00.000Z");
  });

  it("ignores a report older than the catch-up window", () => {
    const previous = { scope: "user-1:org-1", day: "2026-11-18", watermark: "2026-11-16T09:00:00.000Z", ids: [] };
    const result = eodAttentionFromOverview(overview({
      generatedAt: "2026-11-18T17:00:00.000Z",
      activity: [submitted("old", "2026-11-16T10:00:00.000Z")],
    }), previous);
    expect(result.item).toBeNull();
  });

  it("parses a saved baseline and rejects malformed values", () => {
    expect(parseAdminAttentionSeen({ scope: "u:o", day: "2026-11-18", watermark: null, ids: ["e1"] }))
      .toEqual({ scope: "u:o", day: "2026-11-18", watermark: null, ids: ["e1"] });
    expect(parseAdminAttentionSeen({ scope: "u:o", day: "2026-11-18", watermark: "not-a-date", ids: [] })).toBeNull();
    expect(parseAdminAttentionSeen({ scope: "u:o", day: "2026-11-18", watermark: null, ids: [1] })).toBeNull();
  });
});

describe("reviewed recap attention", () => {
  it("names the count and the inbox destination", () => {
    const item = recapAttentionItem({ count: 2, eventIds: ["a", "b"], at: "2026-11-18T16:00:00.000Z" });
    expect(item.kind).toBe("recap_reviewed");
    expect(item.title).toBe("Reviewed recaps are ready");
    expect(item.body).toContain("2 recaps");
    expect(item.section).toBe("recaps");
    expect(adminAttentionActionLabel(item)).toBe("View recaps");
  });

  it("keeps the same id for the same delivery group and changes for a newer one", () => {
    const first = recapAttentionItem({ count: 1, eventIds: ["a"], at: "2026-11-18T16:00:00.000Z" });
    const same = recapAttentionItem({ count: 1, eventIds: ["a"], at: "2026-11-18T16:00:00.000Z" });
    const newer = recapAttentionItem({ count: 1, eventIds: ["b"], at: "2026-11-18T16:05:00.000Z" });
    expect(first.id).toBe(same.id);
    expect(newer.id).not.toBe(first.id);
  });
});

describe("admin attention dismissal", () => {
  const item: AdminAttentionItem = {
    id: "eod:2026-11-18T16:30:00.000Z", kind: "eod_submitted", count: 1,
    title: "EOD report submitted", body: "Maya's report is waiting for your review.",
    section: "review", personId: "person-1", at: "2026-11-18T16:30:00.000Z",
  };

  it("is scoped to the workday and the exact event", () => {
    const store = dismissAdminAttention(null, item, "2026-11-18");
    expect(isAdminAttentionDismissed(store, item, "2026-11-18")).toBe(true);
    expect(isAdminAttentionDismissed(store, item, "2026-11-19")).toBe(false);
    expect(isAdminAttentionDismissed(store, { ...item, id: "eod:later" }, "2026-11-18")).toBe(false);
  });

  it("resets when the day changes", () => {
    const store = dismissAdminAttention({ day: "2026-11-17", ids: ["old"] }, item, "2026-11-18");
    expect(store).toEqual({ day: "2026-11-18", ids: [item.id] });
    expect(parseAdminAttentionDismissals(store)).toEqual(store);
  });
});

describe("auto-switch decisions", () => {
  it("moves only to the other available workspace", () => {
    expect(shouldAutoSwitchWorkspace({ current: "employee", target: "admin", available: true })).toBe(true);
    expect(shouldAutoSwitchWorkspace({ current: "admin", target: "admin", available: true })).toBe(false);
    expect(shouldAutoSwitchWorkspace({ current: "employee", target: "admin", available: false })).toBe(false);
    expect(shouldAutoSwitchWorkspace({ current: "admin", target: "employee", available: true })).toBe(true);
  });

  it("never moves for the state that was already waiting at launch", () => {
    expect(shouldAutoSwitchWorkspace({ current: "admin", target: "employee", available: true, firstObservation: true })).toBe(false);
    expect(shouldAutoSwitchWorkspace({ current: "employee", target: "admin", available: true, firstObservation: true })).toBe(false);
  });
});

describe("admin attention transport", () => {
  const scope = { userId: "user-1", organizationId: "org-1", mode: "admin" as const };
  const item: AdminAttentionItem = {
    id: "eod:2026-11-18T16:30:00.000Z", kind: "eod_submitted", count: 1,
    title: "EOD report submitted", body: "Maya's report is waiting for your review.",
    section: "review", personId: "person-1", at: "2026-11-18T16:30:00.000Z",
  };

  it("rebuilds a sanitized admin-scope event", () => {
    const event = adminAttentionEvent({ ...scope, mode: "employee" }, 4, item);
    expect(event.scope.mode).toBe("admin");
    expect(event.epoch).toBe(4);
    expect(parseAdminAttentionEvent(event)).toEqual(event);
  });

  it("accepts a null item to clear the companion surface", () => {
    const event = adminAttentionEvent(scope, 2, null);
    expect(parseAdminAttentionEvent(event)?.item).toBeNull();
  });

  it("rejects employee scope, bad epochs, and unknown kinds", () => {
    expect(parseAdminAttentionEvent({ scope: { ...scope, mode: "employee" }, epoch: 1, item })).toBeNull();
    expect(parseAdminAttentionEvent({ scope, epoch: 0, item })).toBeNull();
    expect(parseAdminAttentionEvent({ scope, epoch: 1, item: { ...item, kind: "task" } })).toBeNull();
    expect(parseAdminAttentionEvent({ scope, epoch: 1, item: { ...item, title: 4 } })).toBeNull();
  });
});
