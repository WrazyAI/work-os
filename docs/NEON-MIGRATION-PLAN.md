# Agent-OS → Neon Migration Plan

> Canonical reference for migrating the Work OS platform (web + agent-runner) off
> cloud Supabase onto **Neon (Lakebase Postgres + Neon Auth) + Cloudflare R2**.
> Status of this plan is tracked in Nifty task `EdMKZaixcR` (project `czFZk9928z`).

---

## 1. Why we're migrating

- The Supabase project **Agent-OS** (`qdobqxyryntjescedjpf`, org "platoya's Org",
  `aaqraucppcrappmnpatt`, eu-west-3) hit the free-plan **egress quota**
  (`exceed_egress_quota`, HTTP 402 on Auth/REST/Storage/Realtime). Estimated
  reset ~**Sep 17, 2026** (project created 2026-06-17 14:46 UTC).
- The gate is on the **HTTP API layer only** — direct Postgres (5432) is reachable.
- Decision (2026-08-28): move to **Neon + Better Auth (via Neon Auth) + R2**
  rather than pay Supabase Pro or re-trap data in the same pricing model.

## 2. Source inventory (what we're protecting)

| Artifact | Location | Notes |
|---|---|---|
| **Full logical DB dump** (131 tables: `public`, `auth`, `storage`, + schema DDL + sequences) | VPS `/home/dev/backups/agent-os-full-2026-08-28/` **and** local `~/backups/agent-os-full-2026-08-28/` | JSON per table + `schema.sql` + `manifest.json`. 46 MB. 0 failures. |
| Working **DB password** | VPS `~/agent-os/.env.local` (`SUPABASE_DB_PASSWORD`) | Reset via Management API `PATCH /v1/projects/{ref}/database/password`. `db:apply` works against the old DB again. |
| Management API token (platoya org) | VPS `~/agent-os/.env.local` (`SUPABASE_ACCESS_TOKEN`) | Read + password-reset scope confirmed. |
| Supabase keys (anon / service role) | VPS + local `.env.local` | Still valid but 402-gated. |
| **Storage file bytes** | ⚠️ **NOT in the dump** — only `storage.objects` metadata | Bucket contents (uploads, screenshots) are 402-gated. Mitigation: the runner already synced uploads to VPS disk (`downloads/`), and daily-log screenshots exist in `downloads/screenshots/`. **Open item:** verify coverage of the private `uploads` bucket vs. disk copies; do not delete anything. |
| Old backups (partial, superseded) | VPS `~/backups/`, `~/agent-os-backups/` | Historical only. |

**App auth users** (from `auth.users`): `lsperry267@gmail.com` (owner, first
user), `david@maigreeks.com`, `info@wrazyos.com`, `zahemen990@gmail.com`,
`zahemen9900@gmail.com`, `screenshot-test@wrazyos.com` (test),
`work-os-acceptance-983b9ee0@maigreeks.com` (test).

## 3. Target architecture

| Concern | Today (Supabase) | Target |
|---|---|---|
| Postgres | Supabase `qdobqxyryntjescedjpf` | **Neon** project **`work-os-eu`** (`green-flower-94209116`), org **David's Org** (`org-little-moon-08068665`), region `aws-eu-central-1` (Frankfurt, near the France VPS), PG 18, branch `main` *(supersedes the earlier us-east-2 `little-recipe-88997696` — moved for latency; both restored identically)* |
| Auth | Supabase Auth (GoTrue), `@supabase/ssr` cookie sessions | **Neon Auth** (managed Better Auth), users/sessions in our own Postgres |
| Authorization | App-level `organization_id` filters (service-role everywhere; RLS bypassed by design) | Same app-level model — no RLS dependency. Simplest part of the swap |
| Realtime (job bridge + `useRunStream`) | Supabase Realtime `postgres_changes` | PG **`LISTEN/NOTIFY`** (works on Neon) or polling on the runner; SSE from the web server for run streams |
| Storage | Supabase Storage (TUS resumable uploads, private `uploads` + public `screenshots` buckets) | **Cloudflare R2**, presigned multipart direct-from-browser; zero egress fees |
| Desktop companion auth | Custom device-flow against web API | Unchanged — provider-agnostic by design |

**Neon topology:** main branch for prod; short-lived branches for dev/preview
(replaces the PGlite dry-run harness for schema verification). Server runs on
the VPS as a long-lived process → standard `pg` driver over the **pooled**
connection string; enable compute scale-to-zero only if acceptable for cold
starts (default: keep a small always-on compute).

## 4. Phases

### Phase 0 — Preflight ✅ DONE (2026-08-28)
- [x] DB password reset via Management API; direct connection verified (PG 17.6, aarch64).
- [x] Full logical dump (131 tables, 0 failures) on VPS + local.
- [x] Dump copied off-box.
- [x] Owner account confirmed: `lsperry267@gmail.com`.

### Phase 1 — Neon setup (no code changes yet) ✅ DONE (2026-08-28)
- [x] Install Neon agent skills (`neon`, `neon-postgres`) via skills CLI — installed
      in `.agents/skills/`, symlinked for Claude Code **and** OpenCode (`.opencode/skills/`).
- [x] Neon CLI v4.11 installed; MCP server configured globally for OpenCode.
- [x] Workspace linked to `org-little-moon-08068665` / `little-recipe-88997696`
      (`.neon` file; API key `NEON_API_KEY` in `.env.local`). *(Original target
      `calm-field-26787110` in org `Wrazy` replaced — that org belongs to a
      different Neon account.)*
- [x] Branch env pulled: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`,
      `NEON_AUTH_BASE_URL`, `NEON_AUTH_JWKS_URL` in local `.env`.
- [x] `neon.ts` committed: `auth: true` (+ `dataApi` not needed — app queries DB directly).
- [x] Auth service provisioned on `production` branch (`neon deploy`): `neon_auth`
      schema live, 0 users. Direct connection verified (PostgreSQL 18.6).
- [x] Domains registered: `https://app.wrazyos.com` trusted; localhost allowed.

### Phase 2 — Schema + data restore ✅ DONE (2026-08-28)
- [x] `public` schema rebuilt on the Neon `production` branch from the live-DB
      dump + `pg_catalog` extras (enums, 20 functions, triggers, 100+ indexes,
      199 FKs — 91 Supabase `auth.*`/`storage.*` FK refs intentionally skipped).
- [x] Compat shim: `auth` schema + `auth.uid()` stub so SECURITY DEFINER RLS
      helper functions compile (they are unused by the new architecture).
- [x] pgvector: `CREATE EXTENSION vector`; `note_embedding_chunks.embedding`
      bound as `vector(1024)` (from source `atttypmod`); HNSW index rebuilt.
- [x] Data imported: **101 tables, 58,840 rows, verified 0 mismatches** vs
      `manifest.json`. JSONB string-scalar fidelity handled by pre-serialization.
- [x] Identity columns converted (`run_events`, `work_audit_log`,
      `seo_approval_events`, `task_comments`, `task_events`, `task_runs`) with
      sequence positions restored (next ids 4377/166/127/…).
- [x] Users carried into `neon_auth` (Better Auth): 7 users + 7 credential
      accounts, **bcrypt hashes preserved** so existing passwords keep working.
      User IDs = original Supabase UUIDs (all FK references intact).
- Restore script: `/tmp/opencode/restore-to-neon.mjs` (idempotent full-rebuild:
  drops+recreates `public` schema each run).

### Phase 3 — Code migration ✅ DONE for the work-os repo (PR #55, 2026-08-28)
Branch `codex/neon-migration` → PR https://github.com/zahemen9900/work-os/pull/55 (CI green).
1. **Data layer** ✅ — `@supabase/supabase-js` replaced by a PostgREST-compatible
   `pg` shim (`src/lib/db/query.ts` + `pool.ts`) behind `createAdminClient()` —
   all 42 call sites / 26 files unchanged: eq/in/not/or/contains/is/ilike/match,
   upsert+onConflict, insert/update/delete RETURNING, to-one + to-many embeds
   (FK-resolved via pg_catalog), rpc (named args), head-counts, PGRST116
   single() semantics, jsonb pre-serialization (arrays/objects/strings).
2. **Auth** ✅ — Better Auth (kysely adapter, `neon_auth` schema, uuid ids via
   `advanced.database.generateId`), bcrypt verify (legacy `$2a$` hashes),
   invite-only (`disableSignUp`), `/login` page + root layout,
   `/api/auth/[...all]` handler. `requireUserProfile`/`requireUser` preserved.
   Requires `BETTER_AUTH_SECRET` env. NOTE: `neon_auth.account.issuer` column
   (`'local:credential'`) is required by Better Auth 1.7 — added post-restore
   and included in `restore-to-neon.mjs`.
3. **Storage** ✅ — `src/lib/db/storage.ts` driver interface (R2 S3 driver /
   local FS driver, `OBJECT_STORAGE_DRIVER` + `R2_*` env); screenshots module
   ported. **R2 credentials still needed for prod.**
4. **Realtime** — nothing to port in this repo (runner + TUS live in agent-os).
5. **Desktop companion** ✅ — zero code changes (verified provider-agnostic).

Verification: typecheck 0 errors · lint 0 errors · 64/64 tests · next build
green · live smoke vs Neon: sign-in (legacy bcrypt) 200, `/session` `/me/day`
`/me/workday` `/me/tasks` all 200 with real data.

**Remaining Phase-3 workstream: agent-os repo** (deployed platform: login
surface, agent-runner, Realtime bridge → LISTEN/NOTIFY, TUS uploads, SEO
surfaces).

### Phase 4 — Deploy + cutover
- [ ] VPS: add Neon/R2 env vars to `~/agent-os/.env.local`; keep Supabase vars
      commented until decommission.
- [ ] `npm run redeploy` + `systemctl --user restart agentos-runner`.
- [ ] Cutover checklist: login (old password!), dashboard load, job enqueue →
      runner claim → streamed output, file upload (small + large), screenshots,
      EOD flow, SEO agent surfaces.
- [ ] Domain `app.wrazyos.com` unchanged (still VPS-hosted — only backend
      providers swap).

### Phase 5 — Decommission + rollback
- **Rollback:** Supabase project stays intact (no deletion); reverting =
  redeploy previous env vars while dump still restores cleanly.
- **Decommission (only after 1–2 stable weeks):** remove Supabase env vars,
  revoke platoya PAT, keep final dump archived. Storage-file gap (§2) must be
  resolved before any Supabase teardown.

## 5. Open items / dependencies
- [ ] **Neon auth for CLI/MCP** — needs `neon auth` browser login or a
      `NEON_API_KEY` from the account that owns org `Wrazy`.
- [ ] **Cloudflare R2** — account + API token + bucket naming convention.
- [ ] **Storage byte coverage check** — reconcile private `uploads` bucket
      contents vs. VPS disk copies before decommission.
- [ ] Confirm acceptable Neon compute mode (always-on vs. scale-to-zero cold starts).
- [ ] bcrypt password carry-over confirmation after first login test.

## 6. Verification commands

```bash
# Dump verification (local)
ls ~/backups/agent-os-full-2026-08-28 | wc -l   # expect 134 files
node -e "console.log(JSON.parse(require('fs').readFileSync('$HOME/backups/agent-os-full-2026-08-28/manifest.json')).tables.length)"  # expect 131

# Neon link state
cat .neon
neon status
neon env pull --file .env.local
```
