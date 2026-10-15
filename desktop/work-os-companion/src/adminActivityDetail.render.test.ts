import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ActivityDetailDrawer,
  activityKindLabel,
  activityRecordFromOverview,
  activityRecordFromUpdate,
  activitySectionAction,
  updateText,
  type ActivityDetailRecord,
} from "./admin/ActivityDetail";
import type { AdminOverviewActivity } from "./admin/types";

const AT = new Date(Date.now() - 125_000).toISOString();

describe("administration activity detail", () => {
  it("normalizes an overview activity row into the full record", () => {
    const item: AdminOverviewActivity = {
      id: "report:r-2",
      kind: "eod_submitted",
      at: AT,
      personId: "p-1",
      personName: "Amara Okafor",
      title: "EOD report submitted",
      detail: "Awaiting review",
      provenance: "pending review",
    };
    const record = activityRecordFromOverview(item);
    expect(record).toMatchObject({
      kind: "eod_submitted",
      personId: "p-1",
      personName: "Amara Okafor",
      title: "EOD report submitted",
      detail: "Awaiting review",
      provenance: "pending review",
    });
  });

  it("finds an update's text across recorded shapes", () => {
    expect(updateText({ input_text: "live column" })).toBe("live column");
    expect(updateText({ summary: "legacy summary" })).toBe("legacy summary");
    expect(updateText({ update_text: "  " })).toBeNull();
    expect(updateText({ text: "loose payload" })).toBe("loose payload");
    expect(updateText({})).toBeNull();
  });

  it("titles a person's update from its recorded kind", () => {
    const record = activityRecordFromUpdate(
      { id: "chk-1", update_kind: "blocked", substantive: false, input_text: "Waiting on staging credentials", occurred_at: AT, shift_date: "2026-10-14" },
      { id: "p-6", name: "Farid Haddad" },
      "r-4",
    );
    expect(record.title).toBe("Blocker raised");
    expect(record.detail).toBe("Waiting on staging credentials");
    expect(record.provenance).toBe("employee");
    expect(record.reportId).toBe("r-4");
    expect(record.facts).toContainEqual({ label: "Workday", value: "2026-10-14" });
    expect(record.facts).toContainEqual({ label: "Substantive", value: "No — routine check-in" });
  });

  it("degrades sparse rows without undefined copy", () => {
    const sparse = activityRecordFromUpdate({}, { id: "p-9", name: null });
    expect(sparse.title).toBe("Check-in");
    expect(sparse.detail).toBeNull();
    expect(sparse.at).toBeNull();
    expect(activityKindLabel(null)).toBe("Activity");
    const markup = renderToStaticMarkup(createElement(ActivityDetailDrawer, { record: sparse, onClose: () => undefined }));
    expect(markup).not.toContain("undefined");
    expect(markup).toContain("Unmapped person");
    expect(markup).toContain("No further detail was recorded");
    expect(markup).toContain('role="dialog"');
  });

  it("maps kinds onto the section that owns them and nothing else", () => {
    expect(activitySectionAction("task_completed")).toMatchObject({ label: "Open tasks", section: "tasks" });
    expect(activitySectionAction("evidence")).toMatchObject({ label: "Open evidence", section: "evidence" });
    expect(activitySectionAction("eod_submitted")).toMatchObject({ label: "Open EOD review", section: "review" });
    expect(activitySectionAction("recap")).toMatchObject({ label: "Open activity recaps", section: "evidence" });
    expect(activitySectionAction("recap")?.focus).toEqual({ evidenceTab: "recaps" });
    // A recorded update has no section destination; no fake action appears.
    expect(activitySectionAction("update")).toBeNull();
  });

  it("renders the full record: kind, person, avatar, provenance, time, and actions", () => {
    const record: ActivityDetailRecord = {
      id: "update:x",
      kind: "update",
      at: AT,
      personId: "p-1",
      personName: "Amara Okafor",
      title: "Progress update",
      detail: "Drafted the settings information architecture.",
      provenance: "employee",
      facts: [{ label: "Substantive", value: "Yes — recorded as progress" }],
      reportId: "r-2",
    };
    const markup = renderToStaticMarkup(createElement(ActivityDetailDrawer, {
      record,
      onClose: () => undefined,
      onOpenPerson: () => undefined,
      onOpenReport: () => undefined,
    }));
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("Progress update");
    expect(markup).toContain("Amara Okafor");
    expect(markup).toContain(">AO<");
    expect(markup).toContain("Provenance: Employee");
    expect(markup).toContain("Provenance</span><b>Employee");
    expect(markup).toContain("Recorded");
    expect(markup).toContain("Open Amara Okafor");
    expect(markup).toContain("Open EOD review");
    expect(markup).toContain("Drafted the settings information architecture.");
    expect(markup).toContain("Yes — recorded as progress");
    expect(markup).not.toContain("undefined");
  });

  it("offers the kind's section action only when the caller can navigate", () => {
    const record = activityRecordFromOverview({
      id: "a-3",
      kind: "evidence",
      at: AT,
      personId: null,
      personName: null,
      title: "Pull request opened",
      detail: "wrazy/agent-os #482",
      provenance: "github",
    });
    const withoutNav = renderToStaticMarkup(createElement(ActivityDetailDrawer, { record, onClose: () => undefined }));
    expect(withoutNav).not.toContain("Open evidence");
    expect(withoutNav).toContain("Workspace");
    const withNav = renderToStaticMarkup(createElement(ActivityDetailDrawer, { record, onClose: () => undefined, onOpenSection: () => undefined }));
    expect(withNav).toContain("Open evidence");
    expect(withNav).toContain("Provenance: Github");
  });

  it("keeps the EOD action singular when a report action is also available", () => {
    const record: ActivityDetailRecord = {
      id: "report:r-2",
      kind: "eod_submitted",
      at: AT,
      personId: "p-1",
      personName: "Amara Okafor",
      title: "EOD report submitted",
      detail: null,
      provenance: "pending review",
      reportId: "r-2",
    };
    const markup = renderToStaticMarkup(createElement(ActivityDetailDrawer, {
      record,
      onClose: () => undefined,
      onOpenReport: () => undefined,
      onOpenSection: () => undefined,
    }));
    expect(markup.match(/Open EOD review/g)).toHaveLength(1);
  });
});
