# WrazyOS API & MCP Verification Report

**Date:** 2026-09-16
**Target:** https://app.wrazyos.com (agent-os `main`, build after `d747f0f74`)
**Method:** TestSprite frontend page-group tests, TestSprite backend API sweeps,
`hermes mcp` manifest tests + live control/pipeline probes, and scripted agent-run
smokes. Ledger: Nifty `18!eL67I5N`.

---

## 1. Result

| Surface | Coverage | Result |
|---|---|---|
| Pages (browser, authenticated) | 17 page-group tests over ~40 user-facing pages | **pass** (see §3 for two superseded runs) |
| API GET endpoints | 143 of 164 static GETs swept + 8 dynamic routes resolved | **pass after 2 fixes** |
| API auth boundary | bad creds rejected, session signed, 13 protected GETs never 200/500 unauth, raw body token does not authenticate | **pass** |
| API validation | `seo-os/campaigns`, `leads/score` reject invalid input with 4xx | **pass** |
| Unauthenticated sweep | 163 endpoints → 162×307 + 1×401, zero 5xx | **pass** |
| MCP `wrazy-seo` | 53 tools discovered; 4 control tools 200; 3 validation probes reach handlers; 2 pipeline tools 200 with the agent bearer | **pass** |
| MCP `wrazy-notes` | 4 tools discovered; handler validation probe reaches the route | **pass** |
| Agent runs | codex, antigravity, hermes returned `ok` end-to-end | **3/7** (4 blocked by environment, §4) |

## 2. Fixes shipped during the audit

1. **Neon query shim: bare embeds leaked into SQL** (`src/lib/db/query.ts`, `src/lib/query.ts`)
   Select specs like `knowledge_library_files(id,filename,…)` and
   `social_posts(*, social_media_assets(…), …)` are PostgREST bare embeds, but the
   parser only matched aliased embeds (`alias:table(…)`), so the raw string was
   interpolated into SQL. Fixed: optional alias, embed alias defaults to the table
   name. Fixed `/api/knowledge/libraries` (500 `column "filename" does not exist`)
   and `/api/video/distribution` (500 `syntax error at or near ","`).
   Commits: agent-os `d747f0f74`, work-os `1679a8c3`.
2. **Outreach console always showed a load-failed banner** (`src/components/OutreachView.tsx`)
   `GET /api/outreach` returns a flat `{leads,campaigns,…}` payload, but the client
   only accepted `{ok}`/`{state}` shapes. Fixed. Commit: agent-os `278b46041`.
3. **Ops: `fcc-server` was not running** (Free Claude Code on `:8082`). Started it;
   the freeclaude pipeline now completes (upstream provider auth is a separate gap, §4).

## 3. TestSprite evidence (project: Work OS Companion `e8fa6d35`, WrazyOS API `c76fc011`)

Backend sweeps (project `c76fc011`, all **passed**):
`g1-workos 3b25f62b`, `g2-seo-os 1636cc08`, `g3-seo ef5f5503` (v5),
`g4-agents 8c5fa8f7`, `g5-knowledge 1e4052c9` (v5), `g6-ops f5ce8fc4`,
`g7-dynamic 8b3bbcce`, `g8-auth 32034a3e`, `g9-validation aaeeddff`.

Frontend page groups (project `e8fa6d35`, all **passed**):
public pages `97f2a59f`, agents A `8447bdd9`, agents B `caf22340`,
Work OS tabs `7fbb63a2`, SEO OS core `941bd492`, SEO OS ops `4d905d77`,
legacy SEO `91f303b1`, admin `17c95174`, Kanban `af381e7b`, notebook `f98c9be9`,
memory `e16cfbf2`, downloads `baf9c093`, Studio `1faf3c0f`,
desktop connect v2 `0bc0eaea`, leads/outreach v2 `92fda58e`.

Superseded runs (kept as history, not defects):
- `c0065ebc` combined ops-tools sweep **blocked on browser memory**; the same five
  pages pass individually (see §5).
- `0e1179c0` desktop connect v1 — expected a connection step; the page correctly
  rejects an authorization request with no `challenge`/`state`/`redirect_uri`
  (by design; v2 asserts both states plus Worktivity).
- `1914aa65`/`92fda58e` v1 leads/outreach — failed on the banner bug, fixed in §2.2.

MCP evidence: `hermes mcp test wrazy-seo` → 53 tools, 1035 ms; `wrazy-notes` → 4
tools, 888 ms. Live probes: `seo_get_operating_contract`/`seo_get_system_state`/
`seo_list_clients`/`seo_get_client_context` 200; `seo_create_client` →
`idempotency_key is required.`; `seo_create_ctr_test`/`seo_save_schedule` →
`client_id is required.`; pipeline `GET /api/seo/local/agent` and
`GET /api/seo/history` 200 with the agent bearer; `POST /api/seo/wordpress {}` →
400 `sessionId or filePaths required`; notes handler → 400 `turn_id is required.`
Build staleness gate: sources older than `.next/BUILD_ID`.

Agent smokes (jobs/run_events verified in Postgres):
`codex` ok, `antigravity` ok, `hermes` ok (all returned exactly `ok`);
`claude` failed `Credit balance is too low`; `gemini`/`openclaw` binaries not
installed; `fcc` pipeline completes and streams, then the upstream provider
returns HTTP 401.

## 4. Environment gaps (not code regressions)

- **Claude**: Anthropic credit balance exhausted — top up the account used by the
  `claude` CLI on the VPS.
- **Gemini / OpenClaw**: CLIs not installed on the VPS
  (`Set AGENTIC_OS_GEMINI_BIN`/`AGENTIC_OS_OPENCLAW_BIN` or install them).
- **Free Claude Code**: `fcc-server` now runs, but the OpenRouter key returns 401
  (invalid/expired) — rotate `OPENROUTER_API_KEY`.
- **NotebookLM**: personal `/api/notebooks` returns 422 (no `nlm login` /
  `NOTEBOOKLM_COOKIES`); the shared bridge is disabled by design
  (`AGENTIC_OS_ENABLE_LEGACY_NOTEBOOKLM`), though it answers 500 rather than a 4xx.

## 5. Observations

- **Kanban payload**: `GET /api/agent-tasks` returns ~1.3 MB unpaginated; the
  combined ops-tools browser sweep exceeded the test runner's memory cap while the
  same pages pass individually. Recommend pagination/virtualization.
- **By-design responses** (verified in source, asserted in tests):
  `/api/seo/growth` 403 when `seo_mission_control` is off for the org;
  `/api/seo/quality` 404 `status:"gone"` without a runId;
  `/api/seo/local/{file,sheet}` 403 path guards.
- Mid-audit 500s on `/leads` + `/outreach` were a concurrent session's atomic
  redeploy swap window; both render 200 on the settled build.

## 6. Excluded / not exercised

- 21 side-effecting GETs (agent spawn/chat/run, SEO research/generate/publish/
  deploy, OAuth starts/callbacks, outreach sends, video generation, media streams)
  — route presence verified via reject-only probes where safe, otherwise excluded.
- Mutating endpoints beyond validation probes (no real data created; audit was
  read-only by operator decision).
- The desktop Tauri companion (not browser-testable; covered by its own suite and
  preview fixtures).

## 7. Re-running

Backend tests require a project credential on `WrazyOS API`: provision a temp
admin account, set it with `testsprite project credential <id> --type "API key"
--credential-file <pw>`, then run the `Prod audit` tests. The credential and the
temp account were deleted at the end of this audit.

## 8. Local SEO client workspace recovery (2026-09-16, evening)

**Symptom:** every client-scoped SEO OS skill failed immediately with
`Attempt N could not start: The selected Local SEO client could not be resolved safely.`

**Root cause:** client resolution reads `~/agent-os/local-seo/clients/<slug>/client.md`
(gitignored local data). The VPS had **zero `client.md` files** (one tracked
`campaigns/` folder only); the nine curated workspaces live on the operator's dev
box and never synced. Client-less runs were unaffected, which is why only
client-scoped skills broke.

**Fix (data + code, commit `cbb2ef4ea`):**
- Restored nine client workspaces on the VPS (client.md, brand-voice*, client-knowledge/**,
  AGENTS.md, approval/analytics/boundary policies, client-config.json, citations) with a
  per-file copy (no bulk sync); scaffolded `deploy-system` from its control-plane record
  with the canonical `createLocalSeoClient` writer. Snapshot taken first
  (`/home/dev/local-seo-clients-backup-20260916T172618Z.tgz`).
- Hardening: the SEO OS executor now materializes a missing workspace from the DB client and
  retries once; the resolver's 400 lists available clients; new readiness check
  `scripts/check-local-seo-workspaces.mts`.

**Verified:**
- `POST /api/seo/local/agent` (`citations` + `acme-plumbing`) → 200 start, cancel 200.
- `POST /api/seo/local/team` (`team` + `acme-plumbing`) → 200 start with resolved client name, cancel 200.
- SEO OS executor `POST /api/seo-os/local/run` (client_id) → 201 task, `run_started` event, no `could not be started`.
- `test/local-seo-client-resolver.test.mts` 8/8; full suite 105/105; typecheck clean;
  readiness check: all 10 clients resolve.

**Residual:** `seo_clients` has duplicate rows (2 per client, 20 total) — cleanup candidate.
`deploy-system` materializes as folder `deploy-monitor` and resolves via scored identity.
