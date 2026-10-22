import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("agent token routes are self-service and person-scoped", async () => {
  const list = await read("src/app/api/work-os/me/agent-tokens/route.ts");
  const revoke = await read("src/app/api/work-os/me/agent-tokens/[tokenId]/route.ts");
  for (const source of [list, revoke]) {
    assert.match(source, /requireWorkOsAccess\(/, "the route must use the employee session guard");
    assert.match(source, /requirePerson: true/, "a token always belongs to a person");
    assert.doesNotMatch(source, /roles:\s*\[/, "token management never requires or grants an admin role");
    assert.doesNotMatch(source, /token_hash/, "the raw hash never leaves the data layer");
  }
  assert.match(list, /listAgentTokens\(/);
  assert.match(list, /createAgentToken\(/);
  assert.match(list, /secret/, "only creation returns the one-time secret");
  assert.match(list, /status: 201/);
  assert.match(revoke, /revokeAgentToken\(/);
  assert.match(revoke, /status: 404/, "revoking someone else's token is a not-found");
});

test("the create route validates the documented fields", async () => {
  const list = await read("src/app/api/work-os/me/agent-tokens/route.ts");
  assert.match(list, /expires_in_days/);
  assert.match(list, /name/);
  assert.match(list, /scopes/);
  assert.match(list, /Unknown field|unknown field|unrecognized/i);
});
