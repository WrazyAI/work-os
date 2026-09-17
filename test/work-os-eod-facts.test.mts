import assert from "node:assert/strict";
import { test } from "node:test";
import {
  automationName,
  clipText,
  collapseAutomation,
  factLine,
  formatLocalTime,
  formatReportDate,
  groupActivityFrames,
  humanizeGoalSource,
  progressedFacts,
  unplannedFacts,
} from "../src/lib/work-os-eod-facts";
import { capFactLines } from "../src/lib/work-os-eod";

test("only agent routine titles are treated as automation", () => {
  assert.equal(automationName("Run me-context-update routine (2026-09-17, Codex rerun)"), "me-context-update");
  assert.equal(automationName("Run me-context-update routine — 2026-08-16"), "me-context-update");
  assert.equal(automationName("Run morning-signal routine (2026-09-17)"), "morning-signal");
  assert.equal(automationName("Review latest Work OS worktree changes"), null);
  assert.equal(automationName("Run the deployment checklist"), null);
});

test("routine runs collapse into one automation line", () => {
  const collapsed = collapseAutomation([
    "Run me-context-update routine (2026-09-17)",
    "Run me-context-update routine — 2026-08-16",
    "Run me-context-update routine (2026-09-17, latest run)",
    "Run morning-signal routine (2026-09-17)",
    "Confirm Acme emergency service claims",
  ]);
  assert.equal(collapsed.count, 4);
  assert.equal(collapsed.line, "- Automation runs (4): me-context-update ×3, morning-signal ×1");
  assert.deepEqual(collapseAutomation([]), { count: 0, line: null });
  assert.deepEqual(collapseAutomation(["Confirm Acme emergency service claims"]), { count: 0, line: null });
});

test("summaries clip at a word boundary with an explicit ellipsis", () => {
  assert.equal(clipText("A short summary.", 40), "A short summary.");
  const clipped = clipText("The screenshot visibly shows several overlapping dark-themed application windows and a task panel on the right", 40);
  assert.ok(clipped.endsWith("…"), clipped);
  assert.ok(!clipped.includes("overlapping dark-themed application windows and"), clipped);
  assert.ok(clipped.length <= 41, String(clipped.length));
  assert.equal(clipText("word ".repeat(60), 20), "word word word word…");
});

test("times render in the employee timezone and report dates are human", () => {
  assert.equal(formatLocalTime("2026-09-17T14:05:00Z", "Europe/Amsterdam"), "16:05");
  assert.equal(formatLocalTime("2026-09-17T14:05:00Z", "UTC"), "14:05");
  assert.equal(formatLocalTime(null, "UTC"), null);
  assert.equal(formatReportDate("2026-09-17"), "September 17, 2026");
  assert.equal(factLine({ title: "Confirm Acme emergency service claims", at: "2026-09-17T15:03:54Z" }, "UTC", "completed"), "- Confirm Acme emergency service claims — completed 15:03");
  assert.equal(factLine({ title: "Refine the WorkOS design direction" }, "UTC"), "- Refine the WorkOS design direction");
});

test("goal provenance is humanized instead of leaking enum values", () => {
  assert.equal(humanizeGoalSource("ai_draft"), "AI draft");
  assert.equal(humanizeGoalSource("employee"), "Employee");
  assert.equal(humanizeGoalSource("accepted_suggestion"), "Accepted suggestion");
  assert.equal(humanizeGoalSource(null), "Not recorded");
});

test("unplanned work is creations outside the plan, never automation", () => {
  const events = [
    { id: "e1", task_id: "t1", event_type: "creation_observed", task_snapshot: { title: "Fix Tasks page layout" }, exact_at: "2026-09-17T16:20:00Z" },
    { id: "e2", task_id: "t2", event_type: "creation_observed", task_snapshot: { title: "Refine the WorkOS design direction" }, exact_at: "2026-09-17T15:01:00Z" },
    { id: "e3", task_id: "t3", event_type: "creation_observed", task_snapshot: { title: "Run morning-signal routine (2026-09-17)" }, exact_at: "2026-09-17T15:23:00Z" },
    { id: "e4", task_id: "t1", event_type: "creation_observed", task_snapshot: { title: "Fix Tasks page layout" }, exact_at: "2026-09-17T16:20:01Z" },
    { id: "e5", task_id: "t5", event_type: "completed", task_snapshot: { title: "Anything" }, exact_at: "2026-09-17T17:00:00Z" },
  ];
  const lines = unplannedFacts(events, new Set(["t2"]), "UTC");
  assert.deepEqual(lines.map((line) => line.title), ["Fix Tasks page layout"]);
  assert.equal(lines[0].at, "2026-09-17T16:20:00Z");
});

test("progress updates exclude blockers and unplanned notes and sort by time", () => {
  const lines = progressedFacts([
    { id: "u2", update_kind: "completion_claim", input_text: "Finished the changelog", occurred_at: "2026-09-17T12:00:00Z" },
    { id: "u1", update_kind: "blocked", input_text: "Waiting on access", occurred_at: "2026-09-17T10:00:00Z" },
    { id: "u3", update_kind: "unplanned_work", input_text: "Side quest", occurred_at: "2026-09-17T13:00:00Z" },
    { id: "u4", update_kind: "priority_change", input_text: "Picked up the Windows fix", occurred_at: "2026-09-17T11:00:00Z" },
  ], "UTC");
  assert.deepEqual(lines.map((line) => line.title), ["Picked up the Windows fix", "Finished the changelog"]);
});

test("activity frames group by app with a time range and two highlights", () => {
  const groups = groupActivityFrames([
    { capturedAt: "2026-09-17T09:12:00Z", visibleApp: "Google Chrome", summary: "A browser shows the changelog file." },
    { capturedAt: "2026-09-17T14:05:00Z", visibleApp: "Google Chrome", summary: "A component gallery lists header cards." },
    { capturedAt: "2026-09-17T16:40:00Z", visibleApp: "Google Chrome", summary: "A Loom page plays the updates video." },
    { capturedAt: "2026-09-17T10:02:00Z", visibleApp: "VS Code", summary: "An editor shows the EOD composer." },
    { capturedAt: "2026-09-17T11:00:00Z", visibleApp: null, summary: "Unclear window." },
  ]);
  assert.equal(groups[0].app, "Google Chrome");
  assert.equal(groups[0].count, 3);
  assert.equal(groups[0].firstAt, "2026-09-17T09:12:00Z");
  assert.equal(groups[0].lastAt, "2026-09-17T16:40:00Z");
  assert.equal(groups[0].highlights.length, 2);
  assert.equal(groups[1].app, "VS Code");
  assert.equal(groups[2].app, "Unclear context");
});

test("fact lists cap with a pointer to the full record", () => {
  const capped = capFactLines(Array.from({ length: 27 }, (_, index) => `- line ${index + 1}`), 25);
  assert.equal(capped.length, 26);
  assert.equal(capped[25], "- …and 2 more (see the full record)");
  assert.equal(capFactLines(["- one"], 25).length, 1);
});
