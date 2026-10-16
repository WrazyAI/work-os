import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { intervalRevision } from "../src/lib/work-os-activity-intervals.ts";

test("a recap's revision is a positive integer, 1 for rows that predate it", () => {
  assert.equal(intervalRevision({ revision: 3 }), 3);
  assert.equal(intervalRevision({ revision: "7" }), 7);
  assert.equal(intervalRevision({ revision: 2.9 }), 2);
  assert.equal(intervalRevision({ revision: null }), 1);
  assert.equal(intervalRevision({}), 1);
  assert.equal(intervalRevision({ revision: 0 }), 1);
  assert.equal(intervalRevision({ revision: -4 }), 1);
  assert.equal(intervalRevision({ revision: "not a number" }), 1);
});

test("the recap view carries the revision clients must send with a read", () => {
  const source = readFileSync(new URL("../src/lib/work-os-activity-intervals.ts", import.meta.url), "utf8");
  assert.match(source, /revision: intervalRevision\(row\)/);
  assert.match(source, /\/\*\* Bumped whenever the synthesis is rewritten\./);
});

test("the single-interval reader is scoped to the employee who owns it", () => {
  const source = readFileSync(new URL("../src/lib/work-os-activity-intervals.ts", import.meta.url), "utf8");
  const reader = source.slice(source.indexOf("export async function getActivityIntervalForPerson"));
  const body = reader.slice(0, reader.indexOf("\n}\n"));
  assert.match(body, /\.eq\("id", intervalId\)/);
  assert.match(body, /\.eq\("organization_id", access\.organizationId\)/);
  assert.match(body, /\.eq\("person_id", access\.personId\)/);
  assert.match(body, /if \(!access\.personId \|\| !intervalId\) return null;/);
});
