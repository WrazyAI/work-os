import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { isoDate, isoTimestamp } from "../src/lib/iso-timestamp";

const root = new URL("../", import.meta.url);
const source = (path: string) => readFile(new URL(path, root), "utf8");

test("a Date is written as an ISO instant, never as a JavaScript date string", () => {
  // String(new Date(...)) is "Mon Oct 20 2026 15:45:01 GMT+0000", which
  // Postgres rejects; the write then fails and the caller swallows it.
  assert.equal(isoTimestamp(new Date("2026-10-20T15:45:01.649Z")), "2026-10-20T15:45:01.649Z");
});

test("an ISO string passes through unchanged", () => {
  assert.equal(isoTimestamp("2026-10-20T15:45:01.649Z"), "2026-10-20T15:45:01.649Z");
});

test("a value that cannot be a timestamp falls back instead of being written", () => {
  assert.equal(isoTimestamp("not a date"), null);
  assert.equal(isoTimestamp("not a date", "2026-10-20T00:00:00.000Z"), "2026-10-20T00:00:00.000Z");
  assert.equal(isoTimestamp(null), null);
  assert.equal(isoTimestamp(undefined), null);
  assert.equal(isoTimestamp(""), null);
});

test("a date column takes the day an instant belongs to", () => {
  assert.equal(isoDate("2026-10-20"), "2026-10-20");
  assert.equal(isoDate(new Date("2026-10-20T23:59:00.000Z")), "2026-10-20");
  assert.equal(isoDate("nonsense"), null);
  assert.equal(isoDate(null), null);
});

test("the memory boundary normalises instead of trusting its callers", async () => {
  const lib = await source("src/lib/work-memory.ts");
  assert.match(lib, /occurred_at: isoTimestamp\(input\.occurredAt\) \?\? new Date\(\)\.toISOString\(\)/);
  assert.match(lib, /local_date: input\.localDate \? isoDate\(input\.localDate\) : null/);
});

test("no caller hands the memory recorder a JavaScript date string", async () => {
  // Each of these would produce "Mon Oct 20 2026 ..." for a Date column.
  for (const path of [
    "src/lib/work-os-checkins.ts",
    "src/lib/work-os-eod.ts",
    "src/lib/work-os-daily-workspace.ts",
    "src/lib/work-conversations.ts",
  ]) {
    const lib = await source(path);
    assert.doesNotMatch(lib, /String\(\w+\.created_at\)/, `${path} stringifies a database instant`);
    assert.doesNotMatch(lib, /occurredAt: String\(/, `${path} stringifies an occurredAt`);
  }
});
