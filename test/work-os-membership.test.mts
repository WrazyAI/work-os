import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  selectWorkOsMembership,
  type WorkOsMembershipCandidate,
} from "../src/lib/work-os-membership";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (relative: string) => readFile(path.join(root, relative), "utf8");

function member(overrides: Partial<WorkOsMembershipCandidate> & { id: string; role: string }): WorkOsMembershipCandidate {
  return {
    organization_id: "org-default",
    person_id: null,
    feature_flags: {},
    created_at: "2026-10-16T21:49:07.187Z",
    organization_name: "Workspace",
    ...overrides,
  };
}

test("an explicit workspace selects that membership, never a privileged sibling", () => {
  const employee = member({ id: "emp", role: "employee", organization_id: "david-yeboah", organization_name: "David Yeboah Workspace" });
  const admin = member({ id: "adm", role: "admin", organization_id: "wrazyai-owner", organization_name: "WrazyAI Owner Workspace" });

  assert.equal(selectWorkOsMembership([employee, admin], "david-yeboah").kind, "selected");
  const chosen = selectWorkOsMembership([employee, admin], "david-yeboah");
  assert.ok(chosen.kind === "selected");
  assert.equal(chosen.membership.id, "emp");
  const reversed = selectWorkOsMembership([admin, employee], "david-yeboah");
  assert.ok(reversed.kind === "selected");
  assert.equal(reversed.membership.id, "emp");
});

test("an explicit workspace that the account does not hold resolves to nothing", () => {
  const only = member({ id: "emp", role: "employee", organization_id: "org-a" });
  assert.equal(selectWorkOsMembership([only], "org-b").kind, "none");
});

test("one membership selects itself without a choice", () => {
  const only = member({ id: "emp", role: "employee", organization_id: "org-a" });
  const selection = selectWorkOsMembership([only]);
  assert.ok(selection.kind === "selected");
  assert.equal(selection.membership.id, "emp");
});

test("more than one membership requires an explicit choice and keeps every candidate", () => {
  const b = member({ id: "b", role: "employee", organization_id: "org-b", organization_name: "Beta Workspace" });
  const a = member({ id: "a", role: "admin", organization_id: "org-a", organization_name: "Alpha Workspace" });
  const selection = selectWorkOsMembership([b, a]);

  assert.ok(selection.kind === "required");
  assert.deepEqual(selection.memberships.map((row) => row.id), ["a", "b"], "choices are ordered by workspace name");
});

test("the chooser order is stable regardless of query row order", () => {
  const one = member({ id: "z", role: "employee", organization_id: "org-z", organization_name: "Zeta" });
  const two = member({ id: "a", role: "admin", organization_id: "org-a", organization_name: "Alpha" });

  const first = selectWorkOsMembership([one, two]);
  const second = selectWorkOsMembership([two, one]);
  assert.ok(first.kind === "required" && second.kind === "required");
  assert.deepEqual(first.memberships.map((row) => row.id), ["a", "z"]);
  assert.deepEqual(second.memberships.map((row) => row.id), ["a", "z"]);
});

test("no memberships yields nothing", () => {
  assert.equal(selectWorkOsMembership([]).kind, "none");
});

test("the API resolves through the selector and asks instead of picking a workspace", async () => {
  const api = await source("src/lib/work-os-api.ts");
  assert.match(api, /selectWorkOsMembership\(/, "the caller must delegate the choice to the tested selector");
  assert.match(api, /readWorkOsOrganizationCookie\(/, "the web's per-device choice must be read");
  assert.match(api, /workspace_selection_required/, "multiple memberships must return an actionable selection state");
  assert.doesNotMatch(api, /pickMembership/, "the silent oldest/privileged pick must be gone");
  assert.doesNotMatch(
    api,
    /\.order\("created_at",\s*\{\s*ascending:\s*true\s*\}\)\s*\.limit\(1\)/,
    "a limit(1) server order is the arbitrary tie-break this replaces",
  );
});

test("the profile trigger no longer re-activates a deliberately deactivated membership", async () => {
  const sql = await source("supabase/migrations/0061_work_os_membership_determinism.sql");
  assert.match(sql, /create or replace function public\.work_link_profile_person/i);
  const body = sql.slice(sql.toLowerCase().indexOf("create or replace function"));
  assert.doesNotMatch(body, /active\s*=\s*true/i, "reactivating defeats deactivation and cannot be undone by an operator");
  assert.match(body, /person_id\s*=\s*excluded\.person_id/i, "person linking must still refresh on conflict");
});
