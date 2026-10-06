import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isWorkOsGuideKey, normalizeWorkOsGuideState, WORK_OS_GUIDE_KEYS } from "../src/lib/work-os-guides";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (relative: string) => readFile(path.join(root, relative), "utf8");

test("guide state normalizes malformed rows and drops unknown keys", () => {
  assert.deepEqual(normalizeWorkOsGuideState(null), { guides: {}, autoOpen: true });
  assert.deepEqual(normalizeWorkOsGuideState("nope"), { guides: {}, autoOpen: true });
  assert.deepEqual(normalizeWorkOsGuideState([]), { guides: {}, autoOpen: true });
  assert.deepEqual(
    normalizeWorkOsGuideState({
      guides: { day: "2026-10-06T10:00:00.000Z", tasks: "2026-10-06T10:05:00.000Z" },
      autoOpen: false,
    }),
    { guides: { day: "2026-10-06T10:00:00.000Z", tasks: "2026-10-06T10:05:00.000Z" }, autoOpen: false },
  );
  assert.deepEqual(
    normalizeWorkOsGuideState({
      guides: {
        day: "2026-10-06T10:00:00.000Z",
        "admin-overview": "2026-10-06T10:00:00.000Z",
        tasks: 42,
        review: "   ",
        insights: { seen: true },
      },
      autoOpen: "no",
      unrelated: true,
    }),
    { guides: { day: "2026-10-06T10:00:00.000Z" }, autoOpen: true },
  );
});

test("guide keys are an explicit allowlist", () => {
  assert.deepEqual([...WORK_OS_GUIDE_KEYS], ["day", "tasks", "review", "insights", "settings"]);
  assert.equal(isWorkOsGuideKey("day"), true);
  assert.equal(isWorkOsGuideKey("admin-settings"), false);
  assert.equal(isWorkOsGuideKey(7), false);
});

test("guides route authenticates and writes only through the access-scoped library", async () => {
  const route = await source("src/app/api/work-os/me/guides/route.ts");
  assert.match(route, /requireWorkOsAccess/, "the route resolves authoritative Work OS access");
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function POST/);
  assert.match(route, /loadWorkOsGuideState\(auth\.access\)/, "reads use the access object, never request values");
  assert.match(route, /markWorkOsGuideSeen\(auth\.access/, "guide writes use the access object");
  assert.match(route, /setWorkOsGuideAutoOpen\(auth\.access/, "preference writes use the access object");
  assert.doesNotMatch(route, /membershipId|membership_id/, "no membership id travels through the request");
});

test("guide library scopes every write to the caller membership and validates keys", async () => {
  const library = await source("src/lib/work-os-guides.ts");
  assert.match(library, /access\.membershipId/, "the membership id comes from resolved access");
  assert.match(library, /work_mark_guide_seen/);
  assert.match(library, /work_set_guide_auto_open/);
  assert.match(library, /isWorkOsGuideKey\(guide\)/, "guide keys are allowlisted before the write");
});

test("member ui state migration is additive and idempotent", async () => {
  const migration = await source("supabase/migrations/0058_work_os_member_ui_state.sql");
  assert.match(migration, /alter table work_org_members\s+add column if not exists ui_state jsonb not null default '\{\}'::jsonb;/);
  assert.match(migration, /create or replace function work_mark_guide_seen/);
  assert.match(migration, /create or replace function work_set_guide_auto_open/);
  assert.match(migration, /p_membership_id/);
});
