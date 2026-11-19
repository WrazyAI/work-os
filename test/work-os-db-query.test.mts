import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { encodeRpcParams, parseSelect, splitTopLevelList } from "../src/lib/db/query";
import { createAdminClient } from "../src/lib/supabase/admin";

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

test("to-one embeds resolve when the foreign key is not explicitly selected", async () => {
  const db = new PGlite();
  await db.exec(`
    create table work_people (id uuid primary key, display_name text not null);
    create table work_source_accounts (
      id uuid primary key default gen_random_uuid(),
      external_account_id text not null,
      person_id uuid references work_people(id) on delete set null
    );
    insert into work_people (id, display_name) values ('11111111-1111-4111-8111-111111111111', 'Aden Badon');
    insert into work_source_accounts (external_account_id, person_id)
      values ('U0iEgwXaVEQ2eYNNAwIj', '11111111-1111-4111-8111-111111111111');
  `);
  globalThis.__workOsPgPool = {
    query: (sql: string, values?: unknown[]) => db.query(sql, values),
    connect: async () => ({ query: (sql: string, values?: unknown[]) => db.query(sql, values), release: () => undefined }),
  } as unknown as Pool;
  const globalForDb = globalThis as unknown as { __workOsDbClient?: unknown };
  globalForDb.__workOsDbClient = undefined;
  try {
    const { data, error } = await createAdminClient()
      .from("work_source_accounts")
      .select("external_account_id,person:work_people(id,display_name)")
      .eq("external_account_id", "U0iEgwXaVEQ2eYNNAwIj");
    assert.ifError(error);
    assert.equal(data?.length, 1);
    assert.equal(data?.[0]?.person?.display_name, "Aden Badon");
    // The injected key stays internal; callers that did not request it must not see it.
    assert.equal("person_id" in (data?.[0] ?? {}), false);
  } finally {
    globalThis.__workOsPgPool = undefined;
    globalForDb.__workOsDbClient = undefined;
    await db.close();
  }
});
