# Agent Access Phase B — MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the live agent task surface as seven MCP tools at `/api/mcp`, authenticated by the same scoped `wos_agent_…` bearer tokens, with no second auth path and no separate server package.

**Architecture:** A stateless Streamable HTTP route creates one `McpServer` and one `WebStandardStreamableHTTPServerTransport` per POST. The tools are thin wrappers over the existing person-scoped REST services (`listAgentTasks`, `getAgentTask`, `createAgentTask`, `updateAgentTask`, `completeAgentTask`, `addAgentProgress`, completion evidence). Scope, rate limiting, idempotency, and provenance stay in one place.

**Tech Stack:** Next.js 16 route handler · `@modelcontextprotocol/sdk` 1.29.0 · `zod/v4` (4.4.3, already installed) · `node:test` + the SDK in-memory transport · the REST agent services from Phase A.

**Spec:** `docs/superpowers/specs/2026-10-21-agent-access-design.md` (MCP section) and Phase B of `docs/superpowers/plans/2026-10-22-agent-access-layer.md`.

## Global Constraints

- Same token, same scopes, same person as REST. No MCP-specific credential, no cross-person access.
- Tool names are exactly `list_tasks`, `get_task`, `create_task`, `update_task`, `complete_task`, `log_progress`, `attach_evidence`.
- Scope map: reads → `tasks:read`; create/update/complete → `tasks:write`; progress → `progress:write`; evidence → `evidence:write`.
- Completion remains evidence-gated. Evidence is employee-attached, never provider confirmation, never proof by itself.
- `attach_evidence` takes base64 bytes, not a URL. 8 MB cap, existing magic-byte validation, no raw storage paths.
- Write tools are idempotent. `create_task`, `log_progress`, and `attach_evidence` accept an optional `idempotency_key`; when omitted, derive a stable key from the tool name and canonical arguments.
- Rate limits are the Phase A limits: 120 requests and 20 writes per minute per token. Tool errors report `rate_limited` with `retry_after`.
- Transport is stateless Streamable HTTP with JSON responses. POST only; GET and DELETE answer `405` with a JSON-RPC error.
- `/api/mcp` authenticates itself. Keep it out of the proxy body buffer (a base64 8 MB file exceeds the 10 MB proxy limit), like the existing large-upload exclusions.
- Never log or return a raw token or token hash. Tool results never include credentials.
- No companion release and no new web UI. Server-only delivery.
- MCP clients use `Authorization: Bearer wos_agent_…` and `Accept: application/json, text/event-stream`.

## Review Focus

- A read-only token must connect to the MCP session and list tools, but `create_task`/`complete_task` must return an `insufficient_scope` tool error, not a transport failure.
- A repeated `create_task` with identical arguments must return the same task id and never create a second row.
- `attach_evidence` must reject empty, oversized, wrong-type, or corrupt base64 with a clear tool error, and a valid 8 MB payload must reach the route (proxy body exclusion) rather than being truncated.
- Cross-person or archived task ids passed to `get_task`, `complete_task`, or `update_task` must produce `not_found`, never a task or a 500.
- Revoked and expired tokens must fail at the transport with `401`; a valid token's tool results must contain no token material.

---

### Task 1: MCP tool module and in-memory tests

**Files:**
- Create: `src/lib/work-agent-mcp.ts`
- Create: `test/work-os-agent-mcp.test.mts`
- Modify: `package.json` (add `zod` as a direct dependency; append the test to `work-os:test`)
- Modify: `package-lock.json`

**Interfaces:**
- Produces `AGENT_MCP_TOOL_NAMES` (the seven names, in the design's order).
- Produces `type AgentMcpServices` with one function per tool: `listTasks`, `getTask`, `createTask`, `updateTask`, `completeTask`, `addProgress`, `attachEvidence`.
- Produces `createAgentMcpServer(agent: AgentAccess, services?: AgentMcpServices): McpServer`.
- Produces `agentMcpIdempotencyKey(tool: string, input: unknown): string`, `mcpToolResult(value: unknown)`, `mcpToolError(code, message, extra?)`, `mcpToolErrorFrom(error)`.
- Produces `decodeEvidenceBase64(value: string): Uint8Array`.

- [ ] **Step 1: Add the direct dependency and failing tests**

Run `npm install --package-lock-only --ignore-scripts zod@^4.4.3` and confirm `package.json` lists `"zod": "^4.4.3"`. The package is already installed at 4.4.3; do not install into a running server's `node_modules`.

Create `test/work-os-agent-mcp.test.mts` with:

```ts
test("the MCP registry exposes exactly the seven design tools", async () => {
  const { client, close } = await connectTestMcp(agentWith(["tasks:read", "tasks:write", "progress:write", "evidence:write"]));
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name), [
    "list_tasks", "get_task", "create_task", "update_task",
    "complete_task", "log_progress", "attach_evidence",
  ]);
  await close();
});

test("identical create arguments reuse the derived idempotency key", async () => {
  assert.equal(agentMcpIdempotencyKey("create_task", { name: "Ship" }), agentMcpIdempotencyKey("create_task", { name: "Ship" }));
  assert.notEqual(agentMcpIdempotencyKey("create_task", { name: "Ship" }), agentMcpIdempotencyKey("create_task", { name: "Ship 2" }));
  assert.ok(agentMcpIdempotencyKey("create_task", { name: "Ship" }).length <= 160);
});

test("a read-only token gets a scope error, not a transport failure", async () => {
  const { client, close } = await connectTestMcp(agentWith(["tasks:read"]));
  const result = await client.callTool({ name: "create_task", arguments: { name: "Blocked" } });
  assert.equal(result.isError, true);
  assert.match(textOf(result), /insufficient_scope/);
  await close();
});

test("evidence base64 is decoded and bounded before the service sees it", () => {
  const png = Buffer.from("89504e470d0a1a0a", "hex");
  assert.deepEqual(decodeEvidenceBase64(png.toString("base64")), new Uint8Array(png));
  assert.throws(() => decodeEvidenceBase64(""), /required/i);
  assert.throws(() => decodeEvidenceBase64("!!!!"), /base64/i);
  assert.throws(
    () => decodeEvidenceBase64(Buffer.alloc(8 * 1024 * 1024 + 1).toString("base64")),
    /8 MB|smaller|large/i,
  );
});
```

`connectTestMcp` builds an `AgentAccess` with a unique `tokenId`, fake services, and `InMemoryTransport.createLinkedPair()`. The fakes record calls; `createTask` returns the task id and captures the key; `completeTask` returns `{ task }`. Import `Client` from `@modelcontextprotocol/sdk/client/index.js` and `InMemoryTransport` from `@modelcontextprotocol/sdk/inMemory.js`.

- [ ] **Step 2: Run and confirm it fails**

Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" node --import tsx --test test/work-os-agent-mcp.test.mts`
Expected: FAIL because `work-agent-mcp.ts` does not exist.

- [ ] **Step 3: Implement the tool module**

Use `import * as z from "zod/v4"` and `new McpServer({ name: "work-os-agent", version: "1.0.0" })`. Each tool has a description that names its scope.

- `list_tasks`: `{ updated_since?, include_archived?, limit?, cursor? }`; `tasks:read`; calls `services.listTasks`; returns `{ tasks, cursor }`.
- `get_task`: `{ task_id }`; `tasks:read`; returns the detail object.
- `create_task`: `{ name, description?, due_date?, start_date?, priority?, labels?, expected_outcome?, definition_of_done?, parent_task_id?, project_id?, idempotency_key? }`; `tasks:write`; strips the key; calls `services.createTask(agent, body, key)`; returns `{ task }`.
- `update_task`: `{ task_id, name?, description?, due_date?, start_date?, priority?, labels?, story_points?, expected_outcome?, definition_of_done?, blocked?, blocked_reason? }`; `tasks:write`; returns `{ task }`.
- `complete_task`: `{ task_id }`; `tasks:write`; returns the completion result.
- `log_progress`: `{ task_id, summary, title?, url?, idempotency_key? }`; `progress:write`; returns `{ evidence }`.
- `attach_evidence`: `{ task_id, file_name, content_type, content_base64, note?, complete?, idempotency_key? }`; `evidence:write`; decodes bytes, attaches, optionally completes; `complete` defaults to false, so the caller can attach first and call `complete_task` separately; returns `{ evidence, task }`.

Every write calls `assertAgentRateLimit(agent.tokenId, true)`; reads call it with `false`. Every tool checks `hasAgentScope` before touching a service.

`agentMcpIdempotencyKey` returns `` `mcp:${tool}:${agentRequestHash("MCP", tool, input)}` ``. `decodeEvidenceBase64` rejects blank strings, non-canonical base64 with invalid characters, zero bytes, and more than `COMPLETION_EVIDENCE_MAX_BYTES`; throw `WorkOsValidationError`/`CompletionEvidenceError` so `mcpToolErrorFrom` maps the code.

`mcpToolErrorFrom` handles `AgentRateLimitError` (`rate_limited`, `retry_after`), `CompletionEvidenceError` (`file_too_large`, `unsupported_file_type`, or `validation_error`), and otherwise reuses `agentRouteError`'s body for conflict/validation/not-found/internal codes. `mcpToolResult` returns `{ content: [{ type: "text", text: JSON.stringify(value) }] }`; `mcpToolError` returns the same shape with `isError: true` and `{ error, code, ...extra }`.

- [ ] **Step 4: Run tests and typecheck**

Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" node --import tsx --test test/work-os-agent-mcp.test.mts`
Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" npm run work-os:typecheck`
Expected: PASS both.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/lib/work-agent-mcp.ts test/work-os-agent-mcp.test.mts
git commit -m "feat(work-os): add the MCP tool registry"
```

---

### Task 2: Stateless MCP route, proxy allowance, and docs

**Files:**
- Create: `src/app/api/mcp/route.ts`
- Modify: `src/proxy.ts` (large-body matcher exclusion)
- Modify: `tsconfig.work-os.json` (include `src/app/api/mcp/**/*.ts`)
- Modify: `docs/AGENT-API.md` (MCP section)
- Modify: `test/work-os-agent-mcp.test.mts` (route/proxy contract assertions)

**Interfaces:**
- Consumes `requireAgentAccess(req)` from `src/lib/work-agent-auth.ts` and `createAgentMcpServer` from Task 1.
- Produces `POST /api/mcp` and `405` JSON-RPC responses for GET/DELETE.

- [ ] **Step 1: Write the failing contract tests**

Add to the MCP test file:

```ts
test("the MCP route authenticates the bearer and uses the stateless web transport", async () => {
  const route = await readFile("src/app/api/mcp/route.ts");
  assert.match(route, /requireAgentAccess\(request\)/);
  assert.match(route, /WebStandardStreamableHTTPServerTransport/);
  assert.match(route, /sessionIdGenerator: undefined/);
  assert.match(route, /enableJsonResponse: true/);
  assert.match(route, /export async function POST/);
  assert.match(route, /405/);
});

test("the proxy leaves the MCP body unbuffered", async () => {
  const proxy = await readFile("src/proxy.ts");
  assert.match(proxy, /api\/mcp/);
  assert.match(proxy, /api\/downloads/);
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" node --import tsx --test test/work-os-agent-mcp.test.mts`
Expected: FAIL because the route and matcher exclusion do not exist.

- [ ] **Step 3: Implement the route**

```ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireAgentAccess(request);
  if (auth.response) return auth.response;
  const server = createAgentMcpServer(auth.agent);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}
```

Return `405` with `{ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }` for `GET` and `DELETE`. Do not create a global session map; the transport is stateless. Do not require a scope at the transport; each tool enforces its scope.

In `src/proxy.ts`, add `api/mcp` to the matcher's negative lookahead next to `api/downloads`, with a comment that the route validates its own bearer and may carry an 8 MB evidence payload that must not be buffered/truncated. Add `src/app/api/mcp/**/*.ts` to `tsconfig.work-os.json`.

In `docs/AGENT-API.md`, add an “MCP” section: endpoint, bearer header, stateless streamable HTTP, 405 for GET/DELETE, the seven-tool table with scopes, base64 evidence, derived idempotency, rate limits, and a small `Client`/`StreamableHTTPClientTransport` snippet.

- [ ] **Step 4: Run tests, typecheck, and the existing agent suite**

Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" node --import tsx --test test/work-os-agent-mcp.test.mts`
Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" npm run work-os:typecheck`
Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" npm run work-os:test`
Expected: PASS; no new failures.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/mcp/route.ts src/proxy.ts tsconfig.work-os.json docs/AGENT-API.md test/work-os-agent-mcp.test.mts package.json
git commit -m "feat(work-os): serve the MCP endpoint"
```

---

### Task 3: Deploy and verify with a real MCP client

**Files:**
- Modify: `docs/AGENT-API.md` only if live behavior differs.

- [ ] **Step 1: Run the full local gate**

Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" npm run work-os:typecheck`
Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" npm run work-os:test`
Expected: PASS. Treat the backend harness as lint; the live client below is the behavior evidence.

- [ ] **Step 2: Push and converge**

Rebase on the latest `origin/main`, push `work-os` main, converge the changed files to `agentos/main` per AGENTS.md, and redeploy on the VPS with the atomic path. Verify `/api/mcp` answers `401` without a token and `405` to GET. No database migration is needed.

- [ ] **Step 3: Mint a token and run the live MCP client**

Use the authenticated e2e admin session to mint a token with all four scopes; store it privately. Run a Node script with:

```ts
const transport = new StreamableHTTPClientTransport(new URL("https://app.wrazyos.com/api/mcp"), {
  requestInit: { headers: { Authorization: `Bearer ${token}` } },
});
const client = new Client({ name: "work-os-verify", version: "1.0.0" });
await client.connect(transport);
```

Assert:
1. `listTools` returns the seven names.
2. `create_task` returns a task; the same call again returns the same id.
3. `log_progress` returns evidence with `origin = agent_progress`.
4. `attach_evidence` with a small base64 PNG returns evidence; `complete_task` completes; `get_task` shows the task, evidence, and activity-worthy state.
5. `list_tasks` includes the tasks and the change-feed cursor.
6. A second token with only `tasks:read` connects and lists tools, but `create_task` returns `insufficient_scope`.
7. Revoking the token makes a new client connection fail with 401.
8. A task assigned to another person returns `not_found` through `get_task`.

Clean up the verification tasks through the internal employee delete route and revoke every test token. Record exact statuses and the tool outputs in the final report.

- [ ] **Step 4: Record the live result**

Append the deployed identities and the live tool-call results to `docs/AGENT-API.md` only if a documented behavior changed. Commit any documentation correction.

## Self-Review

Spec coverage: the design's MCP section requires the streamable HTTP endpoint, the seven tools, the same bearer token, and no second auth path. Task 1 covers the tool registry and service mapping; Task 2 the transport route, proxy body handling, and docs; Task 3 the live MCP client. Idempotency, scopes, evidence limits, provenance, and rate limits are inherited from Phase A and explicitly exercised.

The transport is stateless by decision: the VPS runs one web process, but a session map would add state to a shim that does not need it. The official SDK stateless example supports this shape; the live client is the proof.

The evidence base64 path is the one large-body exception. The proxy exclusion is required and is pinned by a contract test.

No MCP-specific credential, database migration, companion release, or web UI is part of this plan.
