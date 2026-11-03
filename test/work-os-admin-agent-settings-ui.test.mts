import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("admin settings exposes the admin token panel behind the flag", async () => {
  const settings = await read("src/modules/work-os/admin/AdminSettings.tsx");
  assert.match(settings, /AdminAgentAccess/);
  assert.match(settings, /admin_agent_api/);
  assert.match(settings, /organizationFlags\.admin_agent_api === true/, "the panel stays behind the organization flag");
  assert.match(settings, /Admin agent access is off/, "the disabled state is stated quietly");
});

test("the panel mints, lists, and revokes admin tokens", async () => {
  const panel = await read("src/modules/work-os/admin/AdminAgentAccess.tsx");
  assert.match(panel, /\/api\/work-os\/me\/admin-agent-tokens/);
  assert.match(panel, /method: "POST"/);
  assert.match(panel, /method: "DELETE"/);
  assert.match(panel, /wos_admin_/);
  assert.match(panel, /only time you will see it/i);
  assert.doesNotMatch(panel, /token_hash/);
});

test("the panel offers every admin scope and bounded expiry", async () => {
  const panel = await read("src/modules/work-os/admin/AdminAgentAccess.tsx");
  for (const scope of ["people:read", "tasks:read", "tasks:write", "eods:read", "eods:review", "records:read", "insights:read"]) {
    assert.match(panel, new RegExp(scope), `missing ${scope}`);
  }
  assert.match(panel, /30/);
  assert.match(panel, /90/);
  assert.match(panel, /365/);
});

test("a failed token list is an error state, not an empty state", async () => {
  const panel = await read("src/modules/work-os/admin/AdminAgentAccess.tsx");
  assert.match(panel, /tokens\.isError \?/, "the panel branches on the list error");
  assert.match(panel, /tokens\.refetch\(\)/, "the error state offers a retry");
  assert.match(panel, /tokens\.isError \?[\s\S]*?\) : rows\.length \?/, "the error branch precedes the empty state");
  assert.match(panel, /create\.reset\(\)/, "dismissing the secret clears the mutation result");
  assert.match(panel, /Expired/, "expired tokens carry their own pill");
  assert.match(panel, /restoreRevokeFocusTo/, "cancel restores focus to the revoke trigger");
});

test("every settings feature is org-writable, but membership cannot enable the admin agent API", async () => {
  const settings = await read("src/modules/work-os/admin/AdminSettings.tsx");
  const organizationRoute = await read("src/app/api/work-os/organization/route.ts");
  const rendered = [...settings.matchAll(/\{ key: "([^"]+)", label: "/g)].map((match) => match[1]);
  const orgSet = organizationRoute.match(/const FEATURES = new Set\(\[([^\]]*)\]\)/);
  assert.ok(orgSet, "the organization route declares its writable feature set");
  assert.ok(rendered.length >= 8, "the settings feature list was parsed");
  const orgKeys = [...orgSet[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  for (const key of rendered) {
    assert.ok(orgKeys.includes(key), `${key} is rendered by AdminSettings but not writable by the organization PATCH`);
  }
  assert.ok(orgKeys.includes("admin_agent_api"));
  const membershipExpression = organizationRoute.match(/const MEMBERSHIP_FEATURES = (new Set\([^;]*?\));/);
  assert.ok(membershipExpression, "the organization route declares a restricted membership set");
  const membershipFeatures = new Function("FEATURES", `return ${membershipExpression[1]}`)(new Set(orgKeys)) as Set<string>;
  assert.equal(membershipFeatures.has("admin_agent_api"), false, "a membership override cannot enable the admin agent API");
  for (const key of rendered.filter((key) => key !== "admin_agent_api")) {
    assert.ok(membershipFeatures.has(key), `${key} remains overridable per member`);
  }
  assert.match(organizationRoute, /MEMBERSHIP_FEATURES\.has\(key\)/, "the membership branch uses the restricted set");
});


test("admin token routes are admin-session guarded and feature-gated", async () => {
  const list = await read("src/app/api/work-os/me/admin-agent-tokens/route.ts");
  const revoke = await read("src/app/api/work-os/me/admin-agent-tokens/[tokenId]/route.ts");
  for (const source of [list, revoke]) {
    assert.match(source, /requireWorkOsAccess\(/, "the route must use the session guard");
    assert.match(source, /roles: \["admin"\]/, "admin token management requires an admin membership");
    assert.match(source, /feature: "employee_companion"/);
    assert.match(source, /admin_agent_api/, "the admin agent API flag gates the route");
    assert.match(source, /feature_disabled/);
    assert.match(source, /status: 403/);
    assert.doesNotMatch(source, /requirePerson: true/, "admin tokens may exist without a person mapping");
    assert.doesNotMatch(source, /token_hash/, "the raw hash never leaves the data layer");
  }
  assert.match(list, /listAdminAgentTokens\(/);
  assert.match(list, /createAdminAgentToken\(/);
  assert.match(list, /secret/, "only creation returns the one-time secret");
  assert.match(list, /status: 201/);
  assert.match(list, /expires_in_days/);
  assert.match(list, /Unknown field|unknown field|unrecognized/i);
  assert.match(revoke, /revokeAdminAgentToken\(/);
  assert.match(revoke, /status: 404/, "revoking someone else's token is a not-found");
});
