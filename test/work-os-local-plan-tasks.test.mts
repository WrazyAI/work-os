import assert from "node:assert/strict";
import test from "node:test";
import { planTaskMarker, normalizeCriterion } from "../src/lib/work-os-local-tasks";

test("plan task markers are stable, plan-scoped, and content-sensitive", () => {
  const first = planTaskMarker("plan-1", "goal", "ship the release");
  assert.equal(first, planTaskMarker("plan-1", "goal", "ship the release"));
  assert.notEqual(first, planTaskMarker("plan-2", "goal", "ship the release"));
  assert.notEqual(first, planTaskMarker("plan-1", "goal", "ship the migration"));
  assert.notEqual(first, planTaskMarker("plan-1", "subtask", "ship the release"));
  assert.match(first, /^work-os-plan:[0-9a-f]{20}$/);
});

test("criterion normalization trims, drops blanks, and caps at the Nifty title limit", () => {
  assert.equal(normalizeCriterion("  Reconcile EU accounts  "), "Reconcile EU accounts");
  assert.equal(normalizeCriterion("   "), null);
  assert.equal(normalizeCriterion(null), null);
  const long = "x".repeat(400);
  const normalized = normalizeCriterion(long);
  assert.equal(normalized?.length, 240);
  assert.ok(normalized?.endsWith("…"));
});

test("goal and subtask markers never collide for the same content", () => {
  const goal = planTaskMarker("plan-9", "goal", "improve cash management");
  const subtask = planTaskMarker("plan-9", "subtask", "provider-x", "improve cash management");
  assert.notEqual(goal, subtask);
});
