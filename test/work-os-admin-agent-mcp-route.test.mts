import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DELETE, GET, POST } from "../src/app/api/agent/admin/mcp/route";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const ENDPOINT = "https://example.test/api/agent/admin/mcp";

function post(headers: Record<string, string>, body = "{}") {
  return new Request(ENDPOINT, { method: "POST", headers, body });
}

/** The MCP error shape is JSON-RPC; the admin auth contract is
 * `{ error, code, request_id }`. One reader for both, so a test can tell which
 * layer answered. */
async function jsonBody(response: Response) {
  return await response.json() as {
    jsonrpc?: string;
    error?: { code?: number; message?: string } | string;
    id?: unknown;
    code?: string;
    request_id?: string;
  };
}

function adminErrorOf(body: { error?: { code?: number; message?: string } | string }) {
  return typeof body.error === "object" && body.error !== null ? body.error : null;
}

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

test("the admin MCP route requires a declared body length before authenticating", async () => {
  const route = await read("src/app/api/agent/admin/mcp/route.ts");
  assert.match(route, /MAX_BODY_BYTES/);
  assert.match(route, /content-length/i);
  assert.match(route, /413/);
  // A declared-length check only bounds the body if a missing length is refused
  // too; a chunked POST has no length and would otherwise slip past the cap.
  assert.match(route, /declaredBodyBytes/);
  const boundIndex = route.search(/declaredBodyBytes\(request\)/);
  const authIndex = route.search(/requireAdminAgentAccess\(request\)/);
  assert.ok(boundIndex > -1 && authIndex > boundIndex, "the body bound runs before auth");
});

test("the admin MCP route stays separate from the employee MCP endpoint", async () => {
  const route = await read("src/app/api/agent/admin/mcp/route.ts");
  assert.doesNotMatch(route, /createAgentMcpServer\(/);
  assert.doesNotMatch(route, /requireAgentAccess\(/);
  assert.match(route, /createAdminAgentMcpServer/);
});

test("the proxy matcher excludes the admin MCP body", async () => {
  const proxy = await read("src/proxy.ts");
  // Assert the alternation, not the bare path: the path also appears in a
  // comment above the matcher, so a loose match would pass without the rule.
  assert.match(proxy, /api\/mcp\|api\/agent\/admin\/mcp/);
  assert.match(proxy, /api\/downloads/);
});

test("GET and DELETE answer 405 with an Allow header and a JSON-RPC error", async () => {
  for (const [name, handler] of [["GET", GET], ["DELETE", DELETE]] as const) {
    const response = handler();
    assert.equal(response.status, 405, `${name} must be 405`);
    assert.equal(response.headers.get("allow"), "POST", `${name} must advertise POST only`);
    const body = await jsonBody(response);
    const error = adminErrorOf(body);
    assert.equal(body.jsonrpc, "2.0", `${name} must answer JSON-RPC`);
    assert.equal(error?.code, -32000);
    assert.match(error?.message ?? "", /not allowed/i);
    assert.equal(body.id, null);
  }
});

test("an oversize declared length is 413 and never reaches auth", async () => {
  const response = await POST(post({ "content-length": String(13 * 1024 * 1024) }));
  assert.equal(response.status, 413);
  const body = await jsonBody(response);
  // The admin auth error contract carries `request_id`; its absence proves the
  // 413 came from the body bound rather than from a failed token lookup.
  assert.equal(body.request_id, undefined);
  assert.equal(body.jsonrpc, "2.0");
  assert.equal(adminErrorOf(body)?.code, -32600);
  assert.match(adminErrorOf(body)?.message ?? "", /too large/i);
});

test("a missing content-length is 413 instead of an unbounded read", async () => {
  const response = await POST(post({ "content-type": "application/json" }));
  assert.equal(response.status, 413);
  const body = await jsonBody(response);
  assert.equal(body.request_id, undefined);
  assert.equal(body.jsonrpc, "2.0");
  assert.match(adminErrorOf(body)?.message ?? "", /content-length/i);
});

test("a malformed content-length is 413", async () => {
  for (const value of ["", "12mb", "-1", "1e6", "1.5", "Infinity", "99999999999999999999"]) {
    const response = await POST(post({ "content-length": value }));
    assert.equal(response.status, 413, `content-length ${JSON.stringify(value)} must be rejected`);
    const body = await jsonBody(response);
    assert.equal(body.request_id, undefined, `content-length ${JSON.stringify(value)} never reaches auth`);
    assert.equal(body.jsonrpc, "2.0");
  }
});

test("a bounded declared length reaches authentication", async () => {
  // The body passes the bound and the admin auth helper answers 401 for a
  // missing bearer before any database lookup, which proves the 413 above is
  // the bound and not a blanket rejection.
  const response = await POST(post({ "content-length": "2", "content-type": "application/json" }, "{}"));
  assert.equal(response.status, 401);
  const body = await jsonBody(response);
  assert.equal(typeof body.error, "string", "the admin auth contract answers, not the transport");
  assert.match(String(body.error), /admin agent token/i);
  assert.equal(body.code, "unauthorized");
  assert.equal(typeof body.request_id, "string");
});
