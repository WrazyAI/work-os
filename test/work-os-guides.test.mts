import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isWorkOsGuideKey, normalizeWorkOsGuideState, WORK_OS_GUIDE_KEYS } from "../src/lib/work-os-guides";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (relative: string) => readFile(path.join(root, relative), "utf8");

/** The string entries of a `NAME = [ ... ]` literal in a source file. */
function stringList(text: string, name: string): string[] {
  const match = new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`).exec(text);
  assert.ok(match, `${name} was not found`);
  return [...match[1]!.matchAll(/"([^"]+)"/g)].map((entry) => entry[1]!);
}

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
        admin_overview: "2026-10-06T10:00:00.000Z",
        // The member-state RPC only accepts lowercase-underscore keys, so a
        // hyphenated (or otherwise unknown) key is dropped rather than stored.
        "admin-overview": "2026-10-06T10:00:00.000Z",
        tasks: 42,
        review: "   ",
        insights: { seen: true },
      },
      autoOpen: "no",
      unrelated: true,
    }),
    { guides: { day: "2026-10-06T10:00:00.000Z", admin_overview: "2026-10-06T10:00:00.000Z" }, autoOpen: true },
  );
});

test("guide keys are an explicit allowlist covering both workspaces", () => {
  assert.deepEqual([...WORK_OS_GUIDE_KEYS], [
    "day", "tasks", "review", "insights", "settings",
    "admin_overview", "admin_people", "admin_tasks", "admin_review", "admin_insights", "admin_evidence", "admin_settings",
  ]);
  assert.equal(isWorkOsGuideKey("day"), true);
  assert.equal(isWorkOsGuideKey("admin_overview"), true);
  assert.equal(isWorkOsGuideKey("admin_settings"), true);
  assert.equal(isWorkOsGuideKey("admin-overview"), false);
  assert.equal(isWorkOsGuideKey("admin-evidence"), false);
  assert.equal(isWorkOsGuideKey(7), false);
});

test("the client guide registry and the server allowlist name the same keys", async () => {
  const state = await source("desktop/work-os-companion/src/guideState.ts");
  const clientKeys = [...stringList(state, "EMPLOYEE_GUIDE_VIEWS"), ...stringList(state, "ADMIN_GUIDE_VIEWS")];
  assert.deepEqual(clientKeys, [...WORK_OS_GUIDE_KEYS], "a client guide key and the server allowlist have drifted");
});

test("administration page guides reuse the shared modal and masthead control", async () => {
  const workspace = await source("desktop/work-os-companion/src/admin/AdminWorkspace.tsx");
  // One icon-only control in the masthead utilities, named for the page, the
  // same contract as the employee masthead (§8.11). The guide state itself
  // stays in the app's seam: the workspace renders no second copy.
  assert.match(workspace, /className="icon guide-launch"/);
  assert.match(workspace, /aria-label=\{`How \$\{meta\.title\} works`\}/);
  assert.match(workspace, /onClick=\{\(\) => onOpenGuide\(guideView\)\}/);
  assert.doesNotMatch(workspace, /usePageGuides/);

  const app = await source("desktop/work-os-companion/src/App.tsx");
  assert.equal((app.match(/usePageGuides\(/g) ?? []).length, 1, "the app owns exactly one page-guide state");
  assert.match(app, /guideViewForAdminSection\(adminSection\)/);
  assert.match(app, /<AdminWorkspace/);
  assert.match(app, /pages=\{ADMIN_TOUR_PAGES\}/, "the administration tour walks the admin sections");
  assert.match(app, /className="icon guide-launch"/, "the employee masthead keeps its guide control");
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
  assert.match(migration, /revoke execute on function work_mark_guide_seen\(uuid, text\) from public/);
  assert.match(migration, /revoke execute on function work_set_guide_auto_open\(uuid, boolean\) from public/);
  assert.match(migration, /rolname = 'authenticated'/, "the legacy role revoke is guarded for Neon");
});
