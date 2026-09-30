import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { jsonError, WorkOsConflictError, WorkOsValidationError } from "../src/lib/work-os-api";

const root = new URL("../", import.meta.url);

async function source(path: string) {
  return readFile(new URL(path, root), "utf8");
}

test("plan validation failures answer 400 so clients never queue an impossible retry", async () => {
  const validation = jsonError(new WorkOsValidationError("A daily plan can contain at most 250 items."));
  assert.equal(validation.status, 400);
  assert.deepEqual(await validation.json(), { error: "A daily plan can contain at most 250 items." });
  assert.equal(jsonError(new WorkOsConflictError("This plan changed on another device.")).status, 409);
  // Unclassified server failures stay retryable so the companion can queue them.
  assert.equal(jsonError(new Error("database is unreachable")).status, 500);
});

test("the plan save guard, seed, and task surface share the plan item capacity", async () => {
  const workday = await source("src/lib/work-os-workday.ts");
  assert.match(workday, /submitted\.length > MAX_DAILY_PLAN_ITEMS/);
  assert.doesNotMatch(workday, /at most 100 items/);
  assert.match(workday, /prioritizePlanCandidates\(tasks, shiftDate, carryOver, MAX_DAILY_PLAN_ITEMS - PLAN_ITEM_DRAFT_HEADROOM\)/);
  assert.match(workday, /itemCount >= MAX_DAILY_PLAN_ITEMS - PLAN_ITEM_DRAFT_HEADROOM/);
  const api = await source("src/lib/work-os-api.ts");
  assert.match(api, /err instanceof WorkOsValidationError/);
  assert.match(api, /status: 400/);
});
