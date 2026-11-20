import assert from "node:assert/strict";
import test from "node:test";
import { summarizeEvidence, type EvidenceSummaryInput } from "../src/lib/work-os-evidence-summary";

const rows: EvidenceSummaryInput[] = [
  { source: "ghl", evidence_date: "2026-11-16", title: "Call outbound", person_id: "p-1" },
  { source: "ghl", evidence_date: "2026-11-16", title: "Email sent", person_id: "p-1" },
  { source: "ghl", evidence_date: "2026-11-17", title: "Call outbound", person_id: "p-1" },
  { source: "github", evidence_date: "2026-11-16", title: "Pull request merged", person_id: "p-2" },
  { source: "worktivity", evidence_date: "2026-11-17", title: "Observed review block", person_id: "p-2" },
  { source: "ghl", evidence_date: "2026-11-18", title: "Call inbound", person_id: null },
  { source: "ghl", evidence_date: "2026-11-18", title: "Text message sent", person_id: null },
  { source: "ghl", evidence_date: "2026-11-16", title: "Opportunity open", person_id: null },
];

test("summarizes sources, days, exact kinds, and distinct people together", () => {
  const summary = summarizeEvidence(rows);
  assert.deepEqual(summary.sources, [
    { source: "ghl", count: 6 },
    { source: "github", count: 1 },
    { source: "worktivity", count: 1 },
  ]);
  assert.deepEqual(summary.days, [
    { date: "2026-11-16", count: 4 },
    { date: "2026-11-17", count: 2 },
    { date: "2026-11-18", count: 2 },
  ]);
  assert.deepEqual(summary.kinds, [
    { kind: "call", count: 3 },
    { kind: "email", count: 1 },
    { kind: "github", count: 1 },
    { kind: "worktivity", count: 1 },
    { kind: "text", count: 1 },
    { kind: "context", count: 1 },
  ]);
  assert.equal(summary.peopleCount, 2);
  assert.equal(summary.coverage, undefined);
});

test("builds coverage from linked and uncredited rows, with email markers", () => {
  const summary = summarizeEvidence(rows, true);
  const byPerson = new Map((summary.coverage?.people ?? []).map((person) => [person.personId, person.days]));
  assert.deepEqual(byPerson.get("p-1"), [
    { date: "2026-11-16", count: 2, emails: 1 },
    { date: "2026-11-17", count: 1, emails: 0 },
  ]);
  assert.deepEqual(byPerson.get("p-2"), [
    { date: "2026-11-16", count: 1, emails: 0 },
    { date: "2026-11-17", count: 1, emails: 0 },
  ]);
  assert.deepEqual(byPerson.get(null), [
    { date: "2026-11-16", count: 1, emails: 0 },
    { date: "2026-11-18", count: 2, emails: 0 },
  ]);
});

test("keeps total counts honest when a date is malformed", () => {
  const summary = summarizeEvidence([
    { source: "ghl", evidence_date: "not-a-date", title: "Call outbound", person_id: null },
  ], true);
  assert.deepEqual(summary.sources, [{ source: "ghl", count: 1 }]);
  assert.deepEqual(summary.days, []);
  assert.deepEqual(summary.kinds, [{ kind: "call", count: 1 }]);
  assert.deepEqual(summary.coverage, { people: [] });
});

test("handles an empty record without inventing a coverage row", () => {
  assert.deepEqual(summarizeEvidence([], true), {
    sources: [],
    days: [],
    kinds: [],
    peopleCount: 0,
    coverage: { people: [] },
  });
});
