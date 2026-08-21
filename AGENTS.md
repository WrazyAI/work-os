<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# WrazyAI web platform — operations runbook

This dashboard is a **multi-user web platform**, not a localhost-only app. Full
design in `WEB-PLATFORM-SPEC.md`; current status in `IMPLEMENTATION-STATUS.md`.

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

Never search for an “EOD Report task” in the Tasks project. A draft is a
read-only response: do not create or update an EOD task until the operator has
reviewed and explicitly approved the final name and description.

For every task handoff, include what was actually verified, what remains open,
and the exact external dependency when a provider, credential, permission, or
deployment is missing. Do not convert a successful subprocess exit into a
claim that the user-visible workflow completed.

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

## Public access (Tailscale Funnel)
- Public URL: **https://srv1726015.tailbf7608.ts.net** → proxies to `127.0.0.1:3000`.
- `tailscale funnel status` · turn **off**: `tailscale funnel --https=443 off` ·
  turn **on**: `tailscale funnel --bg 3000` (operator=dev already set, so no sudo).
- Only the Supabase login gates public access — keep the owner password strong.

## Supabase operations
- Keys in `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`, `..._ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_PASSWORD`). The runner self-loads `.env`/`.env.local`.
- Apply schema (direct Postgres): `npm run db:apply`
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
  `/home/zahemen/.nvm/versions/node/v22.14.0/bin/node` and
  `/home/zahemen/.nvm/versions/node/v22.14.0/bin/npm`; never use `node.exe`,
  `npm.cmd`, Windows Node/npm, or a PATH resolution into `/mnt/c`. For commands
  whose child scripts invoke `node`, prefix PATH explicitly, for example:
  `PATH=/home/zahemen/.nvm/versions/node/v22.14.0/bin:$PATH /home/zahemen/.nvm/versions/node/v22.14.0/bin/npm run build`.
  For the live web platform, retain the deployment rule below and use the same
  absolute npm path with `run redeploy` instead of running `build` alone.
- **Auth proxy** (`src/proxy.ts` + `src/lib/supabase/proxy.ts`) must use local
  `getSession()`, **never** network `getUser()` — `getUser()` blocks every request
  on a network round-trip and hangs the entire app. Authoritative `getUser()` lives
  only in `requireUser()` on protected routes.
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

```bash
node scripts/log-nifty-tasks.mjs --file tasks.json
```

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
- **Token refresh** is handled automatically (uses `NIFTY_REFRESH_TOKEN` from
  `/home/dev/agent-os/.env`).
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

Use the Nifty API directly with a Bearer token (refreshed the same way as the
logger script). There's a convenience edge in the existing library, but the raw
call is simpler:

```bash
# First get a fresh token
ACCESS_TOKEN=$(node -e "
const { readFileSync } = require('fs');
const raw = readFileSync('/home/dev/agent-os/.env','utf-8');
raw.split('\n').forEach(l => { const m = l.match(/^([^=#]+)=(.*)$/); if(m) { const k=m[1].trim(); let v=m[2].trim(); if ((v.startsWith('\"')&&v.endsWith('\"'))||(v.startsWith(\"'\")&&v.endsWith(\"'\"))) v=v.slice(1,-1); if(!process.env[k]) process.env[k]=v; } });
const b=Buffer.from(process.env.NIFTY_CLIENT_ID+':'+process.env.NIFTY_CLIENT_SECRET).toString('base64');
fetch('https://openapi.niftypm.com/oauth/token',{method:'POST',headers:{Authorization:'Basic '+b,'Content-Type':'application/json'},body:JSON.stringify({grant_type:'refresh_token',refresh_token:process.env.NIFTY_REFRESH_TOKEN})}).then(r=>r.json()).then(d=>console.log(d.access_token));
")

# Mark a task complete
curl -s -X POST "https://openapi.niftypm.com/api/v1.0/tasks/<TASK_ID>/complete" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"completed": true}'
```

Or with a single one-liner from Node:
```bash
node -e "
const {readFileSync}=require('fs');
const raw=readFileSync('/home/dev/agent-os/.env','utf-8');
raw.split('\n').forEach(l=>{const m=l.match(/^([^=#]+)=(.*)$/);if(m){const k=m[1].trim();let v=m[2].trim();if((v.startsWith('\"')&&v.endsWith('\"'))||(v.startsWith(\"'\")&&v.endsWith(\"'\")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v;}});
(async()=>{
  const b=Buffer.from(process.env.NIFTY_CLIENT_ID+':'+process.env.NIFTY_CLIENT_SECRET).toString('base64');
  const t=(await(await fetch('https://openapi.niftypm.com/oauth/token',{method:'POST',headers:{Authorization:'Basic '+b,'Content-Type':'application/json'},body:JSON.stringify({grant_type:'refresh_token',refresh_token:process.env.NIFTY_REFRESH_TOKEN})})).json()).access_token;
  for(const id of process.argv.slice(2)){
    const r=await fetch('https://openapi.niftypm.com/api/v1.0/tasks/'+id+'/complete',{method:'POST',headers:{Authorization:'Bearer '+t,'Content-Type':'application/json'},body:JSON.stringify({completed:true})});
    console.log(id+' -> HTTP '+r.status);
  }
})();
" <TASK_ID_1> <TASK_ID_2> ...
```

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
