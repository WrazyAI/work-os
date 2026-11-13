import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewedMemoryPages, reviewedMemorySummary } from "../src/modules/work-os/memory-review-cache";

type Fact = { id: string; review_status: "confirmed" | "candidate" | "rejected"; content: string };

const fact: Fact = { id: "kept", content: "Review migrations before deploy", review_status: "candidate" };
const other: Fact = { id: "other", content: "Prefers morning review", review_status: "candidate" };

test("a kept fact absent from the summary is retained, not merely counted", () => {
  const summary = { facts: [other], factTotals: { confirmed: 0, candidate: 1 } };
  const next = reviewedMemorySummary(summary, fact, "confirmed")!;
  assert.deepEqual(next.facts.map((row) => [row.id, row.review_status]), [["other", "candidate"], ["kept", "confirmed"]]);
  assert.deepEqual(next.factTotals, { confirmed: 1, candidate: 1 });
});

test("a rejection removes the kept candidate and never adds a stale copy", () => {
  // The cached summary is the authority on the previous lane even when the
  // caller's copy has already been relabelled by an earlier render.
  const summary = { facts: [other, fact], factTotals: { confirmed: 1, candidate: 1 } };
  const next = reviewedMemorySummary(summary, fact, "rejected")!;
  assert.deepEqual(next.facts.map((row) => [row.id, row.review_status]), [["other", "candidate"]]);
  assert.deepEqual(next.factTotals, { confirmed: 1, candidate: 0 });
  const pages = reviewedMemoryPages({ pages: [{ facts: [fact], total: 1 }], pageParams: [null] }, "candidate", fact, "confirmed")!;
  assert.deepEqual(pages.pages[0].facts, []);
  assert.equal(pages.pages[0].total, 0);
  const confirmedPages = reviewedMemoryPages<Fact, { pages: Array<{ facts: Fact[]; total: number }>; pageParams: unknown[] }>(
    { pages: [{ facts: [], total: 0 }], pageParams: [null] }, "confirmed", fact, "confirmed")!;
  assert.deepEqual(confirmedPages.pages[0].facts.map((row) => row.id), ["kept"]);
  assert.equal(confirmedPages.pages[0].total, 1);
});
