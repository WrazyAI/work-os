<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# WrazyAI web platform — operations runbook

## Task Synchronization

Before starting each new task or agenda, sync the working branch with the latest
`main` and resolve any conflicts before editing. When the task is verified,
merge its completed work into `main` before starting another task or agenda.
Do not carry unmerged completed work into unrelated follow-up work.

### Worktree isolation — hard requirement

Every agent **must** make its changes in a dedicated git worktree branched from
the latest `main`. Never edit a shared checkout
(`/home/maigreeks/projects/work-os`, `/home/maigreeks/projects/agent-os-main`,
or another agent's worktree) — parallel agents editing one checkout is what
swept files into unrelated commits and raced builds. Shared checkouts are for
merges, convergence, and deploys only, and must never hold uncommitted work.

1. Create the worktree before the first edit:
   ```bash
   git fetch origin
   git worktree add /home/maigreeks/projects/.worktrees/<task-slug> -b codex/<task-slug> origin/main
   ```
2. Link dependencies from an existing worktree instead of installing
   (`npm install` while a server runs corrupts the Turbopack cache):
   ```bash
   ln -s /home/maigreeks/projects/.worktrees/<existing>/node_modules \
         /home/maigreeks/projects/.worktrees/<task-slug>/node_modules
   ```
3. Do all edits, tests, and commits in the worktree.
4. Rebase on the latest `main` immediately before pushing; push the verified
   work into `main` (`git push origin HEAD:main`) and converge shared files into
   the other repository per the cross-repo rules.
5. Deploy only after the merge, following the deploy section.
6. Remove the worktree once its work is merged
   (`git worktree remove /home/maigreeks/projects/.worktrees/<task-slug>`), or
   keep it only while follow-up work is actively in flight.

**Read the changelog when reconciling.** A rebase or merge can bring in work
other agents landed before yours. Read `desktop/work-os-companion/CHANGELOG.md`
(or the latest GitHub release notes when a checkout does not carry it) for what
changed and why, and skim `git log origin/main` for anything the entries do not
cover. Reconcile unfamiliar files with that context instead of guessing, and
call out any interaction with a recent change in the handoff. Add a changelog
entry when the change is release-facing.

The active Work OS check-in cadence defaults to sixty minutes (the first
follow-up lands 75 minutes after plan confirmation or clock-in). Set
`WORK_OS_CHECK_IN_INTERVAL_MINUTES` to an integer from `15` through `240` to
override it for a deployment; invalid values fall back to sixty minutes.

Activity Interval Reviews build the evidence-backed recap for each due check-in
from Worktivity frames. Their bounds are `WORK_OS_ACTIVITY_INTERVALS_ENABLED`
(default on), `WORK_OS_ACTIVITY_INTERVAL_MAX_MINUTES` (120),
`WORK_OS_ACTIVITY_INTERVAL_MAX_FRAMES` (12),
`WORK_OS_ACTIVITY_INTERVAL_MAX_RAW_FRAMES` (5), and
`WORK_OS_ACTIVITY_INTERVAL_MAX_PER_DAY` (10). AI inference never creates a
`work_check_ins` row and never advances `last_substantive_update_at`.

This dashboard is a **multi-user web platform**, not a localhost-only app. Full
architecture in `WEB-PLATFORM-SPEC.md`; current status in `IMPLEMENTATION-STATUS.md`.

## Mandatory Work OS design blueprint

Before designing, implementing, reviewing, or modifying any Work OS interface,
read `design.md` completely and use it as the canonical product-design blueprint.
It governs both the desktop companion and web platform, including employee,
manager, administrator, onboarding, review, evidence, and settings surfaces.

The latest polished desktop Today, Tasks, shared composer, task-detail, and
contextual-menu patterns are the current visual and interaction authority. The
web experience must converge on their hierarchy, tokens, component behavior,
responsive rules, provenance language, and state handling. Older adjacent screens
are implementation history and must not be copied when they conflict with
`design.md`.

For every UI change:

- Identify and follow the applicable blueprint, component contract, responsive
  matrix, operational state matrix, and accessibility requirements in `design.md`.
- Reuse established semantic tokens and patterns before creating new ones.
- Preserve task-first hierarchy, progressive disclosure, concise copy, semantic
  status color, detached contextual surfaces, and truthful data provenance.
- Validate representative wide desktop, compact/narrow, loading, empty, dense,
  degraded/error, keyboard, focus, overlay-collision, and reduced-motion states.
- Review rendered screenshots and exercise the relevant controls. A successful
  build or static assertion is not visual or interaction acceptance.
- Document any intentional deviation. If a new pattern becomes reusable, update
  `design.md` with its rationale and full contract in the same change.

Do not declare a UI task complete without reporting what was actually rendered
and exercised, what state coverage was verified, and anything that remains open.

## Architecture (two halves)
- **Cloud control plane** — Supabase: Auth + Postgres (with RLS for per-user
  isolation) + Realtime. Project **"Agent-OS"** (`qdobqxyryntjescedjpf`, eu-west-3).
- **Local execution engine** — the **agent-runner** on this box (`srv1726015`)
  spawns the agent CLIs and streams output back via Supabase Realtime. Agents can
  **never** move to the cloud (they need local binaries/keychain/vault).
- The Next.js app runs in **production on this box** (`next start`), **not Vercel** —
  57/127 API routes are local-only (spawn/fs/sqlite) and would 500 on serverless.

Request flow (the "bridge"): cloud route builds argv (`src/lib/agentArgs.ts`) →
`enqueueJob` inserts a `jobs` row → the runner claims it via Realtime, resolves
cwd/env/mode (`src/lib/agentRuntime.ts`), executes, streams stdout into
`run_events` → the browser subscribes via `useRunStream`. Three runner modes:
streaming-spawn (claude/codex/gemini/fcc), single-shot (openclaw/antigravity),
HTTP-relay (hermes).

## Mandatory work ledger and project map

For any user-requested investigation, implementation, deployment, integration,
or external side effect, create or reuse a Nifty task **before doing the work**.
Read the target project's current tasks first, reuse an equivalent active task,
and use `scripts/log-nifty-tasks.mjs` as the canonical creator. If Nifty access
is unavailable, stop before making changes and report the exact access blocker;
do not silently do untracked work. Mark the task complete only after the stated
outcome and its verification are complete. Leave it open with a concise blocker
when the outcome is incomplete.

The Nifty project IDs are deliberately different:

- **Tasks** (`czFZk9928z`) is the progress ledger. Implementation and debugging
  work belongs here.
- **EOD Report** (`Dyo7QY7XNR`) is a project, not a task. Each daily report is a
  normal task inside that project, named `<Full Name><MM/DD/YYYY>`.

The authoritative VPS checkout and Nifty task logger are reached through this
SSH command. Use it for ledger reads, task creation, and release operations:

```bash
ssh -i /home/zahemen/.ssh/google_compute_engine dev@72.62.5.190
```

The remote Agent OS checkout is `/home/dev/agent-os`; the canonical task logger
is `/home/dev/agent-os/scripts/log-nifty-tasks.mjs`.

Never search for an “EOD Report task” in the Tasks project. A draft is a
read-only response: do not create or update an EOD task until the operator has
reviewed and explicitly approved the final name and description.

For every task handoff, include what was actually verified, what remains open,
and the exact external dependency when a provider, credential, permission, or
deployment is missing. Do not convert a successful subprocess exit into a
claim that the user-visible workflow completed.

## Verification and review cadence

Quality gates are mandatory; their cadence is batched so tool latency does not
dominate a small change.

- **One CodeRabbit pass per task batch, not per commit.** The free CLI tier
  allows three reviews per window. Run `coderabbit review --agent
  --base-commit <batch base>` once the batch is complete, fix every still-valid
  finding, and re-run only when a fix materially changes the reviewed surface.
  Batch the fixes into one commit and one redeploy.
- **TestSprite is required for UI-affecting changes**, and only when a fixture
  exists or is needed anyway; reuse fixtures across runs instead of rebuilding
  them. Its backend harness validates code without executing it — treat a
  backend "pass" as lint and execute the same test directly (or drive the
  API/DB) before reporting a verdict.
- **The floating companion has a token-free DEV fixture** for the avatar chat:
  `?window=avatar&avatar-fixture=recorded-completion` renders a persisted
  display turn plus a recorded completion (one action summary, no empty card)
  without a desktop session. Use it for TestSprite or browser checks on the
  avatar surface instead of minting live tokens; the live `?window=avatar&token=`
  path stays the end-to-end option when real API behavior matters.
- **Live probes are the primary evidence for provider, runner, and
  state-machine behavior.** Reviews cannot see runtime truth (a provider
  ignoring date filters, a stale build racing a deploy, a Date-vs-string read).
  Verify against the running system: read-only queries first, then the smallest
  write that proves the path.
- **Reviews earn their cost on security, tenant isolation, data correctness and
  attribution, and state transitions.** They add little on copy, labels, and
  formatting; spend the passes accordingly.
- Report tool latency (rate-limit waits, build time) separately from
  engineering time in the handoff.

## TestSprite CLI (installed location)

The TestSprite CLI is installed on this box at
`/home/zahemen/.nvm/versions/node/v24.20.0/bin/testsprite` — it is **not
missing**. A bare `command not found` is a PATH problem, not an install
problem (its shebang needs Node). Invoke it with that toolchain on PATH:

```bash
PATH=/home/zahemen/.nvm/versions/node/v24.20.0/bin:$PATH \
  /home/zahemen/.nvm/versions/node/v24.20.0/bin/testsprite auth status
```

Auth is already configured (operator workspace "David Zahemen's workspace");
never re-run `testsprite setup`. If `auth status` itself fails, stop and tell
the operator.

Projects: **Work OS Companion** `e8fa6d35-586c-47a7-a69c-13e6b8552a0b`
(frontend, → https://app.wrazyos.com); **Work OS Web API**
`e35f94fb-0e9d-42f5-8eba-a5a5e13683b7` (backend, → https://srv1726015.tailbf7608.ts.net);
**WrazyOS API** `c76fc011-4043-4f03-9e1a-7d0fbc50a64a` (backend, → https://app.wrazyos.com).
Frontend runs use the project's configured environment URL (V3 routing ignores
`--target-url`); use `--local <port>` for a localhost-only frontend. Existing
frontend plans log in with the `e2e-verify@wrazyos.com` fixture — if that
sign-in fails with `Invalid email or password`, ask the operator for the
current fixture password instead of declaring the app broken. Backend tests
need a project credential and at least one literal `assert` in the Python; run
the script directly as well before reporting the verdict.

## Running services (systemd --user)
Both live in `~/.config/systemd/user/`, auto-restart, `Linger=yes` (start on boot):
- **`agentos-web`** — `next start` on :3000 (UI + all API routes).
- **`agentos-runner`** — `npm run runner` (claims + executes agent jobs).

`systemctl --user` needs the runtime dir exported in a non-login shell:
```bash
export XDG_RUNTIME_DIR=/run/user/$(id -u)
systemctl --user status agentos-web agentos-runner
systemctl --user restart agentos-web        # or agentos-runner
journalctl --user -u agentos-web -f          # live web logs
journalctl --user -u agentos-runner -f       # live runner logs
```

## Deploying code changes — ALWAYS use redeploy
```bash
npm run redeploy        # = next build, THEN restart agentos-web (atomic; scripts/redeploy.sh)
```
**Never run `npm run build` alone while `agentos-web` is running.** The live server
holds the previous build in memory; a fresh build renames chunk files, so the
running server serves HTML referencing chunks that no longer exist → **CSS/JS 500s**.
Symptom: page loads as unstyled HTML, `/claude` etc. throw "This page couldn't
load." Fix if it happens: `systemctl --user restart agentos-web`.

After changing **runner** code (anything it imports), restart it too:
`systemctl --user restart agentos-runner`.

After changing the **Hermes SEO agent surface** — especially
`scripts/seo-mcp-server.mjs`, `config/hermes/SOUL.md`, or the tools exposed by
`src/lib/seoAgentControl.ts` — a web redeploy is not enough. The long-running
Hermes gateway caches the MCP tool schemas it discovered at startup. Synchronize
the prompt and restart the gateway:

```bash
bash scripts/install-hermes-seo-prompt.sh
export XDG_RUNTIME_DIR=/run/user/$(id -u)
systemctl --user restart hermes-gateway
hermes mcp test wrazy-seo
```

Verify the expected tool appears in the `mcp test` output and that both
`hermes-gateway` and its `seo-mcp-server.mjs` child have new start times. If a
gateway restart remains in `deactivating` because an agent subprocess ignored
SIGTERM, inspect the active work before forcing termination; a forced restart
ends that in-flight agent turn.

MCP discovery verifies only the adapter manifest. When adding a new tool, also
probe the live control API or invoke the tool with deliberately incomplete,
non-mutating input. It must reach the new handler and return that handler's
validation error (for example, `idempotency_key is required` for
`seo_create_client`), not `Unknown SEO agent tool`. This catches a stale web
bundle that advertises a newer MCP manifest while still running an older backend
dispatcher. Confirm the active `.next/BUILD_ID` was produced after the relevant
source change before reporting the tool as live.

### Companion releases

Cutting a companion release (bumping `package.json`,
`src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`) has one more hard
requirement: `desktop/work-os-companion/CHANGELOG.md` must gain a
`## <version>` section for the release, moved out of `## Unreleased`. CI
fails the release without it, and the GitHub release notes are built from
that section. Write every entry for the employee who just installed the
update — one short, plain bullet per change, details only for complex
changes — because the first launch after an update shows it in a changelog
modal (design §19.8).

## Public access (Tailscale Funnel)
- Public URL: **https://srv1726015.tailbf7608.ts.net** → proxies to `127.0.0.1:3000`.
- `tailscale funnel status` · turn **off**: `tailscale funnel --https=443 off` ·
  turn **on**: `tailscale funnel --bg 3000` (operator=dev already set, so no sudo).
- Only the Supabase login gates public access — keep the owner password strong.

## Supabase operations
- Keys in `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`, `..._ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_PASSWORD`). The runner self-loads `.env`/`.env.local`.
- Apply schema (direct Postgres): `npm run db:apply`. The runtime Postgres is
  Neon, so the script resolves `DATABASE_URL_UNPOOLED`/`DATABASE_URL` first and
  prints the target host; `MIGRATION_DATABASE_URL` deliberately overrides it to
  reach the legacy Supabase project.
- On an established database, apply a new additive migration explicitly so
  historical non-replay-safe migrations are not rerun:
  `npm run db:apply -- 0021_example.sql`. The runner validates the filename
  against `supabase/migrations/` and still wraps it in a transaction.
- Validate migration without a live DB (PGlite dry-run): `npm run db:verify`
- Provision a user (invite-only, no public signup):
  `node scripts/create-user.mjs owner|member <email> <password> <displayName>`
- Migrate local vault data into Postgres: `npm run migrate:data <ownerUserId>`
- Owner: `lsperry267@gmail.com`.

## Critical code rules (do not regress)
- **Always use the WSL Node.js toolchain by absolute path for compilation, tests,
  installs, and packaging.** Use
  `/home/zahemen/.nvm/versions/node/v22.20.0/bin/node` and
  `/home/zahemen/.nvm/versions/node/v22.20.0/bin/npm`; never use `node.exe`,
  `npm.cmd`, Windows Node/npm, or a PATH resolution into `/mnt/c`. For commands
  whose child scripts invoke `node`, prefix PATH explicitly, for example:
  `PATH=/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH /home/zahemen/.nvm/versions/node/v22.20.0/bin/npm run build`.
  For the live web platform, retain the deployment rule below and use the same
  absolute npm path with `run redeploy` instead of running `build` alone.
- **Auth proxy** (`src/proxy.ts` + `src/lib/supabase/proxy.ts`) must use local
  `getSession()`, **never** network `getUser()` — `getUser()` blocks every request
  on a network round-trip and hangs the entire app. Authoritative `getUser()` lives
  only in `requireUser()` on protected routes.
- **The agent mascot is configured once.** Its identity and art live in
  `desktop/work-os-companion/src/mascot.ts` (`MASCOT`: name, poses, `Mark`,
  assets). Render it through `src/chat/MascotMark.tsx` wherever the agent is
  speaking — chat turns, the composer welcome, the thinking trace — and never
  hardcode mascot art, its name, or a `Sparkles` icon as the agent's identity
  (feature icons such as Insights synthesis or onboarding suggestions are not
  agent identity). In chat, render the configured head crop (`MASCOT.chatCrop`)
  in the 28px badge; the badge owns the art's geometry so legacy `.otto` sizing
  can never spill it over the text. A global mascot change must only touch
  `mascot.ts`; the companion chat surfaces read the config.
  `test/work-os-companion-mascot.test.mts` fails the build on drift.
- **Companion Tauri commands need an ACL grant per window.** Registering a command
  in `src-tauri/src/lib.rs` is not enough: the window that invokes it must be
  granted the command through `src-tauri/permissions/*.toml` (the shared
  `diagnostics.ts` module is imported by the main, avatar, and debug windows, so
  window-specific commands belong in a window-specific module). Drift surfaces at
  runtime as `Command <name> not allowed by ACL` — it silently broke the updater's
  exit watchdog from 0.3.0 through 0.3.05. `test/work-os-companion-acl.test.mts`
  fails the build on any new drift.
- **Never `npm install` while the dev/prod server is running** — it corrupts the
  Turbopack cache (`adapterFn is not a function` / missing `@swc/helpers`). Fix:
  `rm -rf .next` then rebuild/restart.
- Data is per-user via Postgres **RLS**; the runner uses the service-role key
  (bypasses RLS) and must stay on this box only.
- **Uploads go direct to Supabase Storage, then the runner syncs to disk.** The
  AttachModal uploads files resumably (TUS, `src/lib/uploadToStorage.ts`) straight
  to the private `uploads` bucket — bypassing Cloudflare's 100MB request-body cap
  and surviving flaky connections. The browser then inserts an `upload_jobs` row;
  the agent-runner streams the object down to `downloads/` (constant memory),
  deletes it from Storage, and flips the row to `ready` with `local_path`. The
  client polls until ready, then attaches the local path. **Free-plan caveat:**
  Supabase free caps files at 50MB (a project setting, not our code) — uploads
  over 50MB fail at Storage and surface as an error. Upgrading Supabase to Pro
  raises it with zero code changes. (The old `/api/downloads` POST still works for
  direct/local <100MB uploads as a fallback.)
- **Large uploads must bypass the Proxy.** When a Proxy (middleware) matches a
  route, Next 16 buffers the request body in memory and **truncates it at
  `proxyClientMaxBodySize` (default 10MB)** — silently. So big uploads arrive cut
  off. Upload routes (e.g. `/api/downloads`) are therefore EXCLUDED from the proxy
  matcher (`src/proxy.ts`) and do their own fast `getSession()` auth check + stream
  the raw body to disk. Don't re-add them to the matcher.
- **No render-blocking external resources.** All fonts are self-hosted via
  `next/font` — never add a runtime `<link>` to `fonts.googleapis.com` (or any
  third-party CDN) in `<head>`. Users on networks/regions that block Google
  (corporate firewalls, some countries) hang on that request → the page shows
  server HTML but never hydrates → popups, date pickers, and uploads all silently
  fail. Symptom is location-correlated + browser-independent.

## Daily Log — work evidence viewer

Location: `daily-log/`. Deployed at **https://daily-log-eta-wrazy.vercel.app**.

A per-day view with a tab for each **human** the agent logs work for. For now
that's just **David Z**.

**URL structure:**
| Path | Shows |
|---|---|
| `/` | Redirects to latest day |
| `/2026-07-17/` | That day with a David Z tab |

**Data model** (`daily-log/data.json`):
```json
{ "days": {
  "2026-07-17": {
    "screenshots": ["https://supabase/..."],
    "workers": {
      "david-z": { "name": "David Z", "tasks": [{ "name": "...", "description": "...", "completed": true }] }
    }
  }
} }
```

**Subtasks** are intentionally omitted from the viewer. Nifty's public API cannot
reliably return child tasks, so the generate script does not try. If you need
subtasks, keep them in the Nifty task description or use a local data source.

**Screenshots** are uploaded to the Supabase `screenshots` bucket (public) and
shown as a day-level gallery at the top of each day. Local originals live in
`downloads/screenshots/{date}/`.

**To regenerate + deploy:**
```bash
bash scripts/deploy-daily-log.sh
# → regenerates data.json from Nifty, uploads screenshots to Supabase, deploys to Vercel
```

## Writing EOD reports in Nifty

EOD reports belong in the active Nifty **project** **EOD Report**
(`Dyo7QY7XNR`); **EOD Report is not itself a task**. Before drafting or
submitting one, confirm that the current
Nifty credentials can read that project. A read-only check is enough; do not
create a test report just to prove access.

Ask the person for anything that is not already known:

- Their full name.
- The report date (use today only when that is clearly what they mean).
- Shift start and end times.
- Number of tasks completed and still in progress.
- A short shift summary and any active blocker.

You may derive task counts and the summary from that person's completed Nifty
work when the evidence is clear, but say that you did so. If the records are
ambiguous, ask instead of guessing.

Existing EOD entries use a normal Nifty task rather than the project's generic
custom fields. Format the task name as the person's full name immediately
followed by the date in `MM/DD/YYYY` form, for example:

```text
David Zahemen Yeboah07/22/2026
```

Put the report itself in the task description using this structure:

```markdown
**Shift Start Time:** 3:05pm
**Shift End Time:** 8:15pm
**Number of tasks Completed:** 7
**Number of tasks in Progress:** 1
**Shift Summary:** Brief, outcome-focused summary of the work completed.

**In Progress / Blocker:** Include this only when something remains open or blocked.
```

Keep the shift summary concise and natural. Consolidate repetitive debugging
tasks into meaningful workstreams instead of pasting a raw task list.

Drafting and submitting are separate actions. If the person asks for a draft,
return the draft for review and make no change in the EOD Report project. Only
create or update the Nifty EOD task after they explicitly approve submission.
Before submitting, show the final task name and description and confirm any
missing or inferred values.

## Operator OS cross-repo guardrails

The separate `/home/dev/operator-os` repository is the Vite/React Operator OS
dashboard. Its canonical agent is local Codex (`gpt-5.6-luna`, maximum
reasoning), not a hosted Claude/Anthropic agent. The deployed `trigger-agent`
and `check-agent-status` functions are retired 410 compatibility responses;
never invoke them. `for_claude` fields are compatibility columns, while
`for_codex` and `codex_result` are canonical.

Do not confuse local `operator-os/agents/.env` readiness with hosted Supabase
Edge Function secret readiness. Provider and deployment claims require a
readback or smoke test in the scope where they will run. The hosted database
currently has no `pg_cron`/`pg_net` extension; local systemd timers are a
separate scheduler, and `me-context-update` must not be reported healthy while
its latest `routine_runs` entries say `Codex reported an incomplete workflow`.
The dashboard may build and render while the full Codex operating loop,
provider coverage, personalization, and monitoring remain incomplete.

## Cross-repo convergence (work-os ↔ agent-os)

This platform lives in two GitHub repositories that have **no shared history**
and must be reconciled by content, not by git merge:

- **`WrazyAI/work-os`** (this clone's `origin`; `/home/maigreeks/projects/work-os`)
  is canonical for the Work OS product surface: the desktop companion
  (`desktop/work-os-companion`), the Work OS web app (`src/app/api/work-os/**`,
  `src/lib/work-os-*`), `design.md`, tests, and the Windows release workflow.
- **`WrazyAI/agent-os`** (second remote `agentos`; VPS checkout
  `/home/dev/agent-os`) is the **deployed operations repository**: the agent
  platform surfaces (Claude / Antigravity / chat routes, Hermes/SEO tooling,
  cron, notebooks, `local-seo/`) plus a copy of the Work OS surface for the live
  app at `app.wrazyos.com`.

Whenever a change touches a path that exists in **both** repositories, apply it
to both in the same task, taking the newest functional version per file. Never
assume one repo is entirely ahead — each side has fixes the other lacks.

Convergence procedure:

1. Before editing a shared file, check the other side:
   `git fetch agentos && git diff agentos/main origin/main -- <path>`
   (and `git diff origin/main agentos/main -- <path>` for the reverse).
2. Shared paths are the repo surface that exists in both: `src/`, `desktop/`,
   `supabase/`, `test/`, `scripts/`, and the root configs. Repo-unique surfaces
   stay: agent-os keeps `cron/`, `local-seo/`, `config/hermes/`, the notebooks,
   and legacy agent routes; work-os keeps `design.md` and the release workflow.
   When in doubt, treat any path present in both trees as shared.
3. When a file diverged **structurally** (one side refactored a module into
   several), port the behavior fix, not the whole file. Never revert a refactor
   just because the other side's file is newer by timestamp.
4. Verify both sides before claiming convergence: here, `npm run work-os:typecheck`
   and `npm run work-os:test`; on agent-os, `npm run redeploy` plus a live probe
   against `http://127.0.0.1:3000`.
5. Never rewrite either repo's history to force a match. Converge content with
   normal commits on each side and record both commit SHAs in the handoff.

### Non-destructive convergence rule (mandatory)

Shared surfaces are maintained **independently in each repository** and
reconciled by explicit, per-file review. Bulk operations that can delete or
overwrite the other side's files are prohibited — a work-os-to-agent-os tree
copy on 2026-09-11 deleted 615 agent-os files from the worktree and replaced
the root layout, taking the live app's sidebar, tabs, favicon, and metadata
down with it.

- Never run `rsync --delete`, whole-tree `cp -a`, `git read-tree`, `git clean`,
  or any bulk sync against either checkout.
- Never treat "the other repo does not have this file" as a reason to delete
  it. Files that exist on one side only are repo-unique and must be left alone.
- Apply convergent changes one file at a time, keep the newest functional
  version of each (`git diff agentos/main origin/main -- <path>`), and review
  the resulting diff before committing.
- **agent-os-authoritative files** must never be replaced by work-os variants:
  `src/app/layout.tsx` (WrazyOS metadata, self-hosted fonts,
  ThemeProvider/QueryProvider/ActivityCenterProvider/Shell), `next.config.ts`
  (turbopack root pin, `proxyClientMaxBodySize`, build `cpus`), `src/proxy.ts`,
  `scripts/redeploy.sh`, `src/components/**`, and the agent platform routes.
- **work-os-authoritative files** stay in work-os: its thin standalone
  `src/app/layout.tsx` and `next.config.mjs` are correct only for the work-os
  repo and must never shadow or replace the agent-os versions.
- Guard tests enforce this: `test/agent-os-surface.test.mts` (agent-os) and
  `test/work-os-surface.test.mts` (work-os). Never delete or weaken them.

Recent shared-feature reconciliations (the pattern to follow):

- **Nifty access recovery** — `src/lib/integrations/nifty.ts` gained the static
  `NIFTY_ACCESS_TOKEN` fallback when an org refresh fails; and
  `src/lib/work-os-proposals.ts` stopped blocking proposal drafting on a full
  provider sync (it used the cached task view; approval re-syncs). Work-os
  commits `202747f` / `1b3955a`; agent-os commits `d533dfff7` / `62f20afd2`.
- **Task selection completion** — `desktop/work-os-companion/src/TaskSelectionCard.tsx`
  and `src/interpretation.ts` (`pendingApprovalCount`) so checking tasks files
  real proposals and no "Approve & record 0 tool calls" ever renders. Ship it as
  companion release 0.2.86 and keep the agent-os copy in step on redeploy.
- **Desktop build portability** — `src-tauri/tauri.conf.json`
  `beforeBuildCommand` must never hardcode a local Node path (release 0.2.82),
  and the companion's `vite.config.ts` keeps the repo-root `postcss.config.mjs`
  out of its build (0.2.84). These break the Windows CI when regressed.
- **Auth/storage fixes that lived only in agent-os** were ported into work-os:
  `src/lib/auth.ts` (`withSchema("neon_auth")` plus the 5-minute signed session
  cookie cache) and `src/lib/db/storage.ts` (lazy, `turbopackIgnore`d Node
  builtins), along with `src/modules/work-os/date-format.ts` and the
  token-styled `src/app/work-os/desktop/connect/DesktopConnect.tsx`.

## Logging progress tasks in Nifty

**Workflow rule:** BEFORE starting any work for the user, FIRST log the tasks in
Nifty. When each task/subtask is done, mark it complete. Do not batch-mark at the
end — mark them as you knock them off.

**Conciseness:** Task descriptions are read by humans (David & the team). Keep
them short — 1-3 sentences max. Think changelog entry, not essay. Subtask names
should be 5-8 words max. No bullet-pointed descriptions in task `description`
fields; put implementation details in subtasks instead.

### Creating tasks

Use `scripts/log-nifty-tasks.mjs` — the ONE canonical way. Do NOT hit the Nifty
API directly or write ad-hoc scripts.

Before creating a task, read today's tasks in the target project and check for
an exact or clearly equivalent active task. Reuse the existing task when one is
already tracking the same outcome. This matters especially when several agent
threads are working at once: blindly logging each request can create duplicate
tasks within seconds.

The canonical creator currently lives on the VPS at
`/home/dev/agent-os/scripts/log-nifty-tasks.mjs`. Run it through `ssh` with
`bash -lc` so the VPS Node toolchain is available. Do not refer to a local
`scripts/log-nifty-tasks.mjs` path unless that script has been restored here.

**JSON format** (`tasks.json`):
```json
{
  "project_id": "czFZk9928z",
  "milestone": "Tasks for Jul 17, 2026",
  "task_group_id": "PDp!eGkwR5",
  "tasks": [
    {
      "name": "Parent task title",
      "description": "Description of the work done",
      "subtasks": ["Subtask 1", "Subtask 2"]
    }
  ]
}
```

**Key rules (discovered through painful trial and error — follow them):**
- **Always** pass `milestone_id` (not `task_group_id`) for the milestone grouping.
  `task_group_id` = status column on the board; `milestone_id` = sprint/grouping.
  Using `task_group_id` alone creates tasks invisible under the milestone.
- **Always** set `task_group_id` to an existing status column ID (like `PDp!eGkwR5`
  for TASKS project) — the API requires it. Default: auto-detects the most-used
  status group in the project.
- **Subtasks** = tasks with a `task_id` field referencing the parent. There's no
  dedicated subtask creation endpoint. Just POST to `/api/v1.0/tasks` with
  `task_id: "<parent-id>"`.
- **Credentials use the current VPS-authoritative set.** The verified source is
  `/home/dev/agent-os/.env`; synchronize `NIFTY_CLIENT_ID`,
  `NIFTY_CLIENT_SECRET`, and `NIFTY_ACCESS_TOKEN` into this repository's
  `.env.local` only when the operator directs local use. Transfer and update
  values without printing them, then verify the local access token with the
  read-only projects endpoint. The currently stored `NIFTY_REFRESH_TOKEN` flow
  returns `401`; do not use it as an automatic recovery path.
- **Never shell-source a Nifty env file.** Secret values can contain shell
  metacharacters such as `&`. Parse `KEY=value` entries with Node or a
  line-oriented shell loop instead; never print a credential or access token.
- Use `--dry-run` to validate without creating anything.

**Milestone behavior:** Creates a new milestone if one with the given name doesn't
exist. Reuses an existing one if it does. Listing milestones may error for some
projects; the script gracefully falls through to creation.

**Example — logging today's work:**
```bash
node scripts/log-nifty-tasks.mjs --json '{
  "project_id": "czFZk9928z",
  "milestone": "Tasks for Jul 17, 2026",
  "task_group_id": "PDp!eGkwR5",
  "tasks": [
    {"name": "Fix production bug", "description": "...", "subtasks": ["Debug", "Fix", "Deploy"]}
  ]
}'
```

**Options:**
- `--file <path>` — load task defs from a JSON file
- `--json '<inline>'` — inline JSON string
- `--project <id>` — override project_id
- `--milestone <name>` — override milestone name
- `--dry-run` — validate only, don't create
- `--help` — show usage

### Consolidating duplicate tasks

When asked to clean up a Nifty board, first resolve the exact task IDs and group
them by outcome. Keep one clearly named canonical task for each outcome and
preserve unrelated work even if it was created on the same day.

- Page through `GET /api/v1.0/tasks?project_id=<id>&limit=100&offset=<n>` and
  deduplicate results by task ID. A task's `milestone` and `task_group` may be
  objects, so normalize their `.id` values before filtering.
- Archive redundant tasks with
  `POST /api/v1.0/tasks/{task_id}/archive` and `{"archived":true}`. Do not
  delete them; archived tasks retain the audit trail and can be recovered.
- Fold useful detail from the duplicates into the canonical task's short name
  and description before archiving them.
- Mark a canonical task complete only when the represented outcome is actually
  done. Leave genuine follow-up work open.
- Treat exact-title duplicates created by parallel agent threads as duplicates
  too, including the cleanup task itself.

Nifty's task update endpoint has a dangerous quirk: a partial
`PUT /api/v1.0/tasks/{task_id}` can change the task's completion state even when
`completed` was omitted. Read the task first and include its current
`completed` value in the update body, or immediately restore the intended state
through `POST /api/v1.0/tasks/{task_id}/complete` with
`{"completed":true|false}`.

After every consolidation, read back every canonical task and a sample of the
archived tasks. Verify `name`, `completed`, and `archived` explicitly before
reporting success. State how many tasks were retained, archived, completed, and
left open.

## Agent-driven SEO client onboarding

When an operator asks an agent to onboard a new SEO client, the agent should not
stop merely because the business is absent from the current client list. Ask for
the business name, domain, and niche; also gather services, service areas,
country, primary goal, and the Google account email when they are available.

Call `seo_create_client` once with a stable idempotency key. Use the returned
`client_id` for `seo_get_client_context`, then run `foundation.intake` and
`foundation.onboard` in that order as needed. Client creation is an internal
operation and does not mean Google or Zernio is connected. Provider access still
goes through the client-facing dashboard consent flow and must be verified
before the agent reports it as connected.

Re-read immediately before writes as well: another agent or operator may rename,
complete, or archive a task concurrently. Nifty list and single-task responses
expose subtask counts but do not reliably return child task IDs. Retain the IDs
printed by `log-nifty-tasks.mjs`, complete known subtasks before their parent,
and never guess missing child IDs.

### Marking tasks complete

Use the Nifty API directly with a Bearer token. Prefer the fresh local
`NIFTY_ACCESS_TOKEN` in `.env.local`; if it is absent or rejected, refresh it
using the local client credentials. Do not `source .env.local` or `.env`.

```bash
# Read local Nifty variables safely and print only the access token to this shell.
ACCESS_TOKEN=$(node -e "
const { readFileSync } = require('fs');
for (const path of ['.env.local', '.env']) {
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const match = line.match(/^([^=#]+)=(.*)$/); if (!match) continue;
      let value = match[2].trim();
      if ((value.startsWith('\"') && value.endsWith('\"')) || (value.startsWith(\"'\") && value.endsWith(\"'\"))) value = value.slice(1, -1);
      if (!process.env[match[1].trim()]) process.env[match[1].trim()] = value;
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
(async () => {
  if (process.env.NIFTY_ACCESS_TOKEN) {
    const verification = await fetch('https://openapi.niftypm.com/api/v1.0/projects?limit=1', { headers: { Authorization: 'Bearer ' + process.env.NIFTY_ACCESS_TOKEN } });
    if (verification.ok) return console.log(process.env.NIFTY_ACCESS_TOKEN);
  }
  const basic = Buffer.from(process.env.NIFTY_CLIENT_ID + ':' + process.env.NIFTY_CLIENT_SECRET).toString('base64');
  const response = await fetch('https://openapi.niftypm.com/oauth/token', { method: 'POST', headers: { Authorization: 'Basic ' + basic, 'Content-Type': 'application/json' }, body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: process.env.NIFTY_REFRESH_TOKEN }) });
  if (!response.ok) throw new Error('Nifty token refresh failed: HTTP ' + response.status);
  console.log((await response.json()).access_token);
})().catch(error => { console.error(error.message); process.exit(1); });
")

# Mark a task complete
curl -s -X POST "https://openapi.niftypm.com/api/v1.0/tasks/<TASK_ID>/complete" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"completed": true}'
```

When an operation must run on the VPS, keep the token there. This shell-only
reader handles unquoted shell metacharacters without emitting the token:

```bash
ssh -i /home/zahemen/.ssh/google_compute_engine -o BatchMode=yes dev@72.62.5.190 '
  token=""; while IFS= read -r line; do case "$line" in
    NIFTY_ACCESS_TOKEN=*) token="${line#NIFTY_ACCESS_TOKEN=}" ;;
  esac; done < /home/dev/agent-os/.env
  token="${token#\"}"; token="${token%\"}"
  curl --fail --silent --show-error -X POST \
    -H "Authorization: Bearer $token" -H "Content-Type: application/json" \
    -d "{\"completed\":true}" \
    "https://openapi.niftypm.com/api/v1.0/tasks/<TASK_ID>/complete"
'
```

If local validation fails, the VPS environment is the authoritative recovery
source. With operator approval, synchronize the current three Nifty values to
`.env.local` without printing any credential, then revalidate the local token
before retrying the operation. Do not use the stale refresh-token flow.

Read back the task after every completion write and verify `name`, `completed`,
and `archived`. Do not paste command output that includes a token into a task,
log, or chat.

### Screenshots

Local originals: `downloads/screenshots/{date}/`. Uploaded to Supabase bucket
`screenshots` (public) during `generate-daily-log.mjs`. Served from
`https://qdobqxyryntjescedjpf.supabase.co/storage/v1/object/public/screenshots/{date}/{file}`.

To add screenshots: drop files into `downloads/screenshots/{date}/`, then
regenerate + deploy. The script uploads them to Supabase and shows them as a
day-level gallery above the task list.

## DataForSEO credit conservation (critical)

**DataForSEO costs real money per API call.** This account is on a trial with
limited credits. Every call you make burns credits. Follow these rules:

1. **Never call DataForSEO speculatively.** Only call it when you need the data
   for a specific user-facing feature. No pre-fetching, no batch re-checks, no
   background refreshes.
2. **Use minimum limits.** The `dataforseo.ts` client already defaults to
   conservative values (keyword_ideas limit=15, ranked_keywords limit=50, SERP
   depth=5). Do not increase these unless the user explicitly asks for more.
3. **Dedupe in-flight requests (already built).** The `dedupedFetch` wrapper
   prevents duplicate concurrent requests for the same parameters. If you write
   new DataForSEO functions, use it. Never make two identical API calls.
4. **Fall back gracefully.** If DataForSEO returns 402 (Payment Required) or
   any error, the pipeline falls back to LLM-powered research at no cost. Never
   retry a failed DataForSEO call automatically.
5. **Do not batch multiple DataForSEO calls** unless the user has explicitly
   approved the credit cost. One research session = one keyword_ideas call max.
6. **If in doubt, skip DataForSEO and use the LLM fallback.** The LLM fallback
   costs nothing. Only use DataForSEO when real search volume, difficulty, or
   competition data is essential to the task.
7. **Credentials** live in `.env` as `DATAFORSEO_API_KEY_BASE64` (base64 of
   `login:password`). Current acct: trial with limited credits.
8. **Never expose credentials** in logs, error messages, or UI output. The
   client redacts them.
9. **When working on code that touches DataForSEO**, check `src/lib/dataforseo.ts`
   first to understand the existing conservative patterns before adding new calls.
