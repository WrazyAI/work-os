import { describe, expect, it } from "vitest";
import { adminPreviewOverview } from "./adminFixtures";
import {
  adminNotificationActivity,
  adminNotificationDecisionCount,
  adminNotificationDecisions,
  adminNotificationPulse,
  emptyAdminNotificationOverview,
} from "./adminNotificationModel";
import type { AdminOverview } from "./types";

const NOW = Date.parse("2026-11-05T10:00:00.000Z");

function overview(overrides: Partial<AdminOverview> = {}): AdminOverview {
  return { ...adminPreviewOverview("dense"), ...overrides };
}

describe("admin notification decisions", () => {
  it("turns each live attention record into one destination-backed decision", () => {
    const rows = adminNotificationDecisions(overview(), NOW);
    expect(rows.map((row) => row.code)).toEqual([
      "reports_pending_review",
      "eod_outstanding",
      "tasks_overdue",
      "evidence_disputed",
    ]);
    expect(rows[0]).toMatchObject({
      title: "2 EOD reports are waiting for review.",
      count: 2,
      action: "Review",
      section: "review",
      severity: "warn",
    });
    expect(rows[0]?.meta).toContain("Oldest submitted");
    expect(rows[2]).toMatchObject({ section: "tasks", focus: { taskView: "open" } });
    expect(rows[3]).toMatchObject({ section: "evidence", severity: "error" });
  });

  it("accepts the earlier preview code spellings and unknown codes land somewhere real", () => {
    const fallback = overview({
      attention: [
        { code: "reports_pending", severity: "warn", count: 1, message: "1 report waiting.", href: "/work-os/admin/review" },
        { code: "disputed_evidence", severity: "error", count: 2, message: "2 items disputed.", href: "/work-os/admin/evidence" },
        { code: "new_record", severity: "info", count: 1, message: "One new record.", href: "/work-os/admin/people" },
        { code: "ignored_zero", severity: "info", count: 0, message: "Nothing here.", href: null },
      ],
    });
    const rows = adminNotificationDecisions(fallback, NOW);
    expect(rows.map((row) => row.code)).toEqual(["reports_pending_review", "evidence_disputed", "new_record"]);
    expect(rows[2]).toMatchObject({ section: "people", action: "Review", meta: "Needs an administrator decision." });
  });

  it("counts underlying records, not decision categories", () => {
    expect(adminNotificationDecisionCount(overview())).toBe(11);
    expect(adminNotificationDecisionCount(null)).toBe(0);
  });

  it("keeps the pulse line to the four live workspace measures", () => {
    expect(adminNotificationPulse(overview()).map((item) => item.label)).toEqual(["on shift", "recaps", "outcomes", "evidence"]);
    expect(adminNotificationPulse(null)).toEqual([]);
  });

  it("builds an empty notification record without disturbing the page record", () => {
    const full = overview();
    const empty = emptyAdminNotificationOverview(full);
    expect(adminNotificationDecisionCount(empty)).toBe(0);
    expect(adminNotificationActivity(empty)).toEqual([]);
    expect(full.attention).toHaveLength(4);
    expect(full.recentActivity.length).toBeGreaterThan(0);
  });
});

describe("admin notification activity", () => {
  it("maps each activity kind to the exact admin surface", () => {
    const rows = adminNotificationActivity(overview(), 6);
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get("a-1")).toMatchObject({ section: "tasks", focus: { personId: "p-2", taskView: "completed" } });
    expect(byId.get("a-2")).toMatchObject({ section: "people", focus: { personId: "p-1" } });
    expect(byId.get("a-3")).toMatchObject({ section: "evidence", focus: { personId: "p-3" } });
    expect(byId.get("a-4")).toMatchObject({ section: "review", focus: { personId: "p-2" } });
    expect(rows[0]?.time).toBeTruthy();
  });

  it("keeps a bounded newest-first slice and an honest empty list", () => {
    expect(adminNotificationActivity(overview(), 2)).toHaveLength(2);
    expect(adminNotificationActivity(overview(), 2)[0]?.id).toBe(overview().recentActivity[0]?.id);
    expect(adminNotificationActivity(null)).toEqual([]);
  });
});
