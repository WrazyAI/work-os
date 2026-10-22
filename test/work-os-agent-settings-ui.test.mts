import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("settings renders the agent access panel", async () => {
  const settings = await read("src/modules/work-os/employee/EmployeeSettings.tsx");
  assert.match(settings, /import AgentAccessSettings from "\.\/AgentAccessSettings"/);
  assert.match(settings, /<AgentAccessSettings \/>/);
});

test("the panel mints, lists, and revokes person-scoped tokens", async () => {
  const panel = await read("src/modules/work-os/employee/AgentAccessSettings.tsx");
  assert.match(panel, /\/api\/work-os\/me\/agent-tokens/);
  assert.match(panel, /method: "POST"/);
  assert.match(panel, /method: "DELETE"/);
  assert.match(panel, /token_prefix/);
  assert.match(panel, /navigator\.clipboard/);
  assert.match(panel, /only time you will see it/i);
  assert.match(panel, /revoke/i);
  assert.doesNotMatch(panel, /token_hash/);
});

test("the panel offers the four scopes and bounded expiry", async () => {
  const panel = await read("src/modules/work-os/employee/AgentAccessSettings.tsx");
  for (const scope of ["tasks:read", "tasks:write", "progress:write", "evidence:write"]) {
    assert.match(panel, new RegExp(scope.replace(":", "\\:")), `missing ${scope}`);
  }
  assert.match(panel, /30/);
  assert.match(panel, /90/);
  assert.match(panel, /365/);
});
