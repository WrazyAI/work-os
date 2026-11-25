import assert from "node:assert/strict";
import test from "node:test";
import type { EodReportFacts } from "../src/lib/work-os-eod-report";
import { applyStructuredBrief, buildEodEvidenceGroups, buildEodSuggestions, composeStructuredEodMarkdown, assembleEodSummary } from "../src/lib/work-os-eod-structured";
import {
  cleanEodLines,
  eodCompositionIsComplete,
  eodCompositionSignature,
  eodEvidenceCount,
  eodSummaryIsCurrent,
  mergeEodComposition,
  normalizeEodStructuredReport,
  normalizeLoomShareUrl,
} from "../src/modules/work-os/eod-structured";

const facts: EodReportFacts = {
  date: "2026-11-24",
  personName: "Amara Okafor",
  timezone: "America/New_York",
  roleName: "Product Operations",
  goal: { text: "Close the Q4 reconciliation", provenance: "employee" },
  session: { clockedInAt: "2026-11-24T14:04:00.000Z", clockedOutAt: "2026-11-24T22:08:00.000Z" },
  completed: [
    { id: "task-1", title: "Reconcile the Q4 supplier ledger", project: "Ledger", at: "2026-11-24T21:12:00.000Z", exact: true, outsideLabel: null },
    { id: "task-2", title: "Ship the pricing model review", project: "Pricing", at: "2026-11-24T19:45:00.000Z", exact: true, outsideLabel: null },
  ],
  carried: [
    { id: "task-3", title: "Finalize the December close checklist", project: "Finance", at: null, exact: false, outsideLabel: null },
  ],
  automation: [],
  automationOutsideLabel: null,
  planItems: [
    { id: "plan-1", taskId: "task-1", kind: "outcome", title: "Reconcile the Q4 supplier ledger", disposition: "selected", completionState: "completed", blocker: null },
    { id: "plan-2", taskId: "task-3", kind: "outcome", title: "Finalize the December close checklist", disposition: "selected", completionState: "open", blocker: null },
  ],
  updates: [],
  blockers: [],
  recaps: [
    { label: "2:00–2:30 PM", headline: "Supplier scorecard v2", detail: "Waiting on legal review.", provenance: "confirmed", startIso: "2026-11-24T19:00:00.000Z", endIso: "2026-11-24T19:30:00.000Z" },
  ],
  hourly: [],
  github: {
    performed: { push: 3, pullRequest: 1, review: 0, issue: 0 },
    triggered: { workflowRun: 1, deployment: 0, pullRequest: 0, review: 0, issue: 0 },
    commits: 3,
    pullRequests: ["work-os#482"],
    items: [{ description: "Opened pull request #482", url: "https://github.com/wrazyai/work-os/pull/482", relation: "performed", at: "2026-11-24T21:12:00.000Z", repository: "work-os" }],
  },
  media: [{ title: "Pricing review walkthrough", url: "https://www.loom.com/share/6f2a9c4b8e1d4f5a6b7c8d9e0f1a2b3c", durationSeconds: 372, digest: "Walked through the pricing review." }],
  evidence: [{ title: "Board note · November margin", summary: "Board note for the November margin review.", url: "https://docs.google.com/document/d/1nN8mMargin", source: "google_docs", taskId: "task-1" }],
};

test("suggestions are extracted from completed work, recaps and the plan", () => {
  const suggestions = buildEodSuggestions(facts);
  assert.deepEqual(suggestions.completed, ["Reconcile the Q4 supplier ledger", "Ship the pricing model review", "Board note · November margin"]);
  assert.equal(suggestions.inProgress[0], "Supplier scorecard v2");
  assert.ok(suggestions.next.includes("Finalize the December close checklist"));
  assert.ok(!suggestions.next.includes("Reconcile the Q4 supplier ledger"));
});

test("evidence groups use the day's real sources and reviewable links", () => {
  const groups = buildEodEvidenceGroups(facts);
  assert.deepEqual(groups.map((group) => group.source), ["tasks", "worktivity", "github", "loom", "google_docs"]);
  assert.equal(groups.find((group) => group.source === "tasks")?.items.length, 3);
  assert.equal(groups.find((group) => group.source === "github")?.items[0].url, "https://github.com/wrazyai/work-os/pull/482");
  assert.equal(groups.find((group) => group.source === "loom")?.items[0].url, "https://www.loom.com/share/6f2a9c4b8e1d4f5a6b7c8d9e0f1a2b3c");
  assert.equal(eodEvidenceCount(groups), 7);
});

test("structured markdown uses the employee's words and keeps the full record", () => {
  const structured = {
    ...normalizeEodStructuredReport({
      summary: "A day of finished threads, with the supplier scorecard still open.",
      completed: ["Closed the Q4 supplier reconciliation — three exceptions cleared"],
      inProgress: ["Supplier scorecard v2 — waiting on legal review"],
      next: ["Finalize the December close checklist"],
      loomUrl: "https://www.loom.com/share/6f2a9c4b8e1d4f5a6b7c8d9e0f1a2b3c",
      evidence: buildEodEvidenceGroups(facts),
      summarySource: "otto",
    }),
    summarySignature: eodCompositionSignature({
      completed: ["Closed the Q4 supplier reconciliation — three exceptions cleared"],
      inProgress: ["Supplier scorecard v2 — waiting on legal review"],
      next: ["Finalize the December close checklist"],
    }),
  };
  const markdown = composeStructuredEodMarkdown(facts, structured).markdown;
  assert.match(markdown, /## Summary\nA day of finished threads/);
  assert.match(markdown, /## Completed today\n- Closed the Q4 supplier reconciliation/);
  assert.match(markdown, /## In progress\n- Supplier scorecard v2/);
  assert.match(markdown, /## Next\n- Finalize the December close checklist/);
  assert.match(markdown, /Loom recording attached by the employee: https:\/\/www\.loom\.com\/share\/6f2a9c4b8e1d4f5a6b7c8d9e0f1a2b3c/);
  assert.match(markdown, /## Full record/);
});

test("the fallback summary uses only the employee's own lines", () => {
  const structured = normalizeEodStructuredReport({
    completed: ["Closed the Q4 supplier reconciliation"],
    inProgress: ["Supplier scorecard v2"],
    next: ["Finalize the December close checklist"],
  });
  const summary = assembleEodSummary(structured);
  assert.match(summary, /Closed the Q4 supplier reconciliation/);
  assert.match(summary, /Supplier scorecard v2 is still in progress/);
  assert.match(summary, /Tomorrow starts with finalize the December close checklist/);
  assert.doesNotMatch(summary, /legal review/);
});

test("normalization caps, de-duplicates and rejects invalid values", () => {
  const lines = cleanEodLines(["  One  ", "one", "Two", 3, ""]);
  assert.deepEqual(lines, ["One", "Two"]);
  assert.equal(cleanEodLines(Array.from({ length: 20 }, (_, index) => `Line ${index}`)).length, 12);
  assert.equal(normalizeLoomShareUrl("loom.com/share/6f2a9c4b8e1d4f5a6b7c8d9e0f1a2b3c"), "https://www.loom.com/share/6f2a9c4b8e1d4f5a6b7c8d9e0f1a2b3c");
  assert.equal(normalizeLoomShareUrl("https://evil.example/share/6f2a9c4b8e1d4f5a6b7c8d9e0f1a2b3c"), null);
  assert.equal(normalizeLoomShareUrl("https://www.loom.com/embed/6f2a9c4b8e1d4f5a6b7c8d9e0f1a2b3c"), "https://www.loom.com/share/6f2a9c4b8e1d4f5a6b7c8d9e0f1a2b3c");
  const report = normalizeEodStructuredReport({
    summary: "  Summary  ",
    completed: ["One", "One"],
    completedExtra: ["ignored"],
    summarySource: "made_up",
    loomUrl: "https://evil.example/share/6f2a9c4b8e1d4f5a6b7c8d9e0f1a2b3c",
    evidence: [{ source: "tasks", label: "Tasks", items: [{ title: "A task", url: "javascript:alert(1)" }] }],
  });
  assert.equal(report.summary, "Summary");
  assert.deepEqual(report.completed, ["One"]);
  assert.equal(report.summarySource, null);
  assert.equal(report.loomUrl, null);
  assert.equal(report.evidence[0]?.items[0]?.url, null);
});

test("a saved composition preserves server-owned suggestions and evidence", () => {
  const base = normalizeEodStructuredReport({
    suggestions: { completed: ["Suggested completion"], inProgress: ["Suggested progress"], next: ["Suggested next"] },
    evidence: [{ source: "tasks", label: "Tasks", items: [{ title: "Recorded task" }] }],
    preparedAt: "2026-11-24T20:00:00.000Z",
    source: "scheduled",
  });
  const merged = mergeEodComposition(base, {
    completed: ["Employee completion"],
    inProgress: ["Employee progress"],
    next: ["Employee next"],
    summary: "Employee summary",
    summarySignature: "sig",
    loomUrl: "loom.com/share/6f2a9c4b8e1d4f5a6b7c8d9e0f1a2b3c",
  });
  assert.deepEqual(merged.completed, ["Employee completion"]);
  assert.deepEqual(merged.suggestions.completed, ["Suggested completion"]);
  assert.deepEqual(merged.evidence[0]?.items.map((item) => item.title), ["Recorded task"]);
  assert.equal(merged.source, "scheduled");
  assert.equal(merged.loomUrl, "https://www.loom.com/share/6f2a9c4b8e1d4f5a6b7c8d9e0f1a2b3c");
});

test("completeness and summary staleness follow the current lines", () => {
  const composition = {
    completed: ["One"],
    inProgress: ["Two"],
    next: ["Three"],
  };
  const signature = eodCompositionSignature(composition);
  assert.equal(eodCompositionIsComplete(composition), true);
  assert.equal(eodCompositionIsComplete({ ...composition, next: [] }), false);
  assert.equal(eodSummaryIsCurrent({ ...composition, summary: "Summary", summarySignature: signature }), true);
  assert.equal(eodSummaryIsCurrent({ ...composition, summary: "Summary", summarySignature: eodCompositionSignature({ ...composition, next: ["Changed"] }) }), false);
});

test("a structured save keeps the stored markdown brief in step", () => {
  const base = [
    "# EOD Report: Amara Okafor — November 24, 2026",
    "",
    "## Summary",
    "Deterministic summary.",
    "",
    "## Completed today",
    "- Deterministic completion.",
    "",
    "## In progress",
    "- Deterministic progress.",
    "",
    "## Next",
    "- Deterministic next.",
    "",
    "## Evidence",
    "- 2 work deliverables.",
    "",
    "## Full record",
    "",
    "### Work completed (2)",
    "- Deterministic completion.",
  ].join("\n");
  const structured = normalizeEodStructuredReport({
    summary: "Written summary.",
    completed: ["Employee completion."],
    inProgress: ["Employee progress."],
    next: ["Employee next."],
  });
  const updated = applyStructuredBrief(base, structured);
  assert.match(updated, /## Summary\nWritten summary\./);
  assert.match(updated, /## Completed today\n- Employee completion\./);
  assert.match(updated, /## In progress\n- Employee progress\./);
  assert.match(updated, /## Next\n- Employee next\./);
  assert.match(updated, /## Evidence\n- 2 work deliverables\./);
  assert.match(updated, /## Full record[\s\S]*Deterministic completion\./);
  assert.doesNotMatch(updated.split("## Full record")[0], /Deterministic completion\./);
  const cleared = applyStructuredBrief(base, normalizeEodStructuredReport({}));
  assert.match(cleared, /## Summary\nNo summary was written\./);
  assert.match(cleared, /## Completed today\nNo work deliverables were recorded today\./);
  assert.match(cleared, /## In progress\nNo line was written\./);
  assert.doesNotMatch(cleared.split("## Full record")[0], /Deterministic completion\./);
});

test("the maximum permitted composition keeps a matching summary signature", () => {
  const line = (prefix: string, index: number) => `${prefix}-${String(index).padStart(2, "0")}-${"x".repeat(232)}`;
  const composition = {
    completed: Array.from({ length: 12 }, (_, index) => line("c", index)),
    inProgress: Array.from({ length: 12 }, (_, index) => line("p", index)),
    next: Array.from({ length: 12 }, (_, index) => line("n", index)),
  };
  const signature = eodCompositionSignature(composition);
  assert.ok(signature.length <= 32);
  const report = normalizeEodStructuredReport({ ...composition, summary: "Summary", summarySignature: signature });
  assert.equal(report.summarySignature, signature);
  const merged = mergeEodComposition(report, { summary: "Summary", summarySignature: signature });
  assert.equal(merged.summarySignature, signature);
  assert.equal(eodSummaryIsCurrent({ ...composition, summary: "Summary", summarySignature: merged.summarySignature }), true);
});

test("escaped composition text keeps a stable bounded signature", () => {
  const escapedLine = (prefix: string, index: number) => `${prefix}-${String(index).padStart(2, "0")}-${"\\".repeat(230)}`;
  const composition = {
    completed: Array.from({ length: 12 }, (_, index) => escapedLine("c", index)),
    inProgress: Array.from({ length: 12 }, (_, index) => escapedLine("p", index)),
    next: Array.from({ length: 12 }, (_, index) => escapedLine("n", index)),
  };
  const signature = eodCompositionSignature(composition);
  assert.ok(signature.length <= 32);
  const report = normalizeEodStructuredReport({ ...composition, summary: "Summary", summarySignature: signature });
  assert.equal(report.summarySignature, signature);
  assert.equal(eodSummaryIsCurrent({ ...composition, summary: "Summary", summarySignature: signature }), true);
});
