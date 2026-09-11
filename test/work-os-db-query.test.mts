import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeRpcParams, parseSelect, splitTopLevelList } from "../src/lib/db/query";

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

test("RPC json/jsonb params are serialized while array-typed params stay arrays", () => {
  const argTypes = new Map<string, string>([
    ["p_items", "jsonb"],
    ["p_interpretation_metadata", "jsonb"],
    ["p_payload", "json"],
    ["p_suggestion_task_ids", "text[]"],
    ["p_remove_outcome_ids", "uuid[]"],
  ]);
  const params = encodeRpcParams(
    {
      p_items: [{ id: "a", title: "goal" }],
      p_interpretation_metadata: { source: "desktop" },
      p_payload: { nested: [1, 2] },
      p_suggestion_task_ids: ["t1", "t2"],
      p_remove_outcome_ids: [],
      p_confirm: true,
      p_freeform_intent: null,
    },
    argTypes,
  );
  assert.equal(params[0], JSON.stringify([{ id: "a", title: "goal" }]));
  assert.equal(params[1], JSON.stringify({ source: "desktop" }));
  assert.equal(params[2], JSON.stringify({ nested: [1, 2] }));
  assert.deepEqual(params[3], ["t1", "t2"]);
  assert.deepEqual(params[4], []);
  assert.equal(params[5], true);
  assert.equal(params[6], null);
});

test("RPC encoding quotes string json params and normalizes undefined", () => {
  const params = encodeRpcParams({ p_note: "plain", p_missing: undefined }, new Map([["p_note", "jsonb"]]));
  assert.equal(params[0], '"plain"');
  assert.equal(params[1], null);
});

test("RPC encoding without known param types passes arrays through", () => {
  const params = encodeRpcParams({ p_ids: ["a", "b"] }, new Map());
  assert.deepEqual(params[0], ["a", "b"]);
});
