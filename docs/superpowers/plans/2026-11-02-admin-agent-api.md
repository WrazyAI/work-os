# Admin Agent API and MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the admin-scoped token surface: `wos_admin_` credentials, cross-person REST reads and writes, database-backed preview/confirm, OpenAPI, and the 13-tool admin MCP server.

**Architecture:** A new `admin` kind in `work_agent_tokens` resolves to the existing `WorkOsAccess` with the membership role re-checked on every request. New admin read services query the organization directly; writes call the existing admin task and EOD services. Consequential writes are stored as previews and executed only through a confirm route. The REST namespace is `/api/agent/admin/v1`; MCP is `/api/agent/admin/mcp`.

**Tech Stack:** Next.js App Router route handlers, TypeScript, Postgres (Neon), PGlite fixtures, Zod v4, `@modelcontextprotocol/sdk`, Node test runner with `tsx`.

**Spec:** `docs/superpowers/specs/2026-11-02-admin-agent-api-design.md`

## Scope

This plan builds the admin API and MCP surface. Admin Otto's tool loop and confirmation cards are a separate plan; they depend on the interfaces this plan finalizes. Do not change `src/lib/work-os-admin-otto-*` or the admin chat UI here.

## Global Constraints

- Employee tokens keep exactly seven MCP tools. Admin tokens get thirteen. A token of the wrong kind is `401 unauthorized`, never `403`.
- Every query is scoped by the token's `organization_id`. A cross-organization person, task, report, or evidence id answers `404`.
- An admin token may have `person_id = null`. Never fabricate a person or attribute an action to another employee.
- Consequential writes return `202` with a preview; only `POST /previews/{id}/confirm` executes.
- Progress and evidence are additive direct writes; everything else that creates, removes, reassigns, completes, or decides requires a preview.
- Evidence is one file, 8 MB maximum, supported types only. Admin evidence has `person_id = null` and records the uploader in `metrics`.
- Rate limits are 120 requests and 20 writes per minute per token.
- The surface is behind `admin_agent_api` **and** `employee_companion`.
- No people administration, manager tokens, private memory, private chats, unsubmitted drafts, or raw screenshots.
- All migrations are additive. Apply with `npm run db:apply:work-os` only after the host resolves to the intended Neon database.
- Work in `codex/admin-agent-api` from `origin/main`; ledger task `451d4159-e201-4d22-b347-a4f1b7bd9a9f`.
- Run tests with `node --import tsx --test test/<file>.test.mts`; typecheck with `npm run work-os:typecheck`.

## Review Focus

1. **Wrong-kind token** — an employee token on `/api/agent/admin/*` or an admin token on `/api/agent/v1/*` must answer `401`, not fall through to a role check or a 500.
2. **Unmapped admin** — creating, assigning, completing, or attaching evidence with `person_id = null` must not crash, invent a person, or write to another employee's record.
3. **Stale preview** — a preview confirmed after the task's assignees, completion, parent, or the report's status changed must answer `409 preview_stale` and write nothing.
4. **Cross-organization id** — a person, task, report, or evidence id from another organization must answer `404`, including through list filters and preview payloads.
5. **Read-only token** — a token without `tasks:write` must fail preview creation, confirm, progress, and evidence with `403 insufficient_scope`; no route may rely on the UI to hide the action.

Each line is pinned by a test in the task that owns the code.

---

### Task 1: Migration and shared contracts

**Files:**
- Create: `supabase/migrations/0069_work_admin_agent_access.sql`
- Create: `src/modules/work-os/admin-agent/contracts.ts`
- Create: `test/work-os-admin-agent-migration.test.mts`

**Interfaces:**
- Produces: `AdminPreviewAction` union, `AdminPreview` type, `AdminAgentTaskFilters` type.
- Produces tables: `work_agent_tokens.kind`, nullable `person_id`, `work_admin_action_previews`.

- [ ] **Step 1: Write the failing migration test**

Create `test/work-os-admin-agent-migration.test.mts`:

```ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const sql = () => read("supabase/migrations/0069_work_admin_agent_access.sql");

test("admin tokens are a kind, and only admins may omit a person", async () => {
  const body = await sql();
  assert.match(body, /add column if not exists kind text not null default 'employee'/);
  assert.match(body, /alter column person_id drop not null/);
  assert.match(body, /kind in \('employee', 'admin'\)/);
  assert.match(body, /kind = 'admin' or person_id is not null/);
});

test("the preview table stores the request, state, result, and expiry", async () => {
  const body = await sql();
  for (const column of ["organization_id", "user_id", "token_id", "source", "action", "target_type", "request", "preview", "state_fingerprint", "result_status", "result_body", "idempotency_key", "expires_at", "confirmed_at"]) {
    assert.match(body, new RegExp(`\\b${column}\\b`), `missing ${column}`);
  }
  assert.match(body, /create index if not exists work_admin_action_previews_token_idx/);
  assert.match(body, /enable row level security/);
});

test("the migration is additive and repeatable", async () => {
  const body = await sql();
  assert.match(body, /create table if not exists work_admin_action_previews/);
  assert.doesNotMatch(body, /drop table|truncate|delete from/i);

  const db = new PGlite();
  await db.exec(`
    create table work_organizations (id uuid primary key);
    create table work_agent_tokens (
      id uuid primary key default gen_random_uuid(), organization_id uuid not null,
      person_id uuid not null, user_id uuid not null, name text not null,
      token_hash text not null unique, token_prefix text not null,
      scopes text[] not null default '{}', created_by uuid,
      expires_at timestamptz not null, last_used_at timestamptz,
      revoked_at timestamptz, created_at timestamptz not null default now()
    );
  `);
  await db.exec(await sql());
  await db.exec(await sql());
  const columns = await db.query<{ column_name: string; is_nullable: string }>(
    `select column_name, is_nullable from information_schema.columns where table_name = 'work_agent_tokens' and column_name in ('kind','person_id') order by column_name`,
  );
  assert.deepEqual(columns.rows, [
    { column_name: "kind", is_nullable: "NO" },
    { column_name: "person_id", is_nullable: "YES" },
  ]);
  await db.close();
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --import tsx --test test/work-os-admin-agent-migration.test.mts`
Expected: FAIL because the migration file does not exist.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0069_work_admin_agent_access.sql`:

```sql
-- Admin-scoped agent access. Additive: existing employee tokens keep their
-- person binding; only the admin kind may omit it.

alter table work_agent_tokens
  add column if not exists kind text not null default 'employee';
alter table work_agent_tokens
  alter column person_id drop not null;

do $$ begin
  alter table work_agent_tokens
    add constraint work_agent_tokens_kind_check
    check (kind in ('employee', 'admin'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table work_agent_tokens
    add constraint work_agent_tokens_person_kind_check
    check (kind = 'admin' or person_id is not null);
exception when duplicate_object then null; end $$;

create index if not exists work_agent_tokens_kind_user_idx
  on work_agent_tokens(organization_id, kind, user_id);

create table if not exists work_admin_action_previews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references work_organizations(id) on delete cascade,
  user_id uuid not null,
  token_id uuid references work_agent_tokens(id) on delete cascade,
  source text not null check (source in ('api', 'otto')),
  action text not null,
  target_type text not null,
  target_id text,
  request jsonb not null,
  preview jsonb not null,
  state_fingerprint jsonb not null default '{}'::jsonb,
  result_status smallint,
  result_body jsonb,
  idempotency_key text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  confirmed_at timestamptz
);
create index if not exists work_admin_action_previews_token_idx
  on work_admin_action_previews(token_id, expires_at);
create index if not exists work_admin_action_previews_user_idx
  on work_admin_action_previews(user_id, expires_at);

alter table work_admin_action_previews enable row level security;
revoke all on work_admin_action_previews from public;
```

- [ ] **Step 4: Write the shared contracts**

Create `src/modules/work-os/admin-agent/contracts.ts`:

```ts
import type { Json } from "@/lib/work-os-internal";

export const ADMIN_PREVIEW_ACTIONS = [
  "task.create", "task.update", "task.assign", "task.move",
  "task.complete", "task.reopen", "task.archive", "task.delete", "eod.review",
] as const;
export type AdminPreviewAction = (typeof ADMIN_PREVIEW_ACTIONS)[number];

export type AdminPreviewChange = { field: string; from: Json; to: Json };
export type AdminPreview = {
  id: string;
  action: AdminPreviewAction;
  summary: string;
  changes: AdminPreviewChange[];
  warnings: string[];
  state: Json;
  expiresAt: string;
};
export type AdminAgentPerson = {
  id: string; displayName: string; email: string | null; active: boolean;
  timezone: string | null; roleProfile: { id: string; name: string } | null;
};
export type AdminAgentTaskFilters = {
  personIds: string[] | null; query: string | null; completed: boolean | null;
  status: "active" | "archived" | "deleted" | null;
  projectId: string | null; dueFrom: string | null; dueTo: string | null;
  updatedSince: string | null; limit: number; cursor: string | null;
};
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `node --import tsx --test test/work-os-admin-agent-migration.test.mts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0069_work_admin_agent_access.sql src/modules/work-os/admin-agent/contracts.ts test/work-os-admin-agent-migration.test.mts
git commit -m "feat(work-os): add the admin agent token kind and preview store"
```

---

### Task 2: Admin token model

**Files:**
- Modify: `src/lib/work-agent-tokens.ts`
- Create: `test/work-os-admin-agent-tokens.test.mts`

**Interfaces:**
- Produces: `ADMIN_AGENT_TOKEN_PREFIX`, `ADMIN_AGENT_TOKEN_SCOPES`, `AdminAgentScope`, `ADMIN_AGENT_DEFAULT_SCOPES`, `newAdminAgentTokenSecret()`, `validateAdminAgentScopes()`, `createAdminAgentToken()`, `listAdminAgentTokens()`, `revokeAdminAgentToken()`.
- Consumes: `hashAgentToken`, `agentTokenExpiry`, `WorkOsAccess`, `audit`.

- [ ] **Step 1: Write the failing tests**

Create `test/work-os-admin-agent-tokens.test.mts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_AGENT_DEFAULT_SCOPES,
  ADMIN_AGENT_TOKEN_SCOPES,
  newAdminAgentTokenSecret,
  validateAdminAgentScopes,
} from "../src/lib/work-agent-tokens";

test("admin secrets use their own prefix and are opaque", () => {
  const secret = newAdminAgentTokenSecret();
  assert.match(secret, /^wos_admin_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(secret, newAdminAgentTokenSecret());
});

test("admin scopes default to reads and reject employee-only or unknown scopes", () => {
  assert.deepEqual(validateAdminAgentScopes(undefined), [
    "people:read", "tasks:read", "eods:read", "records:read", "insights:read",
  ]);
  assert.deepEqual(validateAdminAgentScopes(["tasks:read", "tasks:write"]), ["tasks:read", "tasks:write"]);
  assert.deepEqual([...ADMIN_AGENT_TOKEN_SCOPES], [
    "people:read", "tasks:read", "tasks:write", "eods:read", "eods:review", "records:read", "insights:read",
  ]);
  assert.throws(() => validateAdminAgentScopes(["progress:write"]), /scope/i);
  assert.throws(() => validateAdminAgentScopes([]), /scope/i);
});
```

Add source assertions that `createAdminAgentToken` inserts `kind: "admin"` and allows `person_id: access.personId` (null included), and that list/revoke filter both `kind = "admin"` and `user_id`.

- [ ] **Step 2: Run and verify failure**

Run: `node --import tsx --test test/work-os-admin-agent-tokens.test.mts`
Expected: FAIL because the exports do not exist.

- [ ] **Step 3: Implement the admin token model**

In `src/lib/work-agent-tokens.ts`:

```ts
export const ADMIN_AGENT_TOKEN_PREFIX = "wos_admin_";
export const ADMIN_AGENT_TOKEN_SCOPES = [
  "people:read", "tasks:read", "tasks:write", "eods:read",
  "eods:review", "records:read", "insights:read",
] as const;
export type AdminAgentScope = (typeof ADMIN_AGENT_TOKEN_SCOPES)[number];
export const ADMIN_AGENT_DEFAULT_SCOPES: AdminAgentScope[] = [
  "people:read", "tasks:read", "eods:read", "records:read", "insights:read",
];

export function newAdminAgentTokenSecret(): string;
export function validateAdminAgentScopes(value: unknown): AdminAgentScope[];
export async function createAdminAgentToken(access: WorkOsAccess, input: { name: unknown; scopes?: unknown; expiresInDays?: unknown }): Promise<{ token: Json; secret: string }>;
export async function listAdminAgentTokens(access: WorkOsAccess): Promise<Json[]>;
export async function revokeAdminAgentToken(access: WorkOsAccess, tokenId: string): Promise<boolean>;
```

`createAdminAgentToken` refuses a caller without `access.role === "admin"` or `featureFlags.admin_agent_api !== true`, inserts `kind: "admin"`, `person_id: access.personId` (may be null), and audits `agent_token.created` with `{ kind: "admin", name, scopes, expiresAt }`. List and revoke filter `organization_id`, `user_id`, `kind = "admin"`.

- [ ] **Step 4: Run and verify pass**

Run: `node --import tsx --test test/work-os-admin-agent-tokens.test.mts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/work-agent-tokens.ts test/work-os-admin-agent-tokens.test.mts
git commit -m "feat(work-os): add the admin token model and scopes"
```

---

### Task 3: Admin token authentication

**Files:**
- Create: `src/lib/work-admin-agent-auth.ts`
- Modify: `src/lib/work-agent-idempotency.ts`
- Create: `test/work-os-admin-agent-auth.test.mts`

**Interfaces:**
- Produces: `AdminAgentAccess`, `parseAdminAgentAuthorization()`, `hasAdminAgentScope()`, `adminAgentError()`, `adminAgentRouteError()`, `requireAdminAgentAccess()`.
- Produces: `AgentIdempotencyIdentity = { access: WorkOsAccess; tokenId: string }`; `withAgentIdempotency` accepts it.
- Consumes: `hashAgentToken`, `AdminAgentScope`, `WorkOsAccess`, `AgentRateLimitError`.

- [ ] **Step 1: Write the failing tests**

Create `test/work-os-admin-agent-auth.test.mts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  adminAgentError,
  adminAgentRouteError,
  hasAdminAgentScope,
  parseAdminAgentAuthorization,
} from "../src/lib/work-admin-agent-auth";
import { WorkOsConflictError, WorkOsForbiddenError, WorkOsNotFoundError, WorkOsValidationError } from "../src/lib/work-os-api";

test("only a wos_admin bearer is accepted", () => {
  assert.equal(parseAdminAgentAuthorization("Bearer wos_admin_abc"), "wos_admin_abc");
  assert.equal(parseAdminAgentAuthorization("Bearer wos_agent_abc"), null);
  assert.equal(parseAdminAgentAuthorization("Bearer desktop-token"), null);
});

test("scopes are exact", () => {
  assert.equal(hasAdminAgentScope(["tasks:read"], "tasks:read"), true);
  assert.equal(hasAdminAgentScope(["tasks:read"], "tasks:write"), false);
  assert.equal(hasAdminAgentScope([]), true);
});

test("the mapper keeps the API error contract", async () => {
  const notFound = adminAgentRouteError(new WorkOsNotFoundError());
  assert.equal(notFound.status, 404);
  assert.equal((await notFound.json() as { code: string }).code, "not_found");
  const forbidden = adminAgentRouteError(new WorkOsForbiddenError());
  assert.equal(forbidden.status, 403);
  const conflict = adminAgentRouteError(new WorkOsConflictError("changed", "preview_stale"));
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json() as { code: string }).code, "preview_stale");
  const validation = adminAgentRouteError(new WorkOsValidationError("bad"));
  assert.equal(validation.status, 400);
  const disabled = await adminAgentError("feature_disabled", "off", 403).json() as { code: string };
  assert.equal(disabled.code, "feature_disabled");
});
```

Add source assertions: `requireAdminAgentAccess` reads `work_agent_tokens` with `kind = "admin"`, loads the membership by `organization_id` + `user_id` + `active`, requires `role === "admin"`, and checks both `admin_agent_api` and `employee_companion`.

- [ ] **Step 2: Run and verify failure**

Run: `node --import tsx --test test/work-os-admin-agent-auth.test.mts`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the resolver**

Create `src/lib/work-admin-agent-auth.ts`:

```ts
export type AdminAgentAccess = {
  access: WorkOsAccess;
  tokenId: string;
  tokenName: string;
  tokenPrefix: string;
  expiresAt: string | null;
  scopes: AdminAgentScope[];
};

export function parseAdminAgentAuthorization(value: string | null): string | null;
export function hasAdminAgentScope(scopes: AdminAgentScope[], required?: AdminAgentScope): boolean;
export function adminAgentError(code: string, message: string, status: number): NextResponse;
export function adminAgentRouteError(error: unknown): NextResponse;
export async function requireAdminAgentAccess(req: Request, required?: AdminAgentScope): Promise<
  { agent: AdminAgentAccess; response?: never } | { response: NextResponse; agent?: never }
>;
```

The resolver follows the design's seven steps. Membership is `.eq("organization_id", token.organization_id).eq("user_id", token.user_id).eq("active", true).maybeSingle()` — never by `person_id`. `access.featureFlags` merges organization and membership flags. `access.personId` is `token.person_id ?? null`. `adminAgentRouteError` maps `AgentRateLimitError` to 429 with `Retry-After`, `WorkOsConflictError` to 409 with `reason`, `WorkOsNotFoundError` to 404, `WorkOsForbiddenError` to 403, `WorkOsValidationError`/`CompletionEvidenceError` to 400/413/415, and unknown errors to 500. It maps a preview error by class name (`WorkAdminPreviewError`) to its own `code` and `status`, so the auth module does not import the preview module and create a cycle.

In `src/lib/work-agent-idempotency.ts`, change the input from `agent: AgentAccess` to:

```ts
export type AgentIdempotencyIdentity = { access: WorkOsAccess; tokenId: string };
export async function withAgentIdempotency(input: {
  agent: AgentIdempotencyIdentity;
  key: string | null | undefined;
  requestHash: string;
  handler: () => Promise<{ status: number; body: unknown }>;
}): Promise<AgentIdempotencyResult>;
```

`AgentAccess` remains assignable, so the employee routes are unchanged.

- [ ] **Step 4: Run and verify pass**

Run: `node --import tsx --test test/work-os-admin-agent-auth.test.mts test/work-os-agent-idempotency.test.mts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/work-admin-agent-auth.ts test/work-os-admin-agent-auth.test.mts
git commit -m "feat(work-os): authenticate admin agent tokens"
```

---

### Task 4: Token-kind isolation and proxy boundary

**Files:**
- Modify: `src/lib/work-agent-auth.ts`
- Modify: `src/proxy.ts`
- Create: `test/work-os-agent-kind-isolation.test.mts`

**Interfaces:**
- Consumes: `requireAgentAccess` and `config.matcher`.
- Produces: employee resolver filters `kind = "employee"`; admin MCP is excluded from proxy body buffering.

- [ ] **Step 1: Write the failing tests**

```ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the employee resolver only accepts employee tokens", async () => {
  const auth = await read("src/lib/work-agent-auth.ts");
  assert.match(auth, /\.eq\("kind", "employee"\)/);
});

test("the admin MCP route is excluded from proxy body buffering", async () => {
  const proxy = await read("src/proxy.ts");
  assert.match(proxy, /api\/agent\/admin\/mcp/);
});

test("the employee MCP still exposes exactly seven tools", async () => {
  const mcp = await read("src/lib/work-agent-mcp.ts");
  const block = mcp.match(/AGENT_MCP_TOOL_NAMES = \[([^\]]+)\]/s)?.[1] ?? "";
  assert.equal((block.match(/"[a-z_]+"/g) ?? []).length, 7);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `node --import tsx --test test/work-os-agent-kind-isolation.test.mts`
Expected: FAIL; the kind filter and matcher entry are absent.

- [ ] **Step 3: Implement**

In `requireAgentAccess`, add `.eq("kind", "employee")` to the token lookup. In `src/proxy.ts`, change the matcher to exclude both `/api/mcp` and `/api/agent/admin/mcp`:

```ts
"/((?!_next/static|_next/image|api/downloads|api/files/[^/]+/upload|api/mcp|api/agent/admin/mcp|favicon.ico|icon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|lottie|wasm)$).*)",
```

- [ ] **Step 4: Run and verify pass**

Run: `node --import tsx --test test/work-os-agent-kind-isolation.test.mts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/work-agent-auth.ts src/proxy.ts test/work-os-agent-kind-isolation.test.mts
git commit -m "fix(work-os): isolate agent token kinds at the auth boundary"
```

---

### Task 5: Admin token routes and settings panel

**Files:**
- Create: `src/app/api/work-os/me/admin-agent-tokens/route.ts`
- Create: `src/app/api/work-os/me/admin-agent-tokens/[tokenId]/route.ts`
- Create: `src/modules/work-os/admin/AdminAgentAccess.tsx`
- Modify: `src/modules/work-os/admin/AdminSettings.tsx`
- Create: `test/work-os-admin-agent-settings-ui.test.mts`

**Interfaces:**
- Consumes: `createAdminAgentToken`, `listAdminAgentTokens`, `revokeAdminAgentToken`.
- Produces: `GET|POST /api/work-os/me/admin-agent-tokens`, `DELETE /api/work-os/me/admin-agent-tokens/{tokenId}`, and the Admin Settings section.

- [ ] **Step 1: Write the failing tests**

```ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("admin settings exposes the admin token panel behind the flag", async () => {
  const settings = await read("src/modules/work-os/admin/AdminSettings.tsx");
  assert.match(settings, /AdminAgentAccess/);
  assert.match(settings, /admin_agent_api/);
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
```

- [ ] **Step 2: Run and verify failure**

Run: `node --import tsx --test test/work-os-admin-agent-settings-ui.test.mts`
Expected: FAIL.

- [ ] **Step 3: Implement the routes**

Both routes use `requireWorkOsAccess({ roles: ["admin"], feature: "employee_companion" })` and then reject with `403 feature_disabled` when `auth.access.featureFlags.admin_agent_api !== true`. POST accepts only `name`, `scopes`, `expires_in_days`; GET lists only the caller's admin tokens; DELETE revokes only the caller's admin token and answers 404 otherwise. Return the secret once with `{ token, secret }`.

- [ ] **Step 4: Implement the panel**

Create `AdminAgentAccess.tsx` modeled on `src/modules/work-os/employee/AgentAccessSettings.tsx`: token name field, scope checkboxes, expiry select (30/90/365), create, copy-once notice, list with prefix/last used/expiry, revoke. Use the admin UI primitives (`AdminCard`, `SectionHeading`, `Button`, `Notice`, `StatusPill`). Add `{ key: "admin_agent_api", label: "Admin agent API", detail: "Token-scoped admin reads, task actions, EOD review, and MCP." }` to `FEATURES` and render `<AdminAgentAccess />` only when `organizationFlags.admin_agent_api === true`, otherwise a quiet notice that the feature is off.

- [ ] **Step 5: Run and verify pass**

Run: `node --import tsx --test test/work-os-admin-agent-settings-ui.test.mts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/work-os/me/admin-agent-tokens src/modules/work-os/admin/AdminAgentAccess.tsx src/modules/work-os/admin/AdminSettings.tsx test/work-os-admin-agent-settings-ui.test.mts
git commit -m "feat(work-os): let admins mint admin-scoped agent tokens"
```

---

### Task 6: Directory and project reads

**Files:**
- Create: `src/lib/work-admin-agent-directory.ts`
- Create: `src/app/api/agent/admin/v1/people/route.ts`
- Create: `src/app/api/agent/admin/v1/people/[personId]/route.ts`
- Create: `src/app/api/agent/admin/v1/projects/route.ts`
- Create: `test/helpers/work-os-admin-agent-fixture.mts`
- Create: `test/work-os-admin-agent-directory.test.mts`

**Interfaces:**
- Produces: `AdminAgentPerson`, `AdminAgentPersonDetail`, `AdminAgentProject`, `parseAdminAgentPeopleFilters()`, `listAdminAgentPeople()`, `getAdminAgentPerson()`, `listAdminAgentProjects()`.

- [ ] **Step 1: Write the fixture**

Create `test/helpers/work-os-admin-agent-fixture.mts`. Reuse the prerequisite tables from `test/helpers/work-os-admin-otto-reads-fixture.mts`, add:

```sql
create table work_agent_tokens (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null,
  person_id uuid, user_id uuid not null, kind text not null default 'employee',
  name text not null, token_hash text not null unique, token_prefix text not null,
  scopes text[] not null default '{}', created_by uuid, expires_at timestamptz not null,
  last_used_at timestamptz, revoked_at timestamptz, created_at timestamptz not null default now()
);
```

Add any of these tables the copied block lacks: `work_admin_action_previews`, `work_report_versions`, `work_evidence`, `work_projects`, `work_teams`, `work_team_members`, `work_role_profiles`, `work_task_day_events`. Export `fixture()` that creates a `PGlite`, executes the prerequisite block, executes `0069_work_admin_agent_access.sql`, and assigns `globalThis.__workOsPgPool`. Export constants `org`, `otherOrg`, `adminUser`, `personA`, `personB`, `personC`, `otherPerson`, plus `adminAccess` (`role: "admin"`, `personId: null`, flags `{ employee_companion: true, admin_agent_api: true }`), `mappedAdminAccess` (`personId: personA`), and `otherOrgAccess`.

- [ ] **Step 2: Write the failing directory tests**

```ts
test("search filters by name, active state, team, and role", async () => {
  const f = await fixture();
  try {
    // seed people, role profiles, teams, team members
    const byName = await listAdminAgentPeople(adminAccess, { query: "ada", active: true, teamId: null, role: null, limit: 50, cursor: null });
    assert.deepEqual(byName.people.map((p) => p.displayName), ["Ada Lovelace"]);
    const byTeam = await listAdminAgentPeople(adminAccess, { query: null, active: true, teamId: teamId, role: null, limit: 50, cursor: null });
    assert.deepEqual(byTeam.people.map((p) => p.id), [personA]);
    const byRole = await listAdminAgentPeople(adminAccess, { query: null, active: true, teamId: null, role: "Engineer", limit: 50, cursor: null });
    assert.deepEqual(byRole.people.map((p) => p.id), [personA]);
    const inactive = await listAdminAgentPeople(adminAccess, { query: null, active: false, teamId: null, role: null, limit: 50, cursor: null });
    assert.deepEqual(inactive.people.map((p) => p.id), [personC]);
  } finally { await f.close(); }
});

test("the directory never crosses the organization boundary", async () => {
  const f = await fixture();
  try {
    const page = await listAdminAgentPeople(otherOrgAccess, { query: null, active: true, teamId: null, role: null, limit: 50, cursor: null });
    assert.deepEqual(page.people.map((p) => p.id), [otherPerson]);
  } finally { await f.close(); }
});
```

Also test `getAdminAgentPerson` returns `null` for another organization and `listAdminAgentProjects` excludes archived rows.

- [ ] **Step 3: Run and verify failure**

Run: `node --import tsx --test test/work-os-admin-agent-directory.test.mts`
Expected: FAIL.

- [ ] **Step 4: Implement the directory service**

Use `getPool()` with SQL. The list query filters `p.organization_id = $1`, `($2::boolean IS NULL OR p.active = $2)`, `lower(p.display_name) LIKE '%' || lower($3) || '%' OR lower(p.email) LIKE ...`, `EXISTS (select 1 from work_team_members tm where tm.team_id = $4 and tm.person_id = p.id)`, and `rp.name = $5`. Order by `lower(display_name), id`; cursor on `(lower(display_name), id)`. Return `total` and `nextCursor`.

`getAdminAgentPerson` returns profile, onboarding timezone, role profile, manager, and teams; return `null` for another organization. `listAdminAgentProjects` returns active, non-archived projects ordered by name.

- [ ] **Step 5: Add the routes**

Each route:
1. `requireAdminAgentAccess(req, "people:read")`.
2. `assertAgentRateLimit(agent.tokenId, false)`.
3. Parse query params, call the service, return `{ people, cursor }`, `{ person }`, or `{ projects }`.
4. Catch with `adminAgentRouteError`.

- [ ] **Step 6: Run and verify pass**

Run: `node --import tsx --test test/work-os-admin-agent-directory.test.mts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/work-admin-agent-directory.ts src/app/api/agent/admin/v1/people src/app/api/agent/admin/v1/projects test/helpers/work-os-admin-agent-fixture.mts test/work-os-admin-agent-directory.test.mts
git commit -m "feat(work-os): add the admin directory API"
```

---

### Task 7: Cross-person task reads

**Files:**
- Create: `src/lib/work-admin-agent-tasks.ts`
- Modify: `src/lib/work-agent-activity.ts` (extract `listActivityForAccess`)
- Create: `src/app/api/agent/admin/v1/tasks/route.ts`
- Create: `src/app/api/agent/admin/v1/tasks/[taskId]/route.ts`
- Create: `src/app/api/agent/admin/v1/tasks/[taskId]/activity/route.ts`
- Create: `test/work-os-admin-agent-tasks.test.mts`

**Interfaces:**
- Produces: `listAdminAgentTasks(access, filters): Promise<{ tasks: Json[]; nextCursor: string | null; total: number }>`, `getAdminAgentTask(access, taskId)`, `getAdminAgentTaskActivity(access, taskId, params)`.

- [ ] **Step 1: Write the failing tests**

Seed tasks for `personA` and `personB` in the fixture. Assert:

```ts
test("person_ids, text, completion, project, and due filters compose", async () => {
  const page = await listAdminAgentTasks(adminAccess, {
    personIds: [personA, personB], query: "checkout", completed: false,
    status: "active", projectId: null, dueFrom: "2026-11-01", dueTo: "2026-11-30",
    updatedSince: null, limit: 50, cursor: null,
  });
  assert.deepEqual(page.tasks.map((t) => t.title), ["Fix checkout"]);
});

test("an empty person list is no rows, not the whole team", async () => {
  const page = await listAdminAgentTasks(adminAccess, { ...defaults, personIds: [] });
  assert.deepEqual(page.tasks, []);
});

test("the list never returns another organization's tasks", async () => {
  const page = await listAdminAgentTasks(otherOrgAccess, { ...defaults, personIds: null });
  assert.deepEqual(page.tasks.map((t) => t.id), [otherTask]);
});
```

Define `const defaults = { personIds: [personA, personB], query: null, completed: null, status: "active" as const, projectId: null, dueFrom: null, dueTo: null, updatedSince: null, limit: 50, cursor: null };` at the top of the test file. Add a test that `updated_since` returns changed rows ascending and that a malformed cursor throws `WorkOsValidationError`.

- [ ] **Step 2: Run and verify failure**

Run: `node --import tsx --test test/work-os-admin-agent-tasks.test.mts`
Expected: FAIL.

- [ ] **Step 3: Implement the list**

Use `getPool()` SQL over `work_tasks`. Include:

```sql
where t.organization_id = $1
  and ($2::uuid[] is null or t.assignee_person_ids && $2::uuid[])
  and ($3::text is null or t.title ilike '%' || $3 || '%' or coalesce(t.description,'') ilike '%' || $3 || '%')
  and ($4::boolean is null or t.completed = $4)
  and ($5::text is null or t.status = $5)
  and ($6::uuid is null or t.project_id = $6)
  and ($7::date is null or t.due_date >= $7::date)
  and ($8::date is null or t.due_date <= $8::date)
  and ($9::timestamptz is null or t.updated_at >= $9::timestamptz)
```

`status` defaults to active (`coalesce(t.status,'') not in ('archived','deleted')`) and `personIds: []` returns empty. Keyset cursor on `(updated_at, id)` for the normal order and `(updated_at, id)` ascending for `updated_since`. Escape `%`, `_`, and `\` in `query` before interpolating a parameter. Return `total` from a `count(*)` with the same filters.

- [ ] **Step 4: Implement detail and activity**

`getAdminAgentTask` calls `getWorkOsEmployeeTaskDetails(access, taskId)` and returns `{ task, subtasks, completionEvidence }`. `getAdminAgentTaskActivity` calls a new `listActivityForAccess(access, taskId, params)` extracted from `listAgentActivity`; the employee wrapper passes `agent.access`.

- [ ] **Step 5: Add the routes**

`GET /tasks` parses `person_ids` (max 20), `q`, `completed`, `status`, `project_id`, `due_from`, `due_to`, `updated_since`, `limit`, `cursor`; calls `listAdminAgentTasks`; decorates with `withTaskCapabilities(tasks, { role: "admin", personId: access.personId }, await employeeTaskToday(access))`. `GET /tasks/{id}` returns 404 for a missing or cross-org task. `GET /tasks/{id}/activity` returns the timeline.

- [ ] **Step 6: Run and verify pass**

Run: `node --import tsx --test test/work-os-admin-agent-tasks.test.mts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/work-admin-agent-tasks.ts src/lib/work-agent-activity.ts src/app/api/agent/admin/v1/tasks test/work-os-admin-agent-tasks.test.mts
git commit -m "feat(work-os): add cross-person task reads"
```

---

### Task 8: EOD reads and review

**Files:**
- Create: `src/lib/work-admin-agent-eods.ts`
- Create: `src/app/api/agent/admin/v1/eods/route.ts`
- Create: `src/app/api/agent/admin/v1/eods/[reportId]/route.ts`
- Create: `test/work-os-admin-agent-eods.test.mts`

**Interfaces:**
- Produces: `listAdminAgentEods(access, filters)`, `getAdminAgentEod(access, reportId)`, `reviewAdminAgentEod(access, reportId, body)`.
- `reviewAdminAgentEod` accepts `{ status: "approved" | "rejected"; manager_notes?: string; markdown?: string }`.

- [ ] **Step 1: Write the failing tests**

Seed submitted EODs for `personA` and `personB`; set `ownReportId` to `personA`'s report and `approvedReportId` to a report already in `approved`. Assert person/date/status/text filters, cursor, org isolation, detail includes versions, and review translation:

```ts
await assert.rejects(
  () => reviewAdminAgentEod(mappedAdminAccess, ownReportId, { status: "approved" }),
  (error: Error) => error.name === "WorkOsForbiddenError",
);
await assert.rejects(
  () => reviewAdminAgentEod(adminAccess, approvedReportId, { status: "approved" }),
  (error: Error) => error.name === "WorkOsConflictError",
);
```

- [ ] **Step 2: Run and verify failure**

Run: `node --import tsx --test test/work-os-admin-agent-eods.test.mts`
Expected: FAIL.

- [ ] **Step 3: Implement the list and detail**

`listAdminAgentEods` uses `getPool()` over `work_reports` with `organization_id`, `person_id = any(...)`, `status`, `report_date >= from`, `report_date <= to`, and `q` on `title`, `submitted_markdown`, `markdown`. Order `report_date desc, created_at desc`; keyset cursor. Include person `{ id, displayName }` and a count per status. `getAdminAgentEod` returns the report and its `work_report_versions` ordered by `created_at`; another organization returns `null`.

- [ ] **Step 4: Implement review translation**

`reviewAdminAgentEod` loads the report by organization and id, returns `WorkOsNotFoundError` when absent, `WorkOsForbiddenError` when `report.person_id === access.personId`, and `WorkOsConflictError("report is no longer pending review", "report_not_pending")` when the status is not `pending_review`. Then call `reviewWorkOsEod(access, reportId, body)`. Add `adminTokenId`/`adminTokenName` to the audit only if the action is invoked from the action registry; the service itself audits `report.approved`/`report.rejected` through `reviewWorkOsEod`.

- [ ] **Step 5: Add the read routes**

`GET /eods` requires `eods:read`; `GET /eods/{id}` requires `eods:read`. The review route is added in Task 13 as a preview creator.

- [ ] **Step 6: Run and verify pass**

Run: `node --import tsx --test test/work-os-admin-agent-eods.test.mts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/work-admin-agent-eods.ts src/app/api/agent/admin/v1/eods test/work-os-admin-agent-eods.test.mts
git commit -m "feat(work-os): add admin EOD reads and review"
```

---

### Task 9: Records, overview, and insights

**Files:**
- Modify: `src/lib/work-os-admin-otto-reads.ts`
- Create: `src/lib/work-admin-agent-records.ts`
- Create: `src/lib/work-admin-agent-insights.ts`
- Create: `src/app/api/agent/admin/v1/records/route.ts`
- Create: `src/app/api/agent/admin/v1/overview/route.ts`
- Create: `src/app/api/agent/admin/v1/insights/route.ts`
- Create: `test/work-os-admin-agent-records.test.mts`

**Interfaces:**
- Produces: `listAdminAgentRecords(access, filters)`, `getAdminAgentOverview(access, date?)`, `getAdminAgentInsights(access, range, options)`.
- Modifies: `listAdminOttoRecords` input gains `query?: string | null`.

- [ ] **Step 1: Write the failing test**

Seed an authored update, a submitted EOD, and a reviewed recap. Assert `listAdminOttoRecords(access, { windows, sources: ["update", "submitted_eod"], query: "checkout" })` returns only records whose projected text contains the query, in the normal order, and that another organization's records are absent. Assert `getAdminAgentOverview` and `getAdminAgentInsights` are thin wrappers over `getAdminOverview`/`getAdminInsights` by source assertion.

- [ ] **Step 2: Run and verify failure**

Run: `node --import tsx --test test/work-os-admin-agent-records.test.mts`
Expected: FAIL.

- [ ] **Step 3: Implement records query**

Add `query` to the `listAdminOttoRecords` input. In the final select over the `records` CTE, add `and ($n::text is null or text ilike '%' || $n || '%')`. Escape `%`, `_`, and `\`. Keep the existing cursor and sources behavior.

`listAdminAgentRecords` parses `person_ids`, `sources`, `from`, `to`, `q`, `cursor`; calls `adminOttoWindowsFromQuery` and `listAdminOttoRecords`; returns the page.

- [ ] **Step 4: Implement overview and insights wrappers**

`getAdminAgentOverview(access, date?)` calls `getAdminOverview({ ...access }, { date })`. `getAdminAgentInsights(access, range, options)` calls `getAdminInsights(access, range, options)`. Both require `access.role === "admin"`.

- [ ] **Step 5: Add the routes**

`GET /records` requires `records:read`; `GET /overview` and `GET /insights` require `insights:read`. `insights` accepts optional `person_id` and `range=7d|30d|90d`. Return 404 when a `person_id` is outside the organization.

- [ ] **Step 6: Run and verify pass**

Run: `node --import tsx --test test/work-os-admin-agent-records.test.mts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/work-os-admin-otto-reads.ts src/lib/work-admin-agent-records.ts src/lib/work-admin-agent-insights.ts src/app/api/agent/admin/v1/records src/app/api/agent/admin/v1/overview src/app/api/agent/admin/v1/insights test/work-os-admin-agent-records.test.mts
git commit -m "feat(work-os): add admin records, overview, and insights"
```

---

### Task 10: Preview store and state fingerprints

**Files:**
- Create: `src/lib/work-admin-action-previews.ts`
- Create: `test/work-os-admin-action-previews.test.mts`

**Interfaces:**
- Produces: `stableStateJson()`, `previewFingerprint()`, `createAdminPreview()`, `getAdminPreview()`, `confirmAdminPreview()`, `WorkAdminPreviewError`.
- `confirmAdminPreview(access, previewId, idempotencyKey, deps: { readState: () => Promise<Json>; apply: () => Promise<{ status: number; body: Json }> })` returns `{ status, body, replayed }`.

- [ ] **Step 1: Write the failing tests**

With the fixture, define `input` as `{ organizationId: org, userId: adminUser, tokenId: null, source: "api" as const, action: "task.assign" as const, targetType: "task", targetId: "t1", request: {}, preview: { action: "task.assign", summary: "Assign", changes: [], warnings: [], state: {}, expiresAt: "" }, expiresAt: new Date(Date.now() + 60_000) }`, then create a preview for a fake task state `{ updatedAt: "a", status: "open" }` and assert:

```ts
test("confirm applies once and replays the stored result", async () => {
  const created = await createAdminPreview({ ...input, state: { updatedAt: "a", status: "open" } });
  let applied = 0;
  const first = await confirmAdminPreview(adminAccess, created.id, "key-1", {
    readState: async () => ({ updatedAt: "a", status: "open" }),
    apply: async () => { applied += 1; return { status: 200, body: { ok: true } }; },
  });
  assert.equal(first.replayed, false);
  const second = await confirmAdminPreview(adminAccess, created.id, "key-2", {
    readState: async () => ({ updatedAt: "a", status: "open" }),
    apply: async () => { applied += 1; return { status: 200, body: { ok: false } }; },
  });
  assert.equal(second.replayed, true);
  assert.equal(applied, 1);
  assert.deepEqual(second.body, { ok: true });
});

test("a changed target state is stale and writes nothing", async () => {
  const created = await createAdminPreview({ ...input, state: { updatedAt: "a", status: "open" } });
  await assert.rejects(
    () => confirmAdminPreview(adminAccess, created.id, "key-1", {
      readState: async () => ({ updatedAt: "b", status: "open" }),
      apply: async () => { throw new Error("must not apply"); },
    }),
    (error: Error) => error.name === "WorkAdminPreviewError" && (error as any).code === "preview_stale",
  );
});

test("expired previews answer preview_expired", async () => { /* expiresAt in the past */ });
test("another user or organization cannot read or confirm the preview", async () => { /* 404 */ });
```

- [ ] **Step 2: Run and verify failure**

Run: `node --import tsx --test test/work-os-admin-action-previews.test.mts`
Expected: FAIL.

- [ ] **Step 3: Implement the store**

Use `getPool()` and a transaction:

1. `createAdminPreview` inserts with a 15-minute `expires_at`, `state_fingerprint = previewFingerprint(state)`, and returns the row.
2. `getAdminPreview` selects by id, organization, and `(user_id = access.ctx.user.id or token match)`; missing returns `null`.
3. `confirmAdminPreview` opens a transaction, `select ... for update`, checks expiry, `confirmed_at`, and fingerprint against `deps.readState()`. A mismatch throws `WorkAdminPreviewError("preview_stale", 409)`. If already confirmed, return `result_body` with `replayed: true`. Otherwise mark `confirmed_at` and `idempotency_key`, commit, run `deps.apply()`, then update `result_status`/`result_body`. On apply failure, clear `confirmed_at` and rethrow.
4. `previewFingerprint` is SHA-256 over `stableStateJson` (recursively sorted object keys, sorted arrays where the action says order is irrelevant).

Define:

```ts
export class WorkAdminPreviewError extends Error {
  code: "preview_expired" | "preview_stale" | "preview_in_flight" | "preview_not_found";
  status: 404 | 409 | 410;
}
```

- [ ] **Step 4: Run and verify pass**

Run: `node --import tsx --test test/work-os-admin-action-previews.test.mts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/work-admin-action-previews.ts test/work-os-admin-action-previews.test.mts
git commit -m "feat(work-os): store and confirm admin action previews"
```

---

### Task 11: Task create, update, assign, and move actions

**Files:**
- Create: `src/lib/work-admin-agent-actions.ts`
- Create: `test/work-os-admin-agent-actions.test.mts`

**Interfaces:**
- Produces: `AdminAgentActionServices`, `previewAdminAction()`, `applyAdminAction()`.
- Actions: `task.create`, `task.update`, `task.assign`, `task.move`.

```ts
export type AdminAgentActionServices = {
  getTask: (access: WorkOsAccess, taskId: string) => Promise<Json>;
  createTask: (access: WorkOsAccess, payload: Json) => Promise<Json>;
  updateTask: (access: WorkOsAccess, taskId: string, payload: Json) => Promise<Json>;
  moveTask: (access: WorkOsAccess, taskId: string, parentTaskId: string) => Promise<Json>;
  completeTask: (access: WorkOsAccess, taskId: string, completed: boolean) => Promise<Json>;
  archiveTask: (access: WorkOsAccess, taskId: string, mode: "archive" | "delete") => Promise<Json>;
  reviewEod: (access: WorkOsAccess, reportId: string, body: Json) => Promise<Json>;
};
export type AdminActionPreview = Omit<AdminPreview, "id" | "expiresAt"> & {
  targetType: string;
  targetId: string | null;
};
export async function previewAdminAction(access: WorkOsAccess, action: AdminPreviewAction, payload: Json, services: AdminAgentActionServices): Promise<AdminActionPreview>;
export async function applyAdminAction(
  access: WorkOsAccess,
  action: AdminPreviewAction,
  payload: Json,
  services: AdminAgentActionServices,
  actor: { tokenId: string; tokenName: string },
): Promise<{ status: number; body: Json }>;
export const defaultAdminAgentActionServices: AdminAgentActionServices;
```

Define `fakeServices(task, extras?)` in the test file with the same seven methods; every method records its call and returns the supplied task/report. The helper is test-only and not exported from production code.

- [ ] **Step 1: Write the failing tests**

Use fakes:

```ts
const task = { id: "t1", title: "Ship", assignee_person_ids: [personA], completed: false, status: "open", updated_at: "2026-11-02T00:00:00Z", parent_task_id: null };

test("assign add resolves the final list once and lists the change", async () => {
  const preview = await previewAdminAction(adminAccess, "task.assign", { task_id: "t1", mode: "add", person_ids: [personB] }, fakeServices(task));
  assert.deepEqual(preview.changes, [{ field: "assignees", from: [personA], to: [personA, personB] }]);
  assert.deepEqual(preview.state, { updatedAt: task.updated_at, status: "open", completed: false, assignees: [personA, personB].sort(), parentId: null });
});

test("remove and replace are exact", async () => { /* add/remove/replace */ });
test("move warns when the target is not a top-level task", async () => { /* warnings */ });
test("a stale preview does not apply", async () => { /* fake getTask returns changed updated_at, preview state differs */ });
test("create defaults the owner to the named person and rejects an unknown id", async () => { /* errors */ });
test("an unmapped admin previews an assignment without inventing a person", async () => {
  const preview = await previewAdminAction(adminAccess, "task.assign", { task_id: "t1", mode: "add", person_ids: [personB] }, fakeServices(task));
  assert.equal(preview.changes[0].to.includes(personB), true);
  assert.equal(adminAccess.personId, null);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `node --import tsx --test test/work-os-admin-agent-actions.test.mts`
Expected: FAIL.

- [ ] **Step 3: Implement the previews**

For each action, resolve the target with `services.getTask`, validate the payload, and compute `changes` + `state`:

- `task.create`: `summary: "Create <title> for <names>"`; state `{}`; changes list name, owners, project, due date.
- `task.update`: state from the task; changes for each supplied field with `from`/`to`.
- `task.assign`: state includes the resolved final assignee list; changes `assignees` from current to final; warnings when removing everyone or assigning an inactive person.
- `task.move`: state includes `parentId`; changes `parent`; warning when the task is not a subtask or the new parent is in another project.

- [ ] **Step 4: Implement apply**

`applyAdminAction` calls the service with the stored payload; `task.assign` sends the exact final list (not a delta); `task.move` calls `services.moveTask`; `task.create` calls `services.createTask`. After success, write `audit(access, "admin." + action, targetType, targetId, { tokenId, tokenName, action, changes })`, then return `{ status, body }`.

- [ ] **Step 5: Run and verify pass**

Run: `node --import tsx --test test/work-os-admin-agent-actions.test.mts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/work-admin-agent-actions.ts test/work-os-admin-agent-actions.test.mts
git commit -m "feat(work-os): preview admin task create, update, assign, and move"
```

---

### Task 12: Task lifecycle and EOD review actions

**Files:**
- Modify: `src/lib/work-admin-agent-actions.ts`
- Modify: `test/work-os-admin-agent-actions.test.mts`

**Interfaces:**
- Adds actions: `task.complete`, `task.reopen`, `task.archive`, `task.delete`, `eod.review`.

- [ ] **Step 1: Write the failing tests**

```ts
test("complete blocks a task with an expected outcome until evidence exists", async () => {
  const preview = await previewAdminAction(adminAccess, "task.complete", { task_id: "t1" }, fakeServices({ ...task, expected_outcome: "Ship" }));
  assert.ok(preview.warnings.some((warning) => /evidence/i.test(warning)));
});

test("archive and delete are distinct previews", async () => {
  assert.equal((await previewAdminAction(adminAccess, "task.archive", { task_id: "t1" }, fakeServices(task))).summary, "Archive Ship");
  assert.equal((await previewAdminAction(adminAccess, "task.delete", { task_id: "t1" }, fakeServices(task))).summary, "Delete Ship");
});

test("EOD review preview names the decision and preserves self-review refusal", async () => {
  const preview = await previewAdminAction(adminAccess, "eod.review", { report_id: "r1", status: "approved", manager_notes: "Looks good" }, fakeServices(task, { report: { id: "r1", person_id: personB, status: "pending_review", title: "EOD" } }));
  assert.match(preview.summary, /Approve EOD/);
  const own = await previewAdminAction(adminAccess, "eod.review", { report_id: "r1", status: "approved" }, fakeServices(task, { report: { id: "r1", person_id: personA, status: "pending_review", title: "EOD" } }));
  assert.ok(own.warnings.some((warning) => /own report/i.test(warning)));
});
```

- [ ] **Step 2: Run and verify failure**

Run: `node --import tsx --test test/work-os-admin-agent-actions.test.mts`
Expected: FAIL on the new actions.

- [ ] **Step 3: Implement**

- `task.complete` / `task.reopen`: state includes `completed`; warning when completion evidence is required; apply `services.completeTask`.
- `task.archive` / `task.delete`: state includes `status`; warnings for children; apply `services.archiveTask` with the mode.
- `eod.review`: state `{ status, updatedAt }`; changes `status`, `manager_notes`; warnings for self-review, non-pending status, or a manager edit; apply `services.reviewEod`.

- [ ] **Step 4: Run and verify pass**

Run: `node --import tsx --test test/work-os-admin-agent-actions.test.mts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/work-admin-agent-actions.ts test/work-os-admin-agent-actions.test.mts
git commit -m "feat(work-os): preview admin lifecycle and EOD decisions"
```

---

### Task 13: Preview and task write routes

**Files:**
- Create: `src/app/api/agent/admin/v1/previews/route.ts`
- Create: `src/app/api/agent/admin/v1/previews/[previewId]/route.ts`
- Create: `src/app/api/agent/admin/v1/previews/[previewId]/confirm/route.ts`
- Modify: `src/app/api/agent/admin/v1/tasks/route.ts` (add POST)
- Modify: `src/app/api/agent/admin/v1/tasks/[taskId]/route.ts` (add PATCH/DELETE)
- Create: `src/app/api/agent/admin/v1/tasks/[taskId]/assign/route.ts`
- Create: `src/app/api/agent/admin/v1/tasks/[taskId]/move/route.ts`
- Create: `src/app/api/agent/admin/v1/tasks/[taskId]/complete/route.ts`
- Create: `src/app/api/agent/admin/v1/tasks/[taskId]/reopen/route.ts`
- Create: `src/app/api/agent/admin/v1/eods/[reportId]/review/route.ts`
- Create: `test/work-os-admin-agent-write-routes.test.mts`

**Interfaces:**
- Produces: `POST /previews`, `GET /previews/{id}`, `POST /previews/{id}/confirm`, and the action routes that create previews.
- Consumes: `createAdminPreview`, `getAdminPreview`, `confirmAdminPreview`, `previewAdminAction`, `applyAdminAction`.

- [ ] **Step 1: Write the failing route tests**

Source assertions:

```ts
test("every consequential write route answers 202 with a preview", async () => {
  for (const file of ["tasks/route.ts", "tasks/[taskId]/route.ts", "tasks/[taskId]/assign/route.ts", "tasks/[taskId]/move/route.ts", "tasks/[taskId]/complete/route.ts", "tasks/[taskId]/reopen/route.ts", "eods/[reportId]/review/route.ts"]) {
    const body = await read(`src/app/api/agent/admin/v1/${file}`);
    assert.match(body, /createAdminPreview/, file);
    assert.match(body, /202/, file);
  }
});

test("only the preview confirm route applies an action", async () => {
  const confirm = await read("src/app/api/agent/admin/v1/previews/[previewId]/confirm/route.ts");
  assert.match(confirm, /confirmAdminPreview/);
  assert.match(confirm, /Idempotency-Key/i);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `node --import tsx --test test/work-os-admin-agent-write-routes.test.mts`
Expected: FAIL.

- [ ] **Step 3: Implement the preview creators**

Each action route:

1. `requireAdminAgentAccess(req, <scope>)` where tasks use `tasks:write` and EOD review uses `eods:review`.
2. `assertAgentRateLimit(agent.tokenId, true)`.
3. Parse the body and normalize it to the action payload (`task_id`, `report_id`, `mode`, `person_ids`, fields).
4. `previewAdminAction(agent.access, action, payload, defaultAdminAgentActionServices)`.
5. Require `Idempotency-Key`; a missing header answers `400 validation_error`. `createAdminPreview({ organizationId, userId, tokenId: agent.tokenId, source: "api", action, targetType, targetId, request: payload, preview, state, expiresAt: now + 15m })`.
6. Return `202` with the preview.

`POST /previews` accepts `{ action, payload }` with the same scope and idempotency rules.

- [ ] **Step 4: Implement get and confirm**

`GET /previews/{id}` requires the action's write scope, loads by token/user/org, returns the preview or 404. `POST /previews/{id}/confirm` requires `Idempotency-Key`, calls `confirmAdminPreview` with `readState`/`apply` closures that use the stored action/payload and the default services, and passes `{ tokenId: agent.tokenId, tokenName: agent.tokenName }` to `applyAdminAction`. It returns the stored result; a replayed confirm returns `Idempotent-Replay: true`.

- [ ] **Step 5: Implement progress/evidence exception docs in route comments**

Do not add progress/evidence here; Task 14 owns them.

- [ ] **Step 6: Run and verify pass**

Run: `node --import tsx --test test/work-os-admin-agent-write-routes.test.mts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/agent/admin/v1/previews src/app/api/agent/admin/v1/tasks src/app/api/agent/admin/v1/eods/[reportId]/review test/work-os-admin-agent-write-routes.test.mts
git commit -m "feat(work-os): add admin preview and task write routes"
```

---

### Task 14: Progress, evidence, and evidence download

**Files:**
- Create: `src/lib/work-admin-agent-evidence.ts`
- Create: `src/app/api/agent/admin/v1/tasks/[taskId]/progress/route.ts`
- Create: `src/app/api/agent/admin/v1/tasks/[taskId]/evidence/route.ts`
- Create: `src/app/api/agent/admin/v1/evidence/[evidenceId]/file/route.ts`
- Create: `test/work-os-admin-agent-evidence.test.mts`

**Interfaces:**
- Produces: `adminEvidenceObjectPath(input: { organizationId: string; taskId: string; evidenceId: string; contentType: string }): string`.
- Produces: `adminEvidenceMetrics(input: { contentType: string; fileName: string; sizeBytes: number; note: string; adminUserId: string; adminTokenId: string; targetPersonId: string | null }): Json`.
- Produces: `addAdminAgentProgress(access: WorkOsAccess, taskId: string, body: Json, idempotencyKey: string, actor: { tokenId: string; tokenName: string }): Promise<Json>`.
- Produces: `attachAdminAgentEvidence(access: WorkOsAccess, taskId: string, input: CompletionEvidenceUpload, actor: { tokenId: string; tokenName: string }): Promise<{ evidence: Json }>`.
- Produces: `getAdminAgentEvidenceFile(access: WorkOsAccess, evidenceId: string): Promise<{ bytes: Uint8Array; contentType: string; fileName: string } | null>`.

- [ ] **Step 1: Write the failing tests**

```ts
test("admin evidence is task-scoped and records the uploader, not a person", () => {
  const metrics = adminEvidenceMetrics({
    contentType: "image/png", fileName: "proof.png", sizeBytes: 10, note: "Done",
    adminUserId: adminUser, adminTokenId: "token-1", targetPersonId: personB,
  });
  assert.equal(metrics.employeeAttached, true);
  assert.equal(metrics.evidenceClass, "output_evidence");
  assert.equal(metrics.adminUserId, adminUser);
  assert.equal(metrics.attachedForPersonId, personB);
  assert.equal(metrics.personId, undefined);
});

test("the storage path is task-based", () => {
  assert.equal(adminEvidenceObjectPath({ organizationId: org, taskId: "t1", evidenceId: "e1", contentType: "image/png" }),
    `organizations/${org}/tasks/t1/evidence/e1.png`);
});

test("a read-only token cannot attach evidence", async () => { /* scope guard returns 403 */ });
```

- [ ] **Step 2: Run and verify failure**

Run: `node --import tsx --test test/work-os-admin-agent-evidence.test.mts`
Expected: FAIL.

- [ ] **Step 3: Implement the service**

`attachAdminAgentEvidence(access, taskId, input, actor)`:

1. Load the task through `getWorkOsEmployeeTaskDetails` so an admin can attach to any task in the organization.
2. Validate with `validateCompletionEvidenceUpload` and `assertCompletionEvidenceBytes`.
3. Upload to the task path with `getStorageBackend().upload`.
4. Insert `work_evidence` with `person_id: null`, `task_id`, `source: "manual"`, `metrics` from `adminEvidenceMetrics`, `raw: { origin: "admin_task_completion", adminUserId, adminTokenId }`, `idempotency_key`.
5. Return the evidence row; a failed insert removes the uploaded object.

`addAdminAgentProgress(access, taskId, body, idempotencyKey)` inserts a task-scoped evidence row with `source: "agent"`, `person_id: null`, and `metrics.origin = "admin_progress"`. Both functions audit `admin.task.progress` / `admin.task.evidence` with `{ tokenId, tokenName, targetPersonId }` after the row is written.

- [ ] **Step 4: Implement the routes**

`POST /tasks/{id}/progress` and `POST /tasks/{id}/evidence` require `tasks:write`, call `assertAgentRateLimit(..., true)`, require `Idempotency-Key`, and write directly through `withAgentIdempotency({ agent, key, requestHash, handler })`. Evidence is multipart with one `file`, optional `note`, and the key. `GET /evidence/{id}/file` requires `tasks:read`, loads the row by organization, and returns the stored bytes with the stored content type; missing or cross-org answers 404.

- [ ] **Step 5: Run and verify pass**

Run: `node --import tsx --test test/work-os-admin-agent-evidence.test.mts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/work-admin-agent-evidence.ts src/app/api/agent/admin/v1/tasks/[taskId]/progress src/app/api/agent/admin/v1/tasks/[taskId]/evidence src/app/api/agent/admin/v1/evidence test/work-os-admin-agent-evidence.test.mts
git commit -m "feat(work-os): add task-scoped admin progress and evidence"
```

---

### Task 15: Identity and OpenAPI contract

**Files:**
- Create: `src/app/api/agent/admin/v1/me/route.ts`
- Create: `src/app/api/agent/admin/v1/openapi.yaml/route.ts`
- Create: `docs/openapi/work-os-admin-agent-v1.yaml`
- Create: `test/work-os-admin-agent-openapi.test.mts`

**Interfaces:**
- Produces: `GET /me` and the served contract.

- [ ] **Step 1: Write the failing tests**

Mirror `test/work-os-agent-openapi.test.mts`:

```ts
test("the admin OpenAPI document covers every admin v1 route in both directions", async () => {
  const spec = yaml.load(await read("docs/openapi/work-os-admin-agent-v1.yaml")) as Record<string, any>;
  const actual = (await routePaths(fileURLToPath(new URL("../src/app/api/agent/admin/v1", import.meta.url))))
    .map((route) => route.replace(/\[([^\]]+)\]/g, "{$1}")).sort();
  assert.deepEqual(Object.keys(spec.paths).sort(), actual);
  for (const [route, item] of Object.entries(spec.paths as Record<string, Record<string, any>>)) {
    for (const [method, operation] of Object.entries(item)) {
      if (route === "/openapi.yaml") { assert.deepEqual(operation.security, []); continue; }
      assert.deepEqual(operation.security ?? spec.security, [{ bearerAuth: [] }]);
      assert.ok(["none", "people:read", "tasks:read", "tasks:write", "eods:read", "eods:review", "records:read", "insights:read"].includes(operation["x-required-scope"]));
    }
  }
});
```

Add the error enum and `GET /me` assertions.

- [ ] **Step 2: Run and verify failure**

Run: `node --import tsx --test test/work-os-admin-agent-openapi.test.mts`
Expected: FAIL.

- [ ] **Step 3: Write `GET /me`**

Return `{ organization_id, user_id, role, person_id, token: { id, name, prefix, scopes, expires_at } }`. Never return the secret.

- [ ] **Step 4: Write the OpenAPI document**

Cover every route from Tasks 6–14 and 15. Include the `bearerAuth` scheme, `x-required-scope` per operation, `202` preview responses, the error schema codes (`unauthorized`, `token_revoked`, `token_expired`, `forbidden`, `feature_disabled`, `insufficient_scope`, `not_found`, `preview_stale`, `preview_expired`, `preview_in_flight`, `conflict`, `validation_error`, `invalid_cursor`, `rate_limited`, `evidence_required`, `file_too_large`, `unsupported_file_type`, `idempotency_conflict`), and the 8 MB evidence schema.

- [ ] **Step 5: Serve the document**

`src/app/api/agent/admin/v1/openapi.yaml/route.ts` reads `docs/openapi/work-os-admin-agent-v1.yaml` and returns `application/yaml; charset=utf-8` with `cache-control: public, max-age=300`, matching the employee route.

- [ ] **Step 6: Run and verify pass**

Run: `node --import tsx --test test/work-os-admin-agent-openapi.test.mts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/agent/admin/v1/me src/app/api/agent/admin/v1/openapi.yaml docs/openapi/work-os-admin-agent-v1.yaml test/work-os-admin-agent-openapi.test.mts
git commit -m "docs(work-os): publish the admin agent OpenAPI contract"
```

---

### Task 16: Admin MCP server

**Files:**
- Create: `src/lib/work-admin-agent-mcp.ts`
- Create: `test/work-os-admin-agent-mcp.test.mts`

**Interfaces:**
- Produces: `ADMIN_AGENT_MCP_TOOL_NAMES`, `AdminAgentMcpServices`, `createAdminAgentMcpServer()`.
- Consumes: `previewAdminAction`, `applyAdminAction`, `createAdminPreview`, `confirmAdminPreview`, `decodeEvidenceBase64`.

```ts
export type AdminAgentMcpServices = {
  searchPeople: (agent: AdminAgentAccess, input: { query?: string; active?: boolean; teamId?: string; role?: string; limit?: number; cursor?: string }) => Promise<Json>;
  getPerson: (agent: AdminAgentAccess, personId: string) => Promise<Json | null>;
  listTasks: (agent: AdminAgentAccess, input: Json) => Promise<Json>;
  getTask: (agent: AdminAgentAccess, taskId: string) => Promise<Json>;
  listEods: (agent: AdminAgentAccess, input: Json) => Promise<Json>;
  getEod: (agent: AdminAgentAccess, reportId: string) => Promise<Json | null>;
  listRecords: (agent: AdminAgentAccess, input: Json) => Promise<Json>;
  getOverview: (agent: AdminAgentAccess, input: Json) => Promise<Json>;
  getInsights: (agent: AdminAgentAccess, input: Json) => Promise<Json>;
  previewAction: (agent: AdminAgentAccess, action: AdminPreviewAction, payload: Json) => Promise<Json>;
  confirmAction: (agent: AdminAgentAccess, previewId: string, idempotencyKey: string) => Promise<Json>;
  logProgress: (agent: AdminAgentAccess, taskId: string, body: Json, idempotencyKey: string) => Promise<Json>;
  attachEvidence: (agent: AdminAgentAccess, taskId: string, input: { fileName: string; contentType: string; bytes: Uint8Array; note: string }, idempotencyKey: string) => Promise<Json>;
};
export function createAdminAgentMcpServer(agent: AdminAgentAccess, services?: AdminAgentMcpServices, idempotency?: typeof withAgentIdempotency): McpServer;
```

- [ ] **Step 1: Write the failing tests**

Use `InMemoryTransport` like `test/work-os-agent-mcp.test.mts`:

```ts
test("the admin server exposes exactly thirteen tools", async () => {
  const { client, close } = await connect(fakeServices());
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [...ADMIN_AGENT_MCP_TOOL_NAMES].sort());
  assert.equal(tools.tools.length, 13);
  await close();
});

test("a read-only token gets insufficient_scope for preview_action", async () => {
  const { client, close } = await connect(fakeServices(), ["people:read"]);
  const result = await client.callTool({ name: "preview_action", arguments: { action: "task.assign", payload: { task_id: "t1", mode: "add", person_ids: ["p1"] } } });
  assert.equal(result.isError, true);
  assert.match(text(result), /insufficient_scope/);
  await close();
});

test("preview_action never writes; confirm_action executes once", async () => { /* fake preview + confirm counters */ });
test("attach_evidence enforces the 8 MB base64 bound", async () => { /* oversized input is a tool error */ });
```

- [ ] **Step 2: Run and verify failure**

Run: `node --import tsx --test test/work-os-admin-agent-mcp.test.mts`
Expected: FAIL.

- [ ] **Step 3: Implement the server**

`ADMIN_AGENT_MCP_TOOL_NAMES`:

```ts
export const ADMIN_AGENT_MCP_TOOL_NAMES = [
  "search_people", "get_person", "list_tasks", "get_task",
  "list_eods", "get_eod", "list_records", "get_overview", "get_insights",
  "preview_action", "confirm_action", "log_progress", "attach_evidence",
] as const;
```

Each read tool has a strict Zod shape and calls the matching service. `preview_action` uses a discriminated union of the nine actions, computes with `previewAdminAction`, persists with `createAdminPreview`, and returns the preview JSON with its id; it never calls `applyAdminAction`. `confirm_action` takes `{ preview_id, idempotency_key? }` and calls the `confirmAction` service; the default service loads the preview, reads the current state through `defaultAdminAgentActionServices`, and calls `confirmAdminPreview`. The idempotency key defaults to `mcp:confirm:<preview_id>`. `log_progress` and `attach_evidence` are direct writes with `tasks:write`; evidence decodes base64 with `decodeEvidenceBase64`, enforces 8 MB, and calls `attachAdminAgentEvidence`.

- [ ] **Step 4: Run and verify pass**

Run: `node --import tsx --test test/work-os-admin-agent-mcp.test.mts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/work-admin-agent-mcp.ts test/work-os-admin-agent-mcp.test.mts
git commit -m "feat(work-os): add the admin MCP tool server"
```

---

### Task 17: Admin MCP route

**Files:**
- Create: `src/app/api/agent/admin/mcp/route.ts`
- Create: `test/work-os-admin-agent-mcp-route.test.mts`

**Interfaces:**
- Produces: `POST /api/agent/admin/mcp`; rejects `GET`/`DELETE` with 405 and oversize bodies with 413.

- [ ] **Step 1: Write the failing test**

```ts
test("the admin MCP route is POST-only and bounded", async () => {
  const route = await read("src/app/api/agent/admin/mcp/route.ts");
  assert.match(route, /export async function POST/);
  assert.match(route, /export function GET/);
  assert.match(route, /export function DELETE/);
  assert.match(route, /12 \* 1024 \* 1024/);
  assert.match(route, /requireAdminAgentAccess/);
});

test("the proxy matcher excludes the admin MCP body", async () => {
  const proxy = await read("src/proxy.ts");
  assert.match(proxy, /api\/agent\/admin\/mcp/);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `node --import tsx --test test/work-os-admin-agent-mcp-route.test.mts`
Expected: FAIL.

- [ ] **Step 3: Implement the route**

Mirror `src/app/api/mcp/route.ts`: `runtime = "nodejs"`, `dynamic = "force-dynamic"`, `MAX_BODY_BYTES = 12 * 1024 * 1024`, `requireAdminAgentAccess(req)`, `new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })`, `createAdminAgentMcpServer(agent)`, close the server in `finally`. `GET`/`DELETE` return the JSON-RPC 405 shape.

- [ ] **Step 4: Run and verify pass**

Run: `node --import tsx --test test/work-os-admin-agent-mcp-route.test.mts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/agent/admin/mcp/route.ts test/work-os-admin-agent-mcp-route.test.mts
git commit -m "feat(work-os): serve the admin MCP endpoint"
```

---

### Task 18: Live verification and deployment

**Files:**
- Create: `docs/verification/2026-11-02-admin-agent-api.md`

**Interfaces:**
- Consumes every previous task.

- [ ] **Step 1: Wire the new tests into the suite and run the full local checks**

`package.json`'s `work-os:test` script is an explicit file list. Add every new `test/work-os-admin-agent-*.test.mts` file to it before running.

```bash
npm run work-os:typecheck
npm run work-os:test
```

Record the exact pass counts. If a TestSprite fixture exists for the admin settings panel, run the relevant plan; otherwise record that no reusable fixture exists and attach browser screenshots at 1440, 1024, and 390.

- [ ] **Step 2: Apply the additive migration**

Resolve the host first:

```bash
node -e "const u=new URL(process.env.MIGRATION_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||process.env.DATABASE_URL); console.log(u.host)"
npm run db:apply:work-os
```

Record the resolved host (never print credentials). Confirm `work_agent_tokens.kind`, nullable `person_id`, and `work_admin_action_previews` in the target database.

- [ ] **Step 3: Deploy through Agent OS**

```bash
cd /home/dev/agent-os && npm run redeploy
```

Verify the deployed commit identity and a live `/api/agent/admin/v1/openapi.yaml`.

- [ ] **Step 4: Enable the flag and mint a short-lived token**

Enable `admin_agent_api` for the David Yeboah workspace in Admin → Settings → Workspace features. Mint a 15-minute token with read scopes plus `tasks:write` and `eods:review`. Record only the prefix, never the secret.

- [ ] **Step 5: Run the live probes**

```bash
curl -s -H "Authorization: Bearer $TOKEN" https://app.wrazyos.com/api/agent/admin/v1/me
curl -s -H "Authorization: Bearer $TOKEN" 'https://app.wrazyos.com/api/agent/admin/v1/people?q=David'
curl -s -H "Authorization: Bearer $TOKEN" 'https://app.wrazyos.com/api/agent/admin/v1/tasks?person_ids=<david-id>&q='
curl -s -H "Authorization: Bearer $TOKEN" 'https://app.wrazyos.com/api/agent/admin/v1/eods?person_ids=<david-id>&from=<last-week>&to=<today>'
```

Then preview and confirm an assignment on a disposable task, read the audit rows, and revoke the token. Confirm the revoked token answers `401`, and confirm a cross-organization id answers `404`.

- [ ] **Step 6: Run the admin MCP smoke test**

Call `tools/list` against `/api/agent/admin/mcp` with the short-lived token; assert 13 tools. Call `search_people` and `list_tasks`, then `preview_action` for an assignment and verify the preview did not change the task. Confirm it, verify the task changed, and check the audit row.

- [ ] **Step 7: Write the verification report**

Record the commands, actual responses, test counts, screenshots, deployed commit, and any remaining gap. Include the token prefix and revocation timestamp, never the secret. Commit the report.

```bash
git add docs/verification/2026-11-02-admin-agent-api.md
git commit -m "docs(work-os): verify the admin agent API live"
```

---

## Self-Review

- Spec coverage: token kind and scopes (Tasks 1–3), auth (3), kind isolation (4), token UI (5), directory (6), tasks (7), EODs (8), records/overview/insights (9), previews (10–13), progress/evidence (14), OpenAPI (15), MCP (16–17), live verification (18). Admin Otto is explicitly out of scope and deferred to its own plan.
- The five Review Focus items are pinned in Tasks 3/4 (wrong-kind), 2/11/14 (unmapped admin), 10 (stale preview), 6–9 (cross-organization), and 16 (read-only token).
- Interfaces use consistent names: `requireAdminAgentAccess`, `AdminAgentAccess`, `previewAdminAction`, `applyAdminAction`, `createAdminPreview`, `confirmAdminPreview`, `ADMIN_AGENT_MCP_TOOL_NAMES`.
- No step leaves a type or function undefined without a task that creates it.
