import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the admin MCP route is POST-only and bounded", async () => {
  const route = await read("src/app/api/agent/admin/mcp/route.ts");
  assert.match(route, /export async function POST/);
  assert.match(route, /export function GET/);
  assert.match(route, /export function DELETE/);
  assert.match(route, /12 \* 1024 \* 1024/);
  assert.match(route, /requireAdminAgentAccess/);
});

test("the admin MCP route serves the stateless web transport", async () => {
  const route = await read("src/app/api/agent/admin/mcp/route.ts");
  assert.match(route, /export const runtime = "nodejs"/);
  assert.match(route, /export const dynamic = "force-dynamic"/);
  assert.match(route, /WebStandardStreamableHTTPServerTransport/);
  assert.match(route, /sessionIdGenerator: undefined/);
  assert.match(route, /enableJsonResponse: true/);
  assert.match(route, /createAdminAgentMcpServer\(auth\.agent\)/);
  assert.match(route, /await server\.close\(\)/);
  assert.match(route, /Allow: "POST"/);
});

test("the admin MCP route rejects oversize bodies before authenticating", async () => {
  const route = await read("src/app/api/agent/admin/mcp/route.ts");
  assert.match(route, /MAX_BODY_BYTES/);
  assert.match(route, /content-length/i);
  assert.match(route, /413/);
  const contentLengthIndex = route.search(/content-length/i);
  const authIndex = route.search(/requireAdminAgentAccess\(request\)/);
  assert.ok(contentLengthIndex > -1 && authIndex > contentLengthIndex, "the body bound runs before auth");
});

test("the admin MCP route stays separate from the employee MCP endpoint", async () => {
  const route = await read("src/app/api/agent/admin/mcp/route.ts");
  assert.doesNotMatch(route, /createAgentMcpServer\(/);
  assert.doesNotMatch(route, /requireAgentAccess\(/);
  assert.match(route, /createAdminAgentMcpServer/);
});

test("the proxy matcher excludes the admin MCP body", async () => {
  const proxy = await read("src/proxy.ts");
  assert.match(proxy, /api\/agent\/admin\/mcp/);
  assert.match(proxy, /\|api\/mcp\|/);
});
