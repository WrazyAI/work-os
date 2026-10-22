# Agent Access Layer (REST + token management) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship self-minted, scoped agent credentials and a versioned, documented, retry-safe REST surface at `/api/agent/v1` for the work assigned to one person.

**Architecture:** A new `/api/agent/v1` namespace authenticates `wos_agent_…` bearer tokens, resolves the token to the same `WorkOsAccess` the employee API uses, and then reuses the existing person-scoped task services. Idempotency is a response cache keyed by `(token_id, key)` plus unique operation keys; token management lives in the existing web employee settings. The OpenAPI file is the contract and a test enforces route coverage in both directions.

**Tech Stack:** Next.js 16 App Router route handlers · Node `pg` PostgREST-compatible data shim · Neon Postgres · React Query · `node:test` with `tsx` · `js-yaml` for contract tests.

**Spec:** `docs/superpowers/specs/2026-10-21-agent-access-design.md`

## Global Constraints

- A token is bound to exactly one organization, one person, and one user. No cross-person reads or writes; out-of-scope ids answer `404`, never `403`.
- Tokens are self-minted only. An administrator cannot mint a token for another person.
- Token format `wos_agent_<32 random bytes base64url>`; store SHA-256 hex only; show the secret once; display the first 12 characters as the prefix.
- Default lifetime 90 days, minimum 1, maximum 365; revoked and expired tokens fail immediately.
- Scopes: `tasks:read`, `tasks:write`, `progress:write`, `evidence:write`. Default mint is read + write + progress; evidence is opt-in.
- Every write requires `Idempotency-Key` (1–160 characters).
- Rate limit: 120 requests/minute and 20 writes/minute per token; `429` with `Retry-After`.
- Error body is `{ error, code, request_id }`; codes are limited to the design's list.
- Completion still passes the existing evidence gate. Agent writes use `agent` provenance and never record employee memory as the person's own action.
- No Nifty write path. All current tasks have `provider = 'local'`.
- Never log, return, or audit a raw token or token hash.
- Do not change the internal `/api/work-os/*` auth contract or route matchers.
- MCP is Phase B and gets its own plan after this REST surface is live; the SDK is already a dependency.

## Implementation Constraints

The data layer (`src/lib/db/query.ts`) executes one statement per call over a `pg` pool and exposes no multi-statement transaction. This plan therefore guarantees retry safety with operation-level uniqueness instead of one enclosing transaction:

- A create writes `work_tasks.agent_idempotency_key` at insert time under a partial unique index, so a crash cannot produce a second task.
- Complete/reopen are naturally idempotent: the day-event key includes the stable `completed_at`, and the evidence gate is re-checked on retry.
- Progress and evidence already have unique `(organization_id, idempotency_key)` indexes.
- `work_agent_idempotency` is a response cache with an in-flight claim. A stale claim is retried after 60 seconds; the operation-level keys make the retry safe.
- A batch applies per-item idempotent operations and returns per-item results. It is **not** all-or-none; a retry never duplicates an applied item, but it does not roll back siblings. This is the one deliberate deviation from the design's "one transaction" sentence, forced by the current data client. Reject the plan at review if strict atomicity is required.

## Review Focus

- A token for person A requesting person B's task id must return `404` without revealing the task; archived and deleted tasks must not leak.
- Revoked or expired tokens must fail closed even when `last_used_at` is fresh; revocation is checked before scopes.
- A retried create with the same key must return the same task id and must never create a second row, even if the first response was lost.
- A gated task must not complete through the agent route without evidence, and a failed completion must keep the evidence for a completion-only retry.
- A token missing `tasks:write`, `progress:write`, or `evidence:write` must not mutate; `/me` must work for any valid token.

---

### Task 1: Migration and schema contract

**Files:**
- Create: `supabase/migrations/0063_work_agent_access.sql`
- Create: `test/work-os-agent-migration.test.mts`

**Interfaces:**
- Produces tables `work_agent_tokens`, `work_agent_idempotency`.
- Produces `work_tasks.agent_token_id`, `work_tasks.agent_idempotency_key`, `work_task_blockers.agent_token_id`.
- Produces RPC `work_agent_list_tasks(p_user_id uuid, p_organization_id uuid, p_person_id uuid, p_nifty_member_id text, p_updated_since timestamptz, p_include_archived boolean, p_ascending boolean, p_after_updated_at timestamptz, p_after_id uuid, p_limit integer) returns table(task jsonb)`.

- [ ] **Step 1: Write the failing schema test**

Assert the migration file exists and contains the two tables, the token columns (`token_hash`, `token_prefix`, `scopes`, `expires_at`, `last_used_at`, `revoked_at`), the idempotency primary key `(token_id, key)`, the task agent columns, the partial unique index on `(organization_id, agent_token_id, agent_idempotency_key)`, the blocker column, and the RPC signature. Assert it contains no `drop table`, `truncate`, or `delete from`.

```ts
test("0063 adds agent credentials and never destroys task data", async () => {
  const sql = await readFile(new URL("../supabase/migrations/0063_work_agent_access.sql", import.meta.url), "utf8");
  assert.match(sql, /create table if not exists work_agent_tokens/i);
  assert.match(sql, /work_agent_idempotency/i);
  assert.match(sql, /token_hash text not null unique/i);
  assert.match(sql, /create unique index[\s\S]*agent_idempotency_key/i);
  assert.match(sql, /create or replace function public\.work_agent_list_tasks/i);
  assert.doesNotMatch(sql, /drop table|truncate|delete from/i);
});
```

- [ ] **Step 2: Run it and confirm the file is missing**

Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" node --import tsx --test test/work-os-agent-migration.test.mts`
Expected: FAIL with `ENOENT`.

- [ ] **Step 3: Write the migration**

```sql
create table if not exists work_agent_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references work_organizations(id) on delete cascade,
  person_id uuid not null references work_people(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  token_prefix text not null,
  scopes text[] not null default '{}'::text[],
  created_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists work_agent_tokens_person_idx on work_agent_tokens(organization_id, person_id);
create index if not exists work_agent_tokens_user_idx on work_agent_tokens(user_id);

create table if not exists work_agent_idempotency (
  organization_id uuid not null references work_organizations(id) on delete cascade,
  token_id uuid not null references work_agent_tokens(id) on delete cascade,
  key text not null,
  request_hash text not null,
  status smallint not null default 0,
  body jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (token_id, key)
);
create index if not exists work_agent_idempotency_expiry_idx on work_agent_idempotency(expires_at);

alter table work_tasks add column if not exists agent_token_id uuid references work_agent_tokens(id) on delete set null;
alter table work_tasks add column if not exists agent_idempotency_key text;
create unique index if not exists work_tasks_agent_idempotency_uidx
  on work_tasks(organization_id, agent_token_id, agent_idempotency_key)
  where agent_idempotency_key is not null;
alter table work_task_blockers add column if not exists agent_token_id uuid references work_agent_tokens(id) on delete set null;
```

Add `work_agent_list_tasks` as a `language sql stable` function. It must select top-level tasks only (`parent_task_id is null and parent_provider_task_id is null`), scope by `user_id`, `organization_id`, and the same attribution predicate as `work_list_person_task_page` (local assignee ids, then Nifty member id in `assignee_provider_ids`, `raw->>'created_by'`, or `raw->'subscribers'`), exclude `archived`/`deleted` unless `p_include_archived`, apply `updated_at > p_updated_since`, order by `updated_at` then `id` in the requested direction, apply the `(p_after_updated_at, p_after_id)` cursor, and limit to `p_limit`.

- [ ] **Step 4: Run the schema test**

Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" node --import tsx --test test/work-os-agent-migration.test.mts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0063_work_agent_access.sql test/work-os-agent-migration.test.mts
git commit -m "feat(work-os): add agent credentials and idempotency schema"
```

---

### Task 2: Token helpers and agent auth guard

**Files:**
- Create: `src/lib/work-agent-tokens.ts`
- Create: `src/lib/work-agent-auth.ts`
- Create: `test/work-os-agent-auth.test.mts`

**Interfaces:**
- Produces `AGENT_TOKEN_PREFIX`, `AGENT_TOKEN_SCOPES`, `AgentScope`.
- Produces `newAgentTokenSecret(): string`, `hashAgentToken(secret: string): string`, `agentTokenPrefix(secret: string): string`, `validateAgentScopes(value: unknown): AgentScope[]`, `agentTokenExpiry(days?: unknown, now?: Date): Date`.
- Produces `createAgentToken(access, input)`, `listAgentTokens(access)`, `revokeAgentToken(access, tokenId)`.
- Produces `AgentActor = { tokenId: string; tokenName: string }`.
- Produces `AgentAccess = { access: WorkOsAccess; tokenId; tokenName; tokenPrefix; expiresAt; scopes: AgentScope[] }` and `requireAgentAccess(req, required?)`.
- Produces `parseAgentAuthorization(value: string | null): string | null`, `hasAgentScope(scopes, required?)`, and an exported `agentError(code, message, status)` returning a `NextResponse` with `{ error, code, request_id }`.
- Produces `agentRouteError(error: unknown): NextResponse`, the single error mapper for v1 routes.

- [ ] **Step 1: Write the failing unit tests**

```ts
test("a token secret is prefixed, opaque, and hashes deterministically", () => {
  const secret = newAgentTokenSecret();
  assert.match(secret, /^wos_agent_[A-Za-z0-9_-]{43}$/);
  assert.equal(hashAgentToken(secret), hashAgentToken(secret));
  assert.notEqual(hashAgentToken(secret), hashAgentToken(newAgentTokenSecret()));
  assert.equal(agentTokenPrefix(secret), secret.slice(0, 12));
});
test("scopes default to read, write, progress and reject unknown values", () => {
  assert.deepEqual(validateAgentScopes(undefined), ["tasks:read", "tasks:write", "progress:write"]);
  assert.throws(() => validateAgentScopes(["tasks:read", "admin"]), /scope/i);
});
test("expiry defaults to 90 days and stays within 1..365", () => {
  const now = new Date("2026-10-22T00:00:00Z");
  assert.equal(agentTokenExpiry(undefined, now).toISOString(), "2027-01-20T00:00:00.000Z");
  assert.throws(() => agentTokenExpiry(0, now), /expiry/i);
  assert.throws(() => agentTokenExpiry(366, now), /expiry/i);
});
test("the guard accepts only a wos_agent bearer and enforces scopes", () => {
  assert.equal(parseAgentAuthorization("Bearer wos_agent_abc"), "wos_agent_abc");
  assert.equal(parseAgentAuthorization("Bearer desktop-token"), null);
  assert.equal(hasAgentScope(["tasks:read"], "tasks:read"), true);
  assert.equal(hasAgentScope(["tasks:read"], "tasks:write"), false);
  assert.equal(hasAgentScope(["tasks:read"]), true);
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" node --import tsx --test test/work-os-agent-auth.test.mts`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the helpers and guard**

Use `randomBytes(32).toString("base64url")` and `createHash("sha256").update(secret).digest("hex")`, matching `src/lib/work-os-desktop-auth.ts`.

`createAgentToken` requires `access.personId`; inserts `user_id = access.ctx.user.id`, `created_by = access.ctx.user.id`, `organization_id = access.organizationId`, `person_id = access.personId`, the hash, the 12-character prefix, validated scopes, and the expiry. It returns the row without `token_hash` plus the raw secret. `listAgentTokens` selects `id,name,token_prefix,scopes,created_at,last_used_at,expires_at,revoked_at` for the caller's `user_id` and `person_id`, newest first. `revokeAgentToken` updates `revoked_at` only where `id`, `organization_id`, `user_id`, and `person_id` match and `revoked_at is null`, and writes `agent_token.revoked`.

`requireAgentAccess(req, required?)`:

1. Parse the bearer with `parseAgentAuthorization`; otherwise `401` `unauthorized`.
2. Look up `work_agent_tokens` by `token_hash`; reject missing, `revoked_at`, or `expires_at <= now` with `401` (`token_revoked` or `token_expired`).
3. Load `profiles` (`id,email,display_name,avatar_url,role,created_at`), the active `work_org_members` row for `(organization_id,user_id,person_id)`, and `work_organizations` (`feature_flags,legacy_owner_id,created_by`). Reject any missing/inactive membership with `401`.
4. Merge feature flags; require `employee_companion`.
5. Check `hasAgentScope`; `403` `insufficient_scope`.
6. Update `last_used_at` when it is null or older than 60 seconds.
7. Return the `AgentAccess` with a complete `WorkOsAccess` (`ctx.user.id`, profile, organizationId, organizationOwnerId, role, personId, membershipId, featureFlags).

Use an exported `agentError(code, message, status)` returning `{ error, code, request_id }`; `request_id` is `crypto.randomUUID()`. Never include the token or hash in the response. Return the token row's `token_prefix` and `expires_at` on the `AgentAccess` as `tokenPrefix` and `expiresAt`. `agentRouteError` maps `WorkOsConflictError` to `409` with its reason as the code, `WorkOsValidationError` and `CompletionEvidenceError` to `400 validation_error`, a message containing `not found` to `404 not_found` (this is how cross-person task ids stay invisible), migration-required errors to `503 migration_required`, and everything else to `500 internal_error` with a request id; log the real error server-side.

- [ ] **Step 4: Run the unit tests and typecheck**

Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" node --import tsx --test test/work-os-agent-auth.test.mts`
Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" npm run work-os:typecheck`
Expected: PASS both.

- [ ] **Step 5: Commit**

```bash
git add src/lib/work-agent-tokens.ts src/lib/work-agent-auth.ts test/work-os-agent-auth.test.mts
git commit -m "feat(work-os): add scoped agent tokens and auth guard"
```

---

### Task 3: Idempotency and rate limiting

**Files:**
- Create: `src/lib/work-agent-idempotency.ts`
- Create: `src/lib/work-agent-rate-limit.ts`
- Create: `test/work-os-agent-idempotency.test.mts`

**Interfaces:**
- Produces `agentRequestHash(method, path, body): string`, `idempotencyDecision(row, hash, now)`.
- Produces `withAgentIdempotency({ agent, key, requestHash, handler })` returning `{ status, body, replayed }`.
- Produces `AgentRateLimitError` and `assertAgentRateLimit(tokenId, write, now?)`.

- [ ] **Step 1: Write the failing decision tests**

```ts
test("same key and hash replays, different hash conflicts, fresh in-flight waits", () => {
  const now = new Date("2026-10-22T00:00:00Z");
  const row = { request_hash: "abc", status: 201, body: { id: "t1" }, updated_at: now.toISOString() };
  assert.deepEqual(idempotencyDecision(row, "abc", now), { kind: "replay", status: 201, body: { id: "t1" } });
  assert.deepEqual(idempotencyDecision(row, "other", now), { kind: "conflict" });
  assert.deepEqual(idempotencyDecision({ ...row, status: 0 }, "abc", now), { kind: "in_flight" });
  assert.deepEqual(idempotencyDecision({ ...row, status: 0, updated_at: "2026-10-21T23:58:00Z" }, "abc", now), { kind: "claim" });
  assert.deepEqual(idempotencyDecision(null, "abc", now), { kind: "claim" });
});
test("the limiter resets on a new minute and separates writes", () => {
  const now = new Date("2026-10-22T00:00:00Z");
  for (let i = 0; i < 120; i++) assertAgentRateLimit("token", false, now);
  assert.throws(() => assertAgentRateLimit("token", false, now), AgentRateLimitError);
  for (let i = 0; i < 20; i++) assertAgentRateLimit("other", true, now);
  assert.throws(() => assertAgentRateLimit("other", true, now), AgentRateLimitError);
  assertAgentRateLimit("token", false, new Date("2026-10-22T00:01:01Z"));
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" node --import tsx --test test/work-os-agent-idempotency.test.mts`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement**

`agentRequestHash` sorts object keys recursively, JSON-stringifies, and returns SHA-256 hex. It accepts a `Uint8Array` or a multipart descriptor by hashing bytes first at the call site.

`idempotencyDecision` treats `status = 0` as in-flight, a 60-second staleness window, and `status > 0` as a completed response. `withAgentIdempotency`:

- requires a key, otherwise throws a validation error;
- reads the row by `(token_id,key)`;
- replays a completed response, returns `409 idempotency_conflict` on a hash mismatch, `409 idempotency_in_flight` with `Retry-After: 1` on a fresh claim, and otherwise claims the row;
- inserts `status = 0` with `expires_at = now + 24h` on first use, or updates the stale row;
- runs the handler, stores `status` and `body`, and returns;
- deletes the claim on a handler error so a corrected retry can proceed.

`assertAgentRateLimit` uses a module-level `Map` keyed by token id with a 60-second window, counters for requests and writes, and `AgentRateLimitError` carrying `retryAfter` seconds. A batch counts as one request and one write.

- [ ] **Step 4: Run tests and typecheck**

Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" node --import tsx --test test/work-os-agent-idempotency.test.mts`
Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" npm run work-os:typecheck`
Expected: PASS both.

- [ ] **Step 5: Commit**

```bash
git add src/lib/work-agent-idempotency.ts src/lib/work-agent-rate-limit.ts test/work-os-agent-idempotency.test.mts
git commit -m "feat(work-os): add agent idempotency and rate limits"
```

---

### Task 4: Token management API

**Files:**
- Create: `src/app/api/work-os/me/agent-tokens/route.ts`
- Create: `src/app/api/work-os/me/agent-tokens/[tokenId]/route.ts`
- Create: `test/work-os-agent-token-routes.test.mts`

**Interfaces:**
- Consumes `createAgentToken`, `listAgentTokens`, `revokeAgentToken`.
- `GET /api/work-os/me/agent-tokens` → `{ tokens }` without secrets or hashes.
- `POST` body `{ name, scopes?, expires_in_days? }` → `201 { token, secret }`.
- `DELETE /api/work-os/me/agent-tokens/{id}` → `{ revoked }`.

- [ ] **Step 1: Write the source-contract test**

Assert both routes call `requireWorkOsAccess` with `requirePerson: true`, never `roles: ["admin"]`, select no `token_hash`, return the secret only from POST, and scope revoke to the caller. Assert the POST path validates name/scopes/expiry through the helpers from Task 2.

- [ ] **Step 2: Run and confirm it fails**

Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" node --import tsx --test test/work-os-agent-token-routes.test.mts`
Expected: FAIL because the route files do not exist.

- [ ] **Step 3: Implement the routes**

Use `runtime = "nodejs"` and `dynamic = "force-dynamic"`. On create, require a name of 1–80 characters; reject an unrecognized field with `400`. Write the `agent_token.created` audit entry with `target_type = "agent_token"` and no secret. On revoke, answer `404` when the caller's row does not match, and write `agent_token.revoked` only when a row changed.

- [ ] **Step 4: Run the test and typecheck**

Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" node --import tsx --test test/work-os-agent-token-routes.test.mts`
Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" npm run work-os:typecheck`
Expected: PASS both.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/work-os/me/agent-tokens test/work-os-agent-token-routes.test.mts
git commit -m "feat(work-os): add agent token management API"
```

---

### Task 5: Agent reads — identity, tasks, detail, activity

**Files:**
- Create: `src/lib/work-agent-tasks.ts`
- Create: `src/lib/work-agent-activity.ts`
- Create: `src/app/api/agent/v1/me/route.ts`
- Create: `src/app/api/agent/v1/tasks/route.ts` (GET only in this task)
- Create: `src/app/api/agent/v1/tasks/[taskId]/route.ts` (GET only in this task)
- Create: `src/app/api/agent/v1/tasks/[taskId]/activity/route.ts`
- Create: `test/work-os-agent-reads.test.mts`

**Interfaces:**
- Produces `listAgentTasks(agent, { updatedSince?, includeArchived?, limit, cursor? })`.
- Produces `getAgentTask(agent, taskId)`.
- Produces `mergeAgentActivity(input, cursor?, limit?)` and `listAgentActivity(agent, taskId, params)`.

- [ ] **Step 1: Write the failing pure tests**

Use fixtures for one completed day event, one agent progress note, and one resolved blocker. Assert newest-first order, `actor: "agent"` for the agent-marked items and `actor: "employee"` otherwise, and that a cursor returns the next page without repeating an item. Assert `listAgentTasks` requests `limit + 1` and builds a two-part cursor.

- [ ] **Step 2: Run and confirm it fails**

Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" node --import tsx --test test/work-os-agent-reads.test.mts`
Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement**

`listAgentTasks` reads the person's `nifty_member_id`, calls `work_agent_list_tasks` with the owner id, organization, person, member id, `updated_since`, `include_archived`, ascending flag, decoded cursor, and `limit + 1`. Return at most `limit` tasks and a cursor from the last returned row when an extra row exists. The cursor is base64url JSON `{ order: "asc"|"desc", updatedAt, id }`; reject a cursor whose order does not match the request.

`getAgentTask` calls `getWorkOsEmployeeTaskDetails(agent.access, taskId)`, drops `moveTargets`, and adds `blockers` from `work_task_blockers` ordered by `created_at`. All ids are resolved through the service, so a cross-person id throws `Task not found`.

`mergeAgentActivity` accepts arrays with `{ id, at, kind, summary, actor, data }` and sorts by `at` then `id` descending. The activity query selects day events (`id,event_type,provenance,exact_at,observed_at,metadata`), evidence (`id,title,summary,source,metrics,created_at`), and blockers (`id,description,status,created_at,resolved_at,agent_token_id`). Map the actor to `agent` when the event provenance is `agent`, `metrics.agentTokenId` exists, or the blocker has `agent_token_id`; otherwise `employee`. Drop storage paths and raw provider payloads.

Routes: `/me` requires any valid token (no scope) and returns `{ organization_id, person_id, token: { id: agent.tokenId, name: agent.tokenName, prefix: agent.tokenPrefix, scopes: agent.scopes, expires_at: agent.expiresAt } }`. `/tasks` requires `tasks:read`; `/tasks/{id}` and `/activity` require `tasks:read` and apply the rate limit as a read. Wrap every route in `try/catch` and return `agentRouteError(error)`; validate `updated_since` as an ISO timestamp and answer `400 validation_error` when it is not.

- [ ] **Step 4: Run tests and typecheck**

Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" node --import tsx --test test/work-os-agent-reads.test.mts`
Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" npm run work-os:typecheck`
Expected: PASS both.

- [ ] **Step 5: Commit**

```bash
git add src/lib/work-agent-tasks.ts src/lib/work-agent-activity.ts src/app/api/agent/v1 test/work-os-agent-reads.test.mts
git commit -m "feat(work-os): add agent identity and task read routes"
```

---

### Task 6: Agent writes — create, update, blockers, provenance

**Files:**
- Modify: `src/lib/work-os-local-tasks.ts`
- Modify: `src/lib/work-os-employee-tasks.ts`
- Modify: `src/lib/work-os-daily-workspace.ts`
- Modify: `src/app/api/agent/v1/tasks/route.ts` (add POST)
- Modify: `src/app/api/agent/v1/tasks/[taskId]/route.ts` (add PATCH)
- Create: `test/work-os-agent-writes.test.mts`

**Interfaces:**
- Extend `CreateLocalWorkOsTaskInput` with `agentTokenId?: string`, `agentIdempotencyKey?: string`, `provenance?: "employee_explicit" | "agent"`.
- Extend `createWorkOsEmployeeTask(access, body, actor?: AgentActor, idempotencyKey?: string)`.
- Produce `updateWorkOsAgentTask(access, taskId, body, actor)`.
- Produce `createAgentTask(agent, body, idempotencyKey)` and `updateAgentTask(agent, taskId, body)` in `src/lib/work-agent-tasks.ts`; they call the employee services with `{ tokenId: agent.tokenId, tokenName: agent.tokenName }` and pass the key through to the task insert.
- Extend `recordTaskDayEvent` provenance with `"agent"`; record memory only for `employee_explicit`.

- [ ] **Step 1: Write the failing tests**

Assert the pure field allowlist rejects `project_id`, `parent_task_id`, and `assignee_person_ids` on PATCH; accepts `name`, `description`, `due_date`, `start_date`, `priority`, `labels`, `story_points`, `expected_outcome`, `definition_of_done`, `blocked`, and `blocked_reason`; and that a create forces `assignee_person_ids` to the token's person. Assert the source uses `agentTokenId`/`agentIdempotencyKey` in the task insert, uses the unique-conflict lookup, and records `provenance: "agent"`.

- [ ] **Step 2: Run and confirm it fails**

Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" node --import tsx --test test/work-os-agent-writes.test.mts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `createLocalWorkOsTask` writes `agent_token_id`, `agent_idempotency_key`, and passes `input.provenance ?? "employee_explicit"` to the creation day event with `metadata.agentTokenId`.
- `createWorkOsEmployeeTask` passes the actor fields; when the insert returns a duplicate-key error, query `work_tasks` by `(organization_id, agent_token_id, agent_idempotency_key)` and return that row.
- `updateWorkOsAgentTask` authorizes with `employeeTaskContext`, validates the allowlist, then calls `updateTask(ownerId, task.id, patch)`. For `blocked: true`, insert an active `work_task_blockers` row with `agent_token_id` and `person_id`, then set the task flags; for `blocked: false`, resolve every active blocker and clear the flags.
- Routes: `POST /tasks` requires `tasks:write`, `Idempotency-Key`, and the write limiter; call `withAgentIdempotency({ agent, key, requestHash, handler: () => createAgentTask(agent, body, key) })`. `PATCH /tasks/{id}` does the same for `updateAgentTask`. Audit `agent.task.created` and `agent.task.updated` with `token_id` and `token_name`.

- [ ] **Step 4: Run tests and typecheck**

Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" node --import tsx --test test/work-os-agent-writes.test.mts`
Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" npm run work-os:typecheck`
Expected: PASS both.

- [ ] **Step 5: Commit**

```bash
git add src/lib/work-os-local-tasks.ts src/lib/work-os-employee-tasks.ts src/lib/work-os-daily-workspace.ts src/app/api/agent/v1/tasks test/work-os-agent-writes.test.mts
git commit -m "feat(work-os): add agent task create and update with provenance"
```

---

### Task 7: Completion and evidence

**Files:**
- Modify: `src/lib/work-os-employee-tasks.ts`
- Create: `src/app/api/agent/v1/tasks/[taskId]/complete/route.ts`
- Create: `src/app/api/agent/v1/tasks/[taskId]/reopen/route.ts`
- Create: `src/app/api/agent/v1/tasks/[taskId]/evidence/route.ts`
- Create: `test/work-os-agent-completion.test.mts`

**Interfaces:**
- Extend `setWorkOsEmployeeTaskCompletion(access, taskId, completed, actor?)`.
- Extend `attachWorkOsTaskCompletionEvidence(access, taskId, input, actor?)`.
- `POST /complete` and `/reopen` require `tasks:write`.
- `POST /evidence` requires `evidence:write`; multipart `file`, optional `note`, `complete=true`.

- [ ] **Step 1: Write the failing tests**

Assert the completion service passes `provenance: actor ? "agent" : "employee_explicit"` and `metadata.agentTokenId`; assert `recordTaskDayEvent` writes memory only for `employee_explicit`; assert evidence metrics include `agentTokenId` and `origin: "agent_evidence"`; assert the evidence route reuses `COMPLETION_EVIDENCE_MAX_BYTES` and the existing validation.

- [ ] **Step 2: Run and confirm it fails**

Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" node --import tsx --test test/work-os-agent-completion.test.mts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- Completion callbacks pass the actor provenance and agent metadata; audit actions become `agent.task.completed` / `agent.task.reopened` when an actor exists.
- Evidence inserts metrics with `agentTokenId`, sets `raw.origin = "task_completion"` and `raw.agentTokenId`, and audits `agent.evidence.attached`.
- The complete route returns `{ task }`; a gated task with no evidence returns `409 evidence_required` (existing `WorkOsConflictError` mapping).
- The evidence route mirrors `src/app/api/work-os/me/tasks/[taskId]/completion-evidence/route.ts`: exactly one file, 8 MB cap, supported types, required `Idempotency-Key`, attach first, and `complete=true` completes after the save with `502` plus the evidence id on a completion failure. Compute the idempotency request hash over method, path, `note`, `complete`, file name, content type, and the SHA-256 of the file bytes before claiming the key. Map a size failure to `413 file_too_large`, a type failure to `415 unsupported_file_type`, and any other evidence validation to `400 validation_error`.

- [ ] **Step 4: Run tests and typecheck**

Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" node --import tsx --test test/work-os-agent-completion.test.mts test/work-os-task-completion.test.mts test/work-os-completion-evidence.test.mts`
Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" npm run work-os:typecheck`
Expected: PASS all.

- [ ] **Step 5: Commit**

```bash
git add src/lib/work-os-employee-tasks.ts src/app/api/agent/v1/tasks test/work-os-agent-completion.test.mts
git commit -m "feat(work-os): add agent completion and evidence routes"
```

---

### Task 8: Progress and batch

**Files:**
- Create: `src/lib/work-agent-batch.ts`
- Create: `src/app/api/agent/v1/tasks/[taskId]/progress/route.ts`
- Create: `src/app/api/agent/v1/batch/route.ts`
- Create: `test/work-os-agent-batch.test.mts`

**Interfaces:**
- `POST /progress` requires `progress:write`; body `{ title?, summary, url? }`.
- `POST /batch` body `{ operations }`, maximum 20, one `Idempotency-Key`.

- [ ] **Step 1: Write the failing tests**

Assert `validateAgentBatch` rejects more than 20 operations and unknown operations, accepts `create_task`, `update_task`, `complete_task`, `reopen_task`, `log_progress`, and returns per-item failures without throwing. Assert the progress wrapper sets `person_id`, `source: "agent"`, `metrics.origin = "agent_progress"`, and `metrics.agentTokenId`, and uses the request key.

- [ ] **Step 2: Run and confirm it fails**

Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" node --import tsx --test test/work-os-agent-batch.test.mts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`addAgentProgress` authorizes the task through `getWorkOsEmployeeTaskDetails`, then calls `addTaskProgress(ownerId, task.id, { ...body, person_id, source: "agent", idempotency_key: key, metrics: { ...(body.metrics ?? {}), origin: "agent_progress", agentTokenId } })`. Audit `agent.progress.logged`.

The progress route requires `progress:write`, a key, and the write limiter; it returns the evidence row.

Batch wraps the whole request in `withAgentIdempotency`; each item derives `${key}:${index}` for create/progress and passes it to `createAgentTask` or the progress wrapper. Execute in order; for each item return `{ index, operation, status: "applied"|"failed", id?, error? }`. Use the per-operation scope check (`tasks:write` or `progress:write`). A failed item does not stop later items. The response is `200` with `{ results, applied, failed }`; malformed batches are `400`.

- [ ] **Step 4: Run tests and typecheck**

Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" node --import tsx --test test/work-os-agent-batch.test.mts`
Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" npm run work-os:typecheck`
Expected: PASS both.

- [ ] **Step 5: Commit**

```bash
git add src/lib/work-agent-batch.ts src/app/api/agent/v1 test/work-os-agent-batch.test.mts
git commit -m "feat(work-os): add agent progress and batch routes"
```

---

### Task 9: OpenAPI contract, served schema, docs, test script

**Files:**
- Create: `docs/openapi/work-os-agent-v1.yaml`
- Create: `src/app/api/agent/v1/openapi.yaml/route.ts`
- Create: `test/work-os-agent-openapi.test.mts`
- Create: `docs/AGENT-API.md`
- Modify: `package.json` (append the new test files to `work-os:test`)

**Interfaces:**
- `GET /api/agent/v1/openapi.yaml` is public, `text/yaml`, cacheable.
- The YAML declares every v1 path, the bearer scheme, scopes, and error codes.

- [ ] **Step 1: Write the failing coverage test**

Use `js-yaml` to parse the file. Walk `src/app/api/agent/v1` for `route.ts` files, convert folders to path templates, and assert the sets are equal in both directions. Assert each operation except `/openapi.yaml` has `security: [{ bearerAuth: [] }]`, that every scope referenced is one of the four, and that the `Error` schema lists every code from the design. Assert the served route reads `docs/openapi/work-os-agent-v1.yaml` and sets `application/yaml`.

- [ ] **Step 2: Run and confirm it fails**

Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" node --import tsx --test test/work-os-agent-openapi.test.mts`
Expected: FAIL because the YAML does not exist.

- [ ] **Step 3: Write the contract and serve it**

The YAML uses `openapi: 3.1.0`, `security: [{ bearerAuth: [] }]` globally, `components.securitySchemes.bearerAuth` with `type: http, scheme: bearer`, and the paths from Tasks 5–8. Document `Idempotency-Key` as required on POST/PATCH, `Idempotent-Replay` on replay, and the 400/401/403/404/409/413/429/502 responses. Include one curl-ready example per operation group.

`docs/AGENT-API.md` covers minting a token in Settings, the scope table, the endpoint table, idempotency, rate limits, error codes, and a create → progress → evidence → complete walkthrough.

- [ ] **Step 4: Run the contract test and typecheck**

Append `test/work-os-agent-migration.test.mts`, `test/work-os-agent-auth.test.mts`, `test/work-os-agent-idempotency.test.mts`, `test/work-os-agent-token-routes.test.mts`, `test/work-os-agent-reads.test.mts`, `test/work-os-agent-writes.test.mts`, `test/work-os-agent-completion.test.mts`, `test/work-os-agent-batch.test.mts`, and `test/work-os-agent-openapi.test.mts` to the `work-os:test` script.

Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" node --import tsx --test test/work-os-agent-openapi.test.mts`
Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" npm run work-os:typecheck`
Expected: PASS both.

- [ ] **Step 5: Commit**

```bash
git add docs/openapi/work-os-agent-v1.yaml docs/AGENT-API.md src/app/api/agent/v1/openapi.yaml test/work-os-agent-openapi.test.mts package.json
git commit -m "docs(work-os): publish the agent v1 OpenAPI contract"
```

---

### Task 10: Settings token management

**Files:**
- Create: `src/modules/work-os/employee/AgentAccessSettings.tsx`
- Modify: `src/modules/work-os/employee/EmployeeSettings.tsx`
- Modify: `package.json` (add the new test to `work-os:test`)
- Create: `test/work-os-agent-settings-ui.test.mts`

**Interfaces:**
- Consumes `GET/POST /api/work-os/me/agent-tokens` and `DELETE /api/work-os/me/agent-tokens/{id}`.
- Renders inside the employee settings page before the "This device" panel.

- [ ] **Step 1: Write the failing static test**

Assert `EmployeeSettings.tsx` renders `AgentAccessSettings`; the new component uses both endpoints, shows the secret exactly once with a copy action and an explicit warning, lists prefix/scopes/last used/expiry, and requires a confirm before revoke. Assert no `token_hash` or raw token is rendered in the list.

- [ ] **Step 2: Run and confirm it fails**

Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" node --import tsx --test test/work-os-agent-settings-ui.test.mts`
Expected: FAIL.

- [ ] **Step 3: Implement the panel**

Use `useQuery`/`useMutation`, `fetchJson`, and the existing `Panel`, `PanelHeader`, `Field`, `inputClass`, `PrimaryButton`, `SecondaryButton`, `Notice`, and `StatusPill`. The create form asks for a name, scope checkboxes, and a 30/90/365-day expiry; the default is 90 and all four scopes are available. On success, replace the form with a one-time secret notice and a copy button; closing it clears the secret from state. The list has an empty state and a revoke confirmation. Follow `design.md` tokens and the existing settings spacing; do not introduce new colors or fonts.

- [ ] **Step 4: Run the test, typecheck, and a local render check**

Append `test/work-os-agent-settings-ui.test.mts` to the `work-os:test` script, then run:

Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" node --import tsx --test test/work-os-agent-settings-ui.test.mts`
Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" npm run work-os:typecheck`
Expected: PASS both. Start the dev server and inspect the settings page at desktop and narrow widths for loading, empty, error, keyboard focus, and the one-time secret state.

- [ ] **Step 5: Commit**

```bash
git add src/modules/work-os/employee/AgentAccessSettings.tsx src/modules/work-os/employee/EmployeeSettings.tsx test/work-os-agent-settings-ui.test.mts package.json
git commit -m "feat(work-os): add agent token management to settings"
```

---

### Task 11: Apply, deploy, and verify live

**Files:**
- Modify: `docs/AGENT-API.md` only if live behavior differs.
- Port the verified changes to the deployed `agent-os` checkout using the documented convergence path; record both commit identities.

- [ ] **Step 1: Run the full local gate**

Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" npm run work-os:typecheck`
Run: `PATH="/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH" npm run work-os:test`
Expected: PASS. Treat the backend harness as lint only; the live checks below are the behavior evidence.

- [ ] **Step 2: Apply the additive migration to Neon**

Use the migration resolver (`MIGRATION_DATABASE_URL` → `DATABASE_URL_UNPOOLED` → `DATABASE_URL`) and apply only `0063_work_agent_access.sql`. Run it from the VPS `agent-os` checkout where the production values are configured; never paste the URL. Verify `to_regclass('public.work_agent_tokens')` and `to_regclass('public.work_agent_idempotency')` are non-null, and confirm the resolved host is the Work OS Neon endpoint before writing.

- [ ] **Step 3: Deploy the server**

Port the files to `agent-os` using `scripts/converge-to-agentos.mts` for blob-identical files and explicit review for new or diverged files, commit both identities, rebase on `origin/main`, push verified work, and run the atomic `npm run redeploy` on the VPS. Preflight must show `HEAD == origin/main`. Verify the deployed identity, the `/api/agent/v1/openapi.yaml` asset, and the settings page bundle.

- [ ] **Step 4: Mint a token and run the end-to-end sequence**

Use the authenticated `e2e-verify@wrazyos.com` admin session to mint a token in Settings; store the secret in a private temp file, never in logs. Then:

1. `GET /api/agent/v1/me` → `200`, correct person, scopes, expiry.
2. `POST /api/agent/v1/tasks` with a key → `201`; repeat the same key and body → same task id and `Idempotent-Replay: true`.
3. `PATCH` the title and due date; `POST /progress`; `POST /evidence` with a small PNG and `complete=true`.
4. Create a task with `definition_of_done`; `POST /complete` without evidence → `409 evidence_required`; attach evidence → `201` completed; retry `/complete` → success without a second upload.
5. `GET /tasks/{id}/activity` shows the agent actor; `GET /tasks?updated_since=…` includes each change.
6. `POST /batch` with two operations → per-item results; repeat the key → replay.
7. Revoke the token in Settings; `GET /me` → `401 token_revoked`.
8. Use an existing task assigned to another person (or create one in the admin UI), then request its id with this token → `404`, not the task.

Clean up the verification tasks through the internal employee delete route and revoke every test token. Record the exact commands and observed statuses in the final report.

- [ ] **Step 5: Commit any live-verification copy fixes**

```bash
git add -A
git commit -m "docs(work-os): record agent API live verification"
```

---

## Phase B — MCP (separate plan)

Do not start MCP in this plan. After Task 11 passes, write `docs/superpowers/plans/2026-10-23-agent-access-mcp.md` using the already-installed `@modelcontextprotocol/sdk` (`^1.29.0`). It will add `src/app/api/mcp/route.ts` with the same bearer guard and tools `list_tasks`, `get_task`, `create_task`, `update_task`, `complete_task`, `log_progress`, and `attach_evidence`, reusing the service functions from Tasks 5–8.

## Self-Review

Spec coverage:

| Spec section | Task |
|---|---|
| Credential model, scopes, 90-day default | 1, 2, 4 |
| Separate namespace, bearer guard | 2, 5 |
| `/me`, task list/detail, change feed | 5 |
| Create/update, TASKS default, create-only structure | 6 |
| Completion, evidence gate, provenance | 7 |
| Progress, activity merge, batch | 5, 8 |
| Idempotency, rate limits, errors, audit | 2, 3, 4, 5–8 |
| OpenAPI source of truth and token UI | 9, 10 |
| Safe rollout and live verification | 11 |
| MCP | Phase B (explicitly deferred) |
| Non-goals: no admin, no cross-person, no screenshots, no Nifty writes | Global constraints and auth guard |

The batch atomicity deviation is stated in Implementation Constraints. The MCP deferral is stated in Global Constraints and Phase B. No step leaves a type or function name undefined; later tasks consume the exact names defined in earlier Interfaces blocks.
