import assert from "node:assert/strict";
import test from "node:test";
import { buildEodReportMarkdown, rankEodCompleted, type EodReportFacts } from "../src/lib/work-os-eod-report";
import { parseEodInline, parseEodMarkdown, splitEodNoteRow, splitEodRecapRow, splitEodTaskRow } from "../src/modules/work-os/eod-document";
import { eodSnippet } from "../src/modules/work-os/admin/eod";
import { buildEodFactBlock, preservesEodStructure, splitEodBrief } from "../src/lib/aiEod";
import { eodLineItems } from "../src/lib/work-os-eod";

const completed = [
  { id: "1", title: "LaunchLoom: complete six-per-niche reference library and creative variation pipeline", project: "LaunchLoom", at: "2026-10-22T19:45:00.000Z", exact: true, outsideLabel: null },
  { id: "2", title: "Work Memory P3: memory API and wider agent reach", project: "Work OS", at: "2026-10-22T19:46:00.000Z", exact: true, outsideLabel: null },
  { id: "3", title: "Refine companion approvals and controls", project: "Work OS", at: "2026-10-22T19:46:00.000Z", exact: true, outsideLabel: null },
  { id: "4", title: "Fix companion clock-out fetch failure and stale attendance", project: "Work OS", at: "2026-10-22T13:34:00.000Z", exact: false, outsideLabel: " (outside shift)" },
  { id: "5", title: "LaunchLoom: generation-time contrast structure and hero-fit discipline", project: "LaunchLoom", at: "2026-10-22T19:30:00.000Z", exact: true, outsideLabel: null },
  { id: "6", title: "Build Work OS desktop diagnostics", project: "Work OS", at: "2026-10-22T19:48:00.000Z", exact: true, outsideLabel: null },
  ...Array.from({ length: 5 }, (_, index) => ({
    id: `scratch-${index}`,
    title: "Scratch approval round-trip verification",
    project: null,
    at: "2026-10-22T19:46:00.000Z",
    exact: false,
    outsideLabel: null,
  })),
  { id: "walking", title: "Choose a walking route", project: null, at: "2026-10-22T19:47:00.000Z", exact: false, outsideLabel: null },
  { id: "random", title: "Random test task", project: null, at: "2026-10-22T19:47:00.000Z", exact: false, outsideLabel: null },
  { id: "eod-1", title: "David Zahemen Yeboah08/31/2026", project: "EOD Report", at: "2026-10-22T19:47:00.000Z", exact: false, outsideLabel: null },
  { id: "eod-2", title: "David Zahemen Yeboah08/28/2026", project: "EOD Report", at: "2026-10-22T19:47:00.000Z", exact: false, outsideLabel: null },
];

const planItems = [
  { id: "p1", taskId: "1", kind: "outcome", title: "LaunchLoom: complete six-per-niche reference library and creative variation pipeline", disposition: "selected", completionState: "open", blocker: null },
  { id: "p2", taskId: "2", kind: "outcome", title: "Work Memory P3: memory API and wider agent reach", disposition: "selected", completionState: "completed", blocker: null },
  ...Array.from({ length: 190 }, (_, index) => ({
    id: `nifty-${index}`,
    taskId: `task-${index}`,
    kind: "nifty_task",
    title: `Backlog task ${index}`,
    disposition: "selected",
    completionState: "open",
    blocker: null,
  })),
];

const facts: EodReportFacts = {
  date: "2026-10-22",
  personName: "David Zahemen Yeboah",
  timezone: "America/New_York",
  roleName: "Engineer",
  goal: { text: "Move LaunchLoom forward", provenance: "employee" },
  session: { clockedInAt: "2026-10-22T13:00:00.000Z", clockedOutAt: "2026-10-22T21:30:00.000Z" },
  completed,
  carried: [],
  automation: [{ title: "Run me-context-update routine (2026-10-22)", outside: false }],
  automationOutsideLabel: null,
  planItems,
  updates: [],
  blockers: [],
  recaps: [
    { label: "3:39–3:49 PM", headline: "Work OS retry screen and preview failure", detail: "The interval moved between Work OS and a local preview that would not load.", provenance: "confirmed", startIso: "2026-10-22T19:39:00.000Z", endIso: "2026-10-22T19:49:00.000Z" },
    { label: "2:00–2:30 PM", headline: "Admin module notes and Otto Voice research", detail: "The interval shows project notes and a document titled Build Admin Module for WorkOS.", provenance: "confirmed", startIso: "2026-10-22T18:00:00.000Z", endIso: "2026-10-22T18:30:00.000Z" },
    { label: "1:00–1:30 PM", headline: "Inferred early browser work", detail: "A browser and editor were visible.", provenance: "inferred", startIso: "2026-10-22T17:00:00.000Z", endIso: "2026-10-22T17:30:00.000Z" },
  ],
  hourly: [{ label: "5–6 PM", summary: "A dashboard and a coding assistant were visible." }],
  github: {
    performed: { push: 53, pullRequest: 7, review: 0, issue: 0 },
    triggered: { workflowRun: 105, deployment: 70, pullRequest: 0, review: 0, issue: 0 },
    commits: 83,
    pullRequests: ["work-os#134", "agent-os#73", "launchloom#177"],
  },
  media: [{ title: "Settlement walkthrough", url: "https://www.loom.com/share/912e89a68ccc42c5ab5096fec7cd63d6", durationSeconds: 326, digest: "Walked through the settlement reconciliation." }],
  evidence: [{ title: "Release notes", summary: "Documented the shipped changes.", url: "https://example.com/release", source: "manual", taskId: "1" }],
};

const report = buildEodReportMarkdown(facts);
const document = parseEodMarkdown(report.markdown);

test("the brief is capped, ranked, and free of the ledger dump", () => {
  const brief = document.sections.find((section) => section.key === "completed");
  assert.ok(brief);
  assert.ok(brief.lines.filter((line) => line.kind === "bullet").length <= 9, "the brief caps completed work");
  const briefText = brief.lines.map((line) => line.text).join("\n");
  assert.doesNotMatch(briefText, /Scratch approval round-trip verification/);
  assert.doesNotMatch(briefText, /Choose a walking route/);
  assert.doesNotMatch(briefText, /Random test task/);
  assert.doesNotMatch(briefText, /David Zahemen Yeboah08\/31\/2026/);
  assert.match(briefText, /LaunchLoom/);
  assert.match(briefText, /Work Memory P3/);
});

test("the appendix keeps every omitted fact and collapses repeats", () => {
  assert.match(report.markdown, /Scratch approval round-trip verification ×5/);
  assert.match(report.markdown, /Choose a walking route/);
  assert.match(report.markdown, /Random test task/);
  assert.match(report.markdown, /David Zahemen Yeboah08\/31\/2026/);
  assert.match(report.markdown, /Automation runs/);
  assert.match(report.markdown, /Other tasks/);
  assert.match(report.markdown, /Inferred early browser work/);
  assert.match(report.markdown, /Settlement walkthrough/);
});

test("a project-free exact completion keeps its time track", () => {
  assert.deepEqual(splitEodTaskRow("Ship the release — 3:30 PM"), {
    title: "Ship the release",
    project: null,
    time: "3:30 PM",
    outside: null,
    count: 1,
  });
});

test("an outside label after a time keeps the time track", () => {
  assert.deepEqual(splitEodTaskRow("Ship the release — Work OS · 3:30 PM · (outside shift)"), {
    title: "Ship the release",
    project: "Work OS",
    time: "3:30 PM",
    outside: "outside shift",
    count: 1,
  });
});

test("a bare URL keeps its trailing punctuation as text", () => {
  assert.deepEqual(parseEodInline("See https://example.com."), [
    { text: "See ", href: null },
    { text: "https://example.com", href: "https://example.com" },
    { text: ".", href: null },
  ]);
});

test("the trailing bracket keeps a title that contains a dash intact", () => {
  assert.deepEqual(splitEodTaskRow("Ship v2 — onboarding [Work OS · 3:30 PM · (outside shift)]"), {
    title: "Ship v2 — onboarding",
    project: "Work OS",
    time: "3:30 PM",
    outside: "outside shift",
    count: 1,
  });
});

test("ranking a collapsed task sees every linked task id", () => {
  const ranking = rankEodCompleted({
    ...facts,
    completed: [
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `work-${index}`,
        title: `Work item ${index}`,
        project: "Work OS",
        at: "2026-10-22T19:30:00.000Z",
        exact: true,
        outsideLabel: null,
      })),
      { id: "shared-a", title: "Shared deliverable", project: "Work OS", at: "2026-10-22T19:31:00.000Z", exact: true, outsideLabel: null },
      { id: "shared-b", title: "Shared deliverable", project: "Work OS", at: "2026-10-22T19:32:00.000Z", exact: true, outsideLabel: null },
    ],
    planItems: [{ id: "p-shared", taskId: "shared-b", kind: "outcome", title: "A commitment with a different title", disposition: "selected", completionState: "open", blocker: null }],
    evidence: [],
  });
  assert.equal(ranking[0]?.title, "Shared deliverable");
  assert.equal(ranking[0]?.count, 2);
});

test("long Loom durations round before splitting minutes and seconds", () => {
  const rounded = buildEodReportMarkdown({
    ...facts,
    media: [{ title: "Loom", url: "https://www.loom.com/share/x", durationSeconds: 119.6, digest: null }],
  });
  assert.match(rounded.markdown, /Loom \(2:00\)/);
});

test("recorded updates stay in the full record", () => {
  const withUpdate = buildEodReportMarkdown({
    ...facts,
    updates: [{ kind: "material_progress", text: "Shipped the retry fix." }],
  });
  assert.match(withUpdate.markdown, /### Recorded updates \(1\)\n- \[material_progress\] Shipped the retry fix\./);
});

test("a personal and a work task with the same title stay separate", () => {
  const sameTitle = buildEodReportMarkdown({
    ...facts,
    completed: [
      { id: "work-copy", title: "Review the queue", project: "Work OS", at: "2026-10-22T19:30:00.000Z", exact: true, outsideLabel: null },
      { id: "personal-copy", title: "Review the queue", project: "Personal", at: "2026-10-22T19:31:00.000Z", exact: true, outsideLabel: null },
    ],
    planItems: [],
    carried: [],
  });
  const document = parseEodMarkdown(sameTitle.markdown);
  assert.match(document.sections.find((section) => section.key === "completed")?.lines.map((line) => line.text).join("\n") ?? "", /Review the queue/);
  assert.match(sameTitle.markdown, /Other tasks/);
  assert.match(sameTitle.markdown, /Personal task/);
});

test("blockers beyond the brief limit stay in the full record", () => {
  const sixBlockers = buildEodReportMarkdown({
    ...facts,
    blockers: ["Blocker one", "Blocker two", "Blocker three", "Blocker four", "Blocker five", "Blocker six"],
  });
  assert.match(sixBlockers.markdown, /## Blocked\n- Blocker one/);
  assert.match(sixBlockers.markdown, /…and 1 more in the full record/);
  assert.match(sixBlockers.markdown, /### More blockers \(1\)\n- Blocker six/);
});

test("the full record keeps long recap and evidence detail", () => {
  const detail = `The interval shows ${"a long evidence trail ".repeat(50)}and the final handoff.`;
  const full = buildEodReportMarkdown({
    ...facts,
    recaps: [{ ...facts.recaps[0]!, detail }],
    evidence: [{ title: "Long evidence", summary: detail, url: null, source: "manual", taskId: null }],
  });
  assert.match(full.markdown, /and the final handoff\./);
  assert.match(full.markdown, /Employee-attached/);
  assert.doesNotMatch(full.markdown, /…/);
});

test("an outside-window label with no project reads as a suffix, not a stray track", () => {
  const outsideOnly = buildEodReportMarkdown({
    ...facts,
    completed: [{ id: "outside", title: "Outside check", project: null, at: "2026-10-22T13:00:00.000Z", exact: false, outsideLabel: " (outside shift)" }],
    carried: [],
    planItems: [],
  });
  assert.match(outsideOnly.markdown, /- Outside check \[\(outside shift\)\]/);
  assert.doesNotMatch(outsideOnly.markdown, /Outside check — \(outside shift\)/);
});

test("provider-observed sync times never become work times", () => {
  const observed = splitEodTaskRow(document.sections.find((section) => section.key === "completed")!.lines.find((line) => /Fix companion clock-out/.test(line.text))!.text);
  assert.equal(observed.time, null);
  assert.match(observed.outside ?? "", /outside shift/);
});

test("the summary is a deterministic takeaway, not a missing-update line", () => {
  const summary = document.summary?.lines.map((line) => line.text).join(" ") ?? "";
  assert.match(summary, /Completed \d+ work tasks today/);
  assert.doesNotMatch(summary, /No recorded progress update/);
  assert.match(summary, /Recorded work also covered/);
});

test("only a real plan disagreement appears, never the 190-item plan", () => {
  const plan = document.sections.find((section) => section.key === "plan");
  assert.ok(plan);
  assert.match(plan.lines.map((line) => line.text).join("\n"), /completed in the task record; the plan still shows it open/);
  assert.doesNotMatch(report.markdown, /Backlog task/);
  assert.doesNotMatch(report.markdown, /marked complete in the plan; no task completion was recorded/);
});

test("empty optional sections disappear", () => {
  assert.equal(document.sections.some((section) => section.key === "blocked"), false);
  assert.equal(document.sections.some((section) => section.key === "next"), false);
  assert.doesNotMatch(report.markdown, /## Bottleneck/);
});

test("GitHub is reported as unique pull requests and keeps performed apart from triggered", () => {
  assert.match(report.markdown, /GitHub, provider-recorded — performed 53 pushes \(83 commits\) · 3 pull requests; triggered 105 workflow runs · 70 deployments\./);
  assert.doesNotMatch(report.markdown, /7 pull requests/);
});

test("the parser reads the brief and the appendix apart", () => {
  assert.ok(document.summary);
  assert.equal(document.sections[0]?.key, "summary");
  assert.ok(document.appendix.length > 0);
  assert.match(document.appendix[0]?.heading ?? "", /^Work completed/);
  assert.equal(document.closing?.includes("Activity context is descriptive"), true);
});

test("task and recap rows keep their tracks", () => {
  assert.deepEqual(splitEodTaskRow("Ship the release — Work OS · 3:30 PM (outside shift)"), {
    title: "Ship the release",
    project: "Work OS",
    time: "3:30 PM",
    outside: "outside shift",
    count: 1,
  });
  assert.deepEqual(splitEodTaskRow("Scratch approval round-trip verification ×5"), {
    title: "Scratch approval round-trip verification",
    project: null,
    time: null,
    outside: null,
    count: 5,
  });
  assert.deepEqual(splitEodRecapRow("3:39–3:49 PM — Confirmed: Work OS retry screen"), {
    label: "3:39–3:49 PM",
    provenance: "Confirmed",
    headline: "Work OS retry screen",
  });
  assert.deepEqual(splitEodNoteRow("Ship the release — completed in the task record; the plan still shows it open."), {
    title: "Ship the release",
    note: "completed in the task record; the plan still shows it open.",
  });
});

test("the admin queue snippet reads the new completed section", () => {
  const snippet = eodSnippet(report.markdown);
  assert.ok(snippet);
  assert.match(snippet, /LaunchLoom|Work Memory P3|Refine companion/);
});

test("a refinement may rewrite prose but must keep the report structure", () => {
  assert.equal(preservesEodStructure(report.markdown, report.markdown.replace("## Full record", "## Notes")), false);
  assert.equal(preservesEodStructure(report.markdown, report.markdown.replace("## Completed today", "## Work")), false);
  assert.equal(preservesEodStructure(report.markdown, report.markdown), true);
  assert.equal(preservesEodStructure("## Summary\nOld", "## Summary\nNew"), true);
  const droppedAppendixRow = report.markdown.replace(/- Choose a walking route[^\n]*\n?/, "");
  assert.equal(preservesEodStructure(report.markdown, droppedAppendixRow), false, "the appendix is not rewritten");
});

test("refinement sees the brief separately from the full record", () => {
  const { brief, appendix } = splitEodBrief(report.markdown);
  assert.doesNotMatch(brief, /## Full record/);
  assert.match(brief, /## Summary/);
  assert.match(appendix ?? "", /^## Full record/);
  assert.match(appendix ?? "", /Work Memory P3/);
});

test("the refinement facts are plain prose, never selectable ids", () => {
  const block = buildEodFactBlock({
    date: "2026-10-22",
    personName: "David",
    clockedInAt: "2026-10-22T13:00:00.000Z",
    clockedOutAt: null,
    updates: [{ kind: "material_progress", text: "Shipped the retry fix.", at: "2026-10-22T18:00:00.000Z" }],
    completed: ["Ship the retry fix"],
    carried: [],
    blockers: [],
    observed: [],
    media: [],
  });
  assert.match(block, /Known Work OS facts/);
  assert.match(block, /Shipped the retry fix/);
  assert.doesNotMatch(block, /update:0|completed:0|observed:0/);
});

test("deterministic evidence lines keep their neutral summary", () => {
  assert.deepEqual(eodLineItems([
    { id: "e1", title: "Worktivity screenshot context", summary: "A browser window shows the settlement dashboard." },
    { id: "e2", title: "Completed Nifty task" },
  ], "none"), [
    "- Worktivity screenshot context — A browser window shows the settlement dashboard.",
    "- Completed Nifty task",
  ]);
});
