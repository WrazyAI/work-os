import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  LOCAL_TASK_REUSE_WINDOW_DAYS,
  planTaskMarker,
  normalizeCriterion,
  normalizeTaskTitle,
} from "../src/lib/work-os-local-tasks";

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

test("repeat-title comparison collapses whitespace and case only", () => {
  assert.equal(normalizeTaskTitle("  Reconcile   EU  accounts "), "reconcile eu accounts");
  assert.equal(normalizeTaskTitle("RECONCILE EU ACCOUNTS"), normalizeTaskTitle("reconcile eu accounts"));
  assert.notEqual(normalizeTaskTitle("Reconcile EU accounts"), normalizeTaskTitle("Reconcile EU refunds"));
  assert.notEqual(normalizeTaskTitle("Follow up with Client A"), normalizeTaskTitle("Follow up with Client B"));
  assert.equal(normalizeTaskTitle(null), "");
});

test("the reuse lookup is narrow: window, person, still open, local only", () => {
  const source = readFileSync(new URL("../src/lib/work-os-local-tasks.ts", import.meta.url), "utf8");
  const lookupAt = source.indexOf("async function findReusableLocalTask");
  assert.ok(lookupAt > 0);
  // Bound by the next declaration rather than a named neighbour: the file has
  // been reorganised, and a rename used to widen this slice to the whole file.
  const nextAt = source.indexOf("\nasync function ", lookupAt + 1);
  const lookup = source.slice(lookupAt, nextAt === -1 ? undefined : nextAt);
  assert.match(lookup, /\.eq\("provider", LOCAL_TASK_PROVIDER\)/);
  assert.match(lookup, /\.eq\("completed", false\)/);
  assert.match(lookup, /\.not\("status", "in", "\(archived,deleted\)"\)/);
  assert.match(lookup, /\.gte\("due_date", since\.toISOString\(\)\.slice\(0, 10\)\)/);
  assert.match(lookup, /\.lte\("due_date", planDate\)/);
  assert.match(lookup, /setUTCDate\(since\.getUTCDate\(\) - LOCAL_TASK_REUSE_WINDOW_DAYS\)/);
  assert.match(lookup, /\.contains\("assignee_person_ids", \[access\.personId\]\)/);
  assert.match(lookup, /\.order\("due_date", \{ ascending: false \}\)[\s\S]{0,120}?\.order\("id", \{ ascending: true \}\)/, "stable secondary order for paging");
  assert.match(lookup, /\.range\(page \* pageSize, page \* pageSize \+ pageSize - 1\)/, "all rows in the window are paged");
  assert.match(lookup, /normalizeTaskTitle\(task\.title\) === normalized/, "wildcards cannot over-match");
  assert.equal(LOCAL_TASK_REUSE_WINDOW_DAYS, 7);
  assert.doesNotMatch(lookup, /ilike\(/, "no SQL wildcard matching for user titles");
});

test("subtask markers stay parent-scoped so criteria never merge across goals", () => {
  const source = readFileSync(new URL("../src/lib/work-os-local-tasks.ts", import.meta.url), "utf8");
  assert.match(source, /markerFor\(String\(planId\), "subtask", String\(parent\.provider_task_id\), criterion\.toLowerCase\(\)\)/);
});
