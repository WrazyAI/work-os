import { describe, expect, it } from "vitest";
import {
  buildCoverageRows,
  buildDateRange,
  coverageCell,
  coverageLevel,
  evidenceActor,
  evidenceAssignee,
  evidenceAutomation,
  evidenceDuration,
  evidenceOccurrence,
  evidencePerson,
  evidenceRelationLabel,
  evidenceStatus,
  evidenceStatusMix,
  evidenceWhoNote,
  groupEvidenceDays,
  groupEvidenceEntries,
} from "./evidenceModel";
import type { EvidenceRow, EvidenceSummary } from "./types";

function row(overrides: Partial<EvidenceRow> = {}): EvidenceRow {
  return {
    id: "row-1",
    person_id: "p1",
    task_id: null,
    evidence_date: "2026-11-16",
    source: "ghl",
    title: "Call outbound",
    summary: "Call outbound with status completed.",
    url: null,
    metrics: null,
    created_at: "2026-11-16T18:00:00.000Z",
    recorded_at: "2026-11-16T09:00:00.000Z",
    person: { id: "p1", display_name: "Aden Badon" },
    event: { correction_status: "original", evidence_class: "output_evidence", metadata: {} },
    ...overrides,
  };
}

function call(minute: number, status = "completed", hour = 9): EvidenceRow {
  return row({
    id: `call-${hour}-${minute}-${status}`,
    recorded_at: `2026-11-16T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`,
    summary: `Call outbound with status ${status}.`,
  });
}

describe("evidence grouping", () => {
  it("groups repeated calls by hour and keeps the email as an individual entry", () => {
    const rows = [
      ...Array.from({ length: 13 }, (_, index) => call(index)),
      row({
        id: "email-1",
        title: "Email sent",
        summary: "Email sent recorded by GHL.",
        recorded_at: "2026-11-16T13:05:00",
        created_at: "2026-11-16T18:05:00.000Z",
      }),
      call(0, "completed", 13),
    ];
    const entries = groupEvidenceEntries("2026-11-16", rows);
    expect(entries).toHaveLength(3);
    expect(entries[0].type).toBe("group");
    if (entries[0].type === "group") expect(entries[0].rows).toHaveLength(13);
    expect(entries[1].type).toBe("group");
    if (entries[1].type === "group") expect(entries[1].hour).toBe(13);
    expect(entries[2].type).toBe("event");
    if (entries[2].type === "event") expect(entries[2].row.title).toBe("Email sent");
  });

  it("orders by provider occurrence time and groups days newest first", () => {
    const older = row({ id: "older", evidence_date: "2026-11-15", recorded_at: "2026-11-15T10:00:00" });
    const newer = row({ id: "newer", evidence_date: "2026-11-16", recorded_at: "2026-11-16T10:00:00" });
    expect(evidenceOccurrence(older)).toContain("2026-11-15T10:00:00");
    expect(groupEvidenceDays([older, newer]).map((day) => day.date)).toEqual(["2026-11-16", "2026-11-15"]);
  });

  it("summarizes a group's status mix without inventing a completed count", () => {
    const rows = [
      ...Array.from({ length: 11 }, () => call(1, "completed")),
      call(2, "no-answer"),
      call(3, "busy"),
    ];
    expect(evidenceStatusMix(rows)).toBe("11 completed · 1 no answer · 1 busy");
    expect(evidenceStatus(rows[11])).toEqual({ label: "No answer", tone: "quiet" });
  });
});

describe("evidence attribution", () => {
  it("does not turn an assigned-only owner into the actor", () => {
    const assigned = row({
      person: null,
      ghl: {
        relation: "assigned_only",
        actorLabel: "Actor unknown",
        assigneeLabels: ["Kalia Bell"],
      },
      title: "Opportunity open",
      summary: "Opportunity state recorded by GHL.",
    });
    expect(evidencePerson(assigned)).toEqual({ name: "Kalia Bell", note: "Assigned only", tone: "context" });
    expect(evidenceActor(assigned)).toBe("Actor unknown");
    expect(evidenceAssignee(assigned)).toBe("Kalia Bell");
    expect(evidenceAutomation(assigned)).toBe(false);
  });

  it("does not call a mapped inbound performer an unknown actor", () => {
    const inbound = row({ title: "Call inbound", summary: "Call inbound with status completed.", ghl: { relation: "performed", actorLabel: "Aden Badon", assigneeLabels: [] } });
    expect(evidenceActor(inbound)).toBe("Aden Badon");
    expect(evidenceWhoNote(inbound)).toContain("The actor is who the provider says");
  });

  it("keeps automation out of employee attribution", () => {
    const automated = row({
      person: null,
      ghl: { relation: "automation", actorLabel: "Automation — not the employee", assigneeLabels: [] },
      title: "Text message sent",
      summary: "Text message sent recorded by GHL.",
    });
    expect(evidencePerson(automated)).toEqual({ name: "Automation", note: "Not the employee", tone: "unknown" });
    expect(evidenceActor(automated)).toBe("Automation — not the employee");
    expect(evidenceAutomation(automated)).toBe(true);
  });

  it("keeps a linked GHL row attributed to its mapped performer", () => {
    const linked = row({ ghl: null, event: { metadata: { ghl: { relation: "performed" } } } });
    expect(evidenceRelationLabel(linked)).toBe("Performed by actor");
    expect(evidenceActor(linked)).toBe("Aden Badon");
    expect(evidenceAutomation(linked)).toBe(false);
  });

  it("reads the provider duration when it exists", () => {
    const withDuration = row({ event: { metadata: { ghl: { durationSeconds: 252 } } } });
    expect(evidenceDuration(withDuration)).toBe("4m 12s");
    expect(evidenceStatus(withDuration)).toEqual({ label: "Completed", tone: "observed" });
    expect(evidenceStatus({ ...withDuration, summary: "Call outbound with status no-answer." })).toEqual({ label: "No answer", tone: "quiet" });
  });
});

describe("coverage model", () => {
  const summary: EvidenceSummary = {
    sources: [{ source: "ghl", count: 107 }],
    days: [{ date: "2026-11-16", count: 102 }],
    coverage: {
      people: [
        { personId: "p1", days: [{ date: "2026-11-16", count: 102, emails: 1 }] },
        { personId: null, days: [{ date: "2026-11-16", count: 5, emails: 0 }] },
      ],
    },
  };

  it("builds named and uncredited rows with truthful labels", () => {
    const rows = buildCoverageRows(summary, [{ id: "p1", display_name: "Aden Badon" }], ["2026-11-16"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ personId: "p1", name: "Aden Badon", total: 102, emails: 1 });
    expect(rows[1]).toMatchObject({ personId: null, name: "Not employee work", total: 5, emails: 0 });
    expect(coverageCell(rows[0], "2026-11-16")).toEqual({ count: 102, emails: 1 });
  });

  it("uses stable density steps and bounded date ranges", () => {
    expect(coverageLevel(0)).toBe(0);
    expect(coverageLevel(9)).toBe(1);
    expect(coverageLevel(10)).toBe(2);
    expect(coverageLevel(50)).toBe(3);
    expect(coverageLevel(100)).toBe(4);
    expect(buildDateRange("2026-11-07", "2026-11-20")).toHaveLength(14);
    expect(buildDateRange("bad", "2026-11-20")).toEqual([]);
  });
});
