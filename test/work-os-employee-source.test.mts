import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (relative: string) => readFile(path.join(root, relative), "utf8");

test("the Nifty sync can neither create nor revive an employee", async () => {
  const nifty = await source("src/lib/work-os-nifty.ts");

  assert.doesNotMatch(nifty, /upsertNiftyMember/, "the member upsert must be deleted, not merely left unused");
  assert.doesNotMatch(nifty, /listNiftyMembers/, "the sync must not read Nifty members as an employee roster");
  // Nifty may still resolve people for task attribution, but it must never write them.
  assert.doesNotMatch(
    nifty,
    /from\("work_people"\)\s*\.\s*(?:upsert|update)/,
    "a Nifty sync must never insert, update, or reactivate a work_people row",
  );
});

test("Worktivity remains the only thing that creates employees", async () => {
  const worktivity = await source("src/lib/work-os-worktivity.ts");

  assert.match(worktivity, /export async function syncWorktivityRoster/, "the Worktivity roster sync must stay");
  assert.match(
    worktivity,
    /from\("work_people"\)\s*\.\s*upsert/,
    "Worktivity is the surviving employee source and must still upsert people",
  );
});

test("the Worktivity employee integration is still exported", async () => {
  const barrel = await source("src/lib/work-os.ts");
  assert.match(barrel, /syncWorktivityRoster/, "the surviving roster source must remain reachable");
  assert.match(barrel, /upsertWorktivityEmployee/, "the Worktivity employee upsert must remain reachable");
});

test("the removed Nifty member upsert is not re-exported", async () => {
  const barrel = await source("src/lib/work-os.ts");
  assert.doesNotMatch(barrel, /upsertNiftyMember/, "the barrel must not offer the removed employee upsert");
});
