import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSelect, splitTopLevelList } from "../src/lib/db/query";

test("or-spec splitting respects nested and()/or() groups", () => {
  assert.deepEqual(splitTopLevelList("a.eq.1,b.eq.2"), ["a.eq.1", "b.eq.2"]);
  assert.deepEqual(
    splitTopLevelList("deleted_at.lt.2026-01-01,and(upload_status.eq.pending,created_at.lt.2026-01-02)"),
    ["deleted_at.lt.2026-01-01", "and(upload_status.eq.pending,created_at.lt.2026-01-02)"],
  );
  assert.deepEqual(
    splitTopLevelList("or(a.eq.1,and(b.eq.2,c.eq.3))"),
    ["or(a.eq.1,and(b.eq.2,c.eq.3))"],
  );
});

test("select parsing keeps nested embeds structured instead of treating them as columns", () => {
  const parsed = parseSelect("*, person:work_people(id,display_name), event:work_evidence_events(correction_status,screenshot:work_screenshot_summaries(id,storage_path))");
  assert.equal(parsed.base, "*");
  assert.equal(parsed.embeds.length, 2);
  assert.equal(parsed.embeds[0]?.table, "work_people");
  assert.deepEqual(parsed.embeds[0]?.columns, ["id", "display_name"]);
  assert.equal(parsed.embeds[1]?.table, "work_evidence_events");
  assert.equal(parsed.embeds[1]?.embeds.length, 1);
  assert.equal(parsed.embeds[1]?.embeds[0]?.alias, "screenshot");
  assert.equal(parsed.embeds[1]?.embeds[0]?.table, "work_screenshot_summaries");
});

test("select parsing understands !inner and explicit base columns", () => {
  const parsed = parseSelect("organization_id,person_id,person:work_people!inner(worktivity_employee_id)");
  assert.equal(parsed.base, "organization_id, person_id");
  assert.equal(parsed.embeds[0]?.inner, true);
  assert.equal(parsed.embeds[0]?.table, "work_people");
  assert.deepEqual(parsed.embeds[0]?.columns, ["worktivity_employee_id"]);
});

test("plain selects produce no embeds", () => {
  const parsed = parseSelect("id, title, completed");
  assert.deepEqual(parsed.embeds, []);
  assert.equal(parsed.base, "id, title, completed");
  assert.deepEqual(parseSelect("*"), { base: "*", embeds: [] });
});
