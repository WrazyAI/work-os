import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { pickMembership, type WorkOsMembershipCandidate } from "../src/lib/work-os-membership";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (relative: string) => readFile(path.join(root, relative), "utf8");

function member(overrides: Partial<WorkOsMembershipCandidate> & { id: string; role: string }): WorkOsMembershipCandidate {
  return {
    organization_id: "org-default",
    person_id: null,
    feature_flags: {},
    created_at: "2026-10-16T21:49:07.187Z",
    ...overrides,
  };
}

test("tied created_at resolves to the admin membership regardless of row order", () => {
  // The regression: two memberships created by one statement share created_at,
  // so an earliest-first sort left the chosen organization to chance.
  const employee = member({ id: "emp", role: "employee", organization_id: "david-yeboah" });
  const admin = member({ id: "adm", role: "admin", organization_id: "wrazyai-owner" });

  assert.equal(pickMembership([employee, admin])?.id, "adm");
  assert.equal(pickMembership([admin, employee])?.id, "adm");
});

test("an earlier membership still wins even when it is not the highest role", () => {
  // Existing behaviour must survive: this is a tie-break, not a preference for
  // privileged roles across the whole set.
  const earlierEmployee = member({
    id: "emp", role: "employee", created_at: "2026-07-13T19:02:25.979Z",
  });
  const laterAdmin = member({
    id: "adm", role: "admin", created_at: "2026-08-23T21:25:32.829Z",
  });

  assert.equal(pickMembership([earlierEmployee, laterAdmin])?.id, "emp");
  assert.equal(pickMembership([laterAdmin, earlierEmployee])?.id, "emp");
});

test("manager outranks employee and sits below admin on a tie", () => {
  const admin = member({ id: "adm", role: "admin" });
  const manager = member({ id: "mgr", role: "manager" });
  const employee = member({ id: "emp", role: "employee" });

  assert.equal(pickMembership([employee, manager, admin])?.id, "adm");
  assert.equal(pickMembership([employee, manager])?.id, "mgr");
});

test("an unknown role ranks below employee and never wins a tie", () => {
  const unknown = member({ id: "zzz", role: "contractor" });
  const employee = member({ id: "emp", role: "employee" });

  assert.equal(pickMembership([unknown, employee])?.id, "emp");
  assert.equal(pickMembership([employee, unknown])?.id, "emp");
});

test("identical role and timestamp still resolve deterministically by id", () => {
  const a = member({ id: "aaa", role: "employee" });
  const b = member({ id: "bbb", role: "employee" });

  assert.equal(pickMembership([a, b])?.id, "aaa");
  assert.equal(pickMembership([b, a])?.id, "aaa");
});

test("unparseable timestamps fall through to the role tie-break", () => {
  // Infinity - Infinity is NaN, which would silently keep the first row and
  // skip every later tie-breaker.
  const brokenEmployee = member({ id: "bad-emp", role: "employee", created_at: "not-a-date" });
  const brokenAdmin = member({ id: "bad-adm", role: "admin", created_at: "not-a-date" });

  assert.equal(pickMembership([brokenEmployee, brokenAdmin])?.id, "bad-adm");
});

test("no candidates yields null", () => {
  assert.equal(pickMembership([]), null);
});

test("loadMembership ranks the fetched candidates instead of trusting row order", async () => {
  const api = await source("src/lib/work-os-api.ts");
  assert.match(api, /from\("work_org_members"\)[\s\S]{0,240}created_at/, "the query must select created_at to compare ties");
  assert.match(api, /pickMembership\(/, "the caller must delegate the choice to the tested selector");
  assert.doesNotMatch(
    api,
    /\.order\("created_at",\s*\{\s*ascending:\s*true\s*\}\)\s*\.limit\(1\)/,
    "a limit(1) server order is the arbitrary tie-break this fixes",
  );
});

test("the profile trigger no longer re-activates a deliberately deactivated membership", async () => {
  const sql = await source("supabase/migrations/0061_work_os_membership_determinism.sql");
  assert.match(sql, /create or replace function public\.work_link_profile_person/i);
  const body = sql.slice(sql.toLowerCase().indexOf("create or replace function"));
  assert.doesNotMatch(body, /active\s*=\s*true/i, "reactivating defeats deactivation and cannot be undone by an operator");
  assert.match(body, /person_id\s*=\s*excluded\.person_id/i, "person linking must still refresh on conflict");
});
