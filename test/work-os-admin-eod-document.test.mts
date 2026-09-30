import { test } from "node:test";
import assert from "node:assert/strict";
import { eodMetricFacts, eodSnippet, parseEodMarkdown } from "../src/modules/work-os/admin/eod";

const MARKDOWN = [
  "# EOD Report: Luis Moreno — Sep 30, 2026",
  "",
  "Role profile: Operations",
  "Goal: Close the September vendor reconciliation.",
  "Goal source: written by the employee",
  "",
  "## Completed Work",
  "- 14:05 — Reconcile September invoices — closed the vendor statement for Northwind.",
  "- 12:40 — Update the payout runbook — added the retry table.",
  "",
  "## Progressed Work",
  "- 11:20 — Chase the finance export for the final vendor batch.",
  "",
  "## Deferred Work",
  "- No work was explicitly deferred.",
  "",
  "## Activity Context",
  "- 09:00–10:00 — employee confirmed: Reviewed the reconciliation sheet.",
  "",
  "Activity context is descriptive and does not prove attendance, productivity, or task completion.",
].join("\n");

test("EOD markdown parses into a title, meta lines, and sections", () => {
  const document = parseEodMarkdown(MARKDOWN);
  assert.equal(document.title, "EOD Report: Luis Moreno — Sep 30, 2026");
  assert.deepEqual(document.meta.map((line) => line.label), ["Role profile", "Goal", "Goal source"]);
  assert.deepEqual(document.sections.map((section) => section.heading), ["Completed Work", "Progressed Work", "Deferred Work", "Activity Context"]);
  assert.equal(document.sections[0].lines.length, 2);
  assert.equal(document.sections[0].lines[0].kind, "bullet");
  assert.equal(document.sections[2].lines[0].kind, "note");
  assert.match(document.closing ?? "", /never proves|does not prove/);
});

test("unknown shapes fall back without inventing sections", () => {
  const document = parseEodMarkdown("Plain text report with no headings.");
  assert.equal(document.title, null);
  assert.deepEqual(document.sections, []);
});

test("queue snippets prefer the first completed fact", () => {
  assert.match(eodSnippet(MARKDOWN) ?? "", /Reconcile September invoices/);
  assert.equal(eodSnippet("No structure here."), null);
});

test("metric facts only include recorded counts", () => {
  const facts = eodMetricFacts({ completed: 2, progressed: 1, deferred: 0, unplanned: 1 });
  assert.deepEqual(facts, [
    { label: "Completed", value: 2 },
    { label: "Progressed", value: 1 },
    { label: "Unplanned", value: 1 },
  ]);
  assert.deepEqual(eodMetricFacts(null), []);
});
