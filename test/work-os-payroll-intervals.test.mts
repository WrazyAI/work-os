import assert from "node:assert/strict";
import test from "node:test";
import type { Span } from "../src/modules/work-os/payroll/contracts";

// The break this catches: double-counting overlapping shifts/breaks, or letting
// a touching interval leak into a gap.
const intervals = () => import("../src/lib/work-os-payroll-intervals");
const s = (start: number, end: number): Span => ({ startMs: start * 1000, endMs: end * 1000 });
const durationOf = (spans: Span[]) => spans.reduce((sum, span) => sum + span.endMs - span.startMs, 0);

test("union merges touching, nested and unsorted spans exactly", async () => {
  const { unionSpans } = await intervals();
  assert.deepEqual(unionSpans([]), []);
  assert.deepEqual(unionSpans([s(10, 20), s(0, 10), s(30, 40)]), [s(0, 20), s(30, 40)]);
  assert.deepEqual(unionSpans([s(10, 30), s(15, 20), s(30, 35), s(10, 30)]), [s(10, 35)]);
  assert.deepEqual(unionSpans([s(5, 6), s(0, 3)]), [s(0, 3), s(5, 6)]);
  assert.throws(() => unionSpans([s(5, 5)]), /span/i);
  assert.throws(() => unionSpans([s(6, 5)]), /span/i);
  assert.throws(() => unionSpans([{ startMs: NaN, endMs: 5 }]), /span/i);
});

test("intersection is half-open and preserves no touching artifacts", async () => {
  const { intersectSpans } = await intervals();
  assert.deepEqual(intersectSpans([s(0, 10), s(20, 30)], [s(5, 25)]), [s(5, 10), s(20, 25)]);
  assert.deepEqual(intersectSpans([s(0, 10)], [s(10, 20)]), []);
  assert.deepEqual(intersectSpans([], [s(0, 1)]), []);
  assert.deepEqual(intersectSpans([s(0, 5)], [s(0, 5)]), [s(0, 5)]);
});

test("subtraction splits spans and removes full coverage without losing the tail", async () => {
  const { subtractSpans } = await intervals();
  assert.deepEqual(subtractSpans([s(0, 60)], [s(10, 20), s(30, 40)]), [s(0, 10), s(20, 30), s(40, 60)]);
  assert.deepEqual(subtractSpans([s(0, 10)], [s(0, 10)]), []);
  assert.deepEqual(subtractSpans([s(0, 10)], [s(-5, 15)]), []);
  assert.deepEqual(subtractSpans([s(0, 10)], [s(20, 30)]), [s(0, 10)]);
  assert.deepEqual(subtractSpans([], [s(0, 1)]), []);
});

test("generated spans keep a disjoint, order-independent partition", async () => {
  const { unionSpans, intersectSpans, subtractSpans } = await intervals();
  let seed = 42;
  const random = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
  for (let round = 0; round < 30; round += 1) {
    const spans = Array.from({ length: 12 }, () => {
      const start = Math.floor(random() * 100);
      return { startMs: start * 1000, endMs: (start + 1 + Math.floor(random() * 20)) * 1000 };
    });
    const union = unionSpans(spans);
    const permutations = [spans, [...spans].reverse(), [...spans].sort(() => random() - 0.5)];
    for (const permutation of permutations) assert.deepEqual(unionSpans(permutation), union);
    const total = union.reduce((sum, span) => sum + span.endMs - span.startMs, 0);
    assert.equal(total, unionSpans([...spans, ...spans]).reduce((sum, span) => sum + span.endMs - span.startMs, 0));
    const extra = [s(0, 50), s(200, 250)];
    const overlap = intersectSpans(union, extra);
    const remainder = subtractSpans(union, extra);
    assert.deepEqual(unionSpans([...overlap, ...remainder]), union);
    assert.equal(durationOf([...overlap, ...remainder]), total);
  }
});
