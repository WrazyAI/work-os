<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may
all differ from your training data. Read the relevant guide in
`node_modules/next/dist/docs/` before writing any code. Heed deprecation
notices.
<!-- END:nextjs-agent-rules -->

# Work OS agent instructions

Work OS is the Next.js 16 web app plus the Tauri desktop companion in this
repository. Agent OS is a separate repository/checkout that supplies the
deployed platform shell and local runner. Reconcile the two by content, never
by git merge or bulk tree copies.

## Before editing

1. `git fetch origin` and branch a dedicated worktree from the latest `main`:

   ```bash
   git worktree add /home/maigreeks/projects/.worktrees/<task-slug> \
     -b codex/<task-slug> origin/main
   ```

   Link dependencies from an existing worktree; do not run `npm install` while
   a dev/prod server is running (it corrupts the Turbopack cache).

2. Create or reuse a ledger task before user-requested investigation,
   implementation, deployment, integration, or external action. Use
   `scripts/work-os-ledger.mjs`; if access fails, report the exact blocker
   instead of doing untracked work. **TASKS** is the progress ledger. **EOD
   Report** is a project, not a task: each report is a task named
   `<Full Name><MM/DD/YYYY>`, and drafting never authorizes submission.
3. Read `design.md` completely before touching any UI. It is the canonical
   companion and web blueprint.
4. Read `desktop/work-os-companion/CHANGELOG.md` and skim recent `main` commits
   when reconciling work another agent may have landed.

## Commands

Use the native WSL Node toolchain, never Windows `node.exe` / `npm.cmd` or a
PATH that resolves into `/mnt/c`:

```bash
export PATH=/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH
```

| Task | Command |
|---|---|
| Typecheck | `npm run work-os:typecheck` |
| Full Work OS suite | `npm run work-os:test` (about 13 minutes; 11 opt-in PG tests skip by default) |
| Focused test | `node --import tsx --test test/<file>.test.mts` |
| One named test | `node --import tsx --test --test-name-pattern "<phrase>" test/<file>.test.mts` |
| Lint changed files | `npx eslint <files>` |
| Production build | `npm run build` |
| Work OS migration | `npm run db:apply:work-os` |
| One explicit migration | `npm run db:apply -- <migration.sql>` |

- The 11 PostgreSQL tests run only with
  `WORK_OS_TEST_POSTGRES_URL=<disposable-url>` and
  `WORK_OS_TEST_POSTGRES_DISPOSABLE=1`.
- `npm run work-os:test` runs the migration test plus the Work OS, desktop,
  Agent OS surface, and route-contract suites. A focused pass is not a
  substitute for it before a merge.
- TestSprite is installed at
  `/home/zahemen/.nvm/versions/node/v24.20.0/bin/testsprite`; invoke it with
  that toolchain on PATH. Auth is already configured: never re-run
  `testsprite setup`. Projects: **Work OS Companion**
  `e8fa6d35-586c-47a7-a69c-13e6b8552a0b` (frontend) and **Work OS Web API**
  `e35f94fb-0e9d-42f5-8eba-a5a5e13683b7` (backend). Stored frontend plans use
  `e2e-verify@wrazyos.com`; if its sign-in fails, rotate it with
  `tsx scripts/rotate-e2e-fixture.mts --password-file <secret> --apply` and
  refresh the project credential.
- CodeRabbit: one pass per completed task batch, not per commit. Run
  `/home/zahemen/.local/bin/coderabbit review --agent --base-commit <base>`,
  fix every still-valid finding, and re-run only when a fix materially changes
  the reviewed surface.

## Package boundaries

- `src/app/` — Next.js routes and pages. `src/lib/` — server logic.
  `src/modules/work-os/` — shared wire types (type-only imports are safe for
  the companion). `src/proxy.ts` — request proxy.
- `desktop/work-os-companion/` — Tauri app, React UI, Rust commands, ACL
  permissions. Version metadata lives in `package.json`, `tauri.conf.json`, and
  `Cargo.toml`.
- `supabase/migrations/` — database migrations; `test/` — `node:test` suites;
  `scripts/` — operations and deploy helpers.
- Agent OS-unique paths (`cron/`, `local-seo/`, `config/hermes/`, notebooks,
  legacy agent routes) are not Work OS surfaces. Leave them alone.

## AI surfaces

- `src/lib/work-os-ai-model.ts` is the single source for model choice,
  OpenRouter provider routing, reasoning effort, token budgets, timeouts, and
  usage logging. Use `aiRequestBody(model, body)`; do not build a second
  OpenRouter client or hardcode a different model.
- Employee chat: `src/lib/aiInterpret.ts` returns strict JSON with `reply`,
  `claims`, and `operations`; the route is
  `src/app/api/work-os/me/interpret/route.ts`. Questions answer in `reply` and
  never authorize a mutation.
- Admin Otto: `src/lib/work-os-admin-otto-intent.ts` returns `{ reply,
  intent }`; `src/lib/work-os-admin-otto-chat.ts` executes the typed read under
  admin authorization; `src/lib/work-os-admin-otto-summary.ts` writes the
  grounded reply from the real result. Admin chat is read-only: no mutations,
  messaging, approvals, impersonation, or employee decision controls.
- Do not reintroduce deterministic greeting/capability reply tables in admin
  chat. The model answers conversation; the server owns name resolution, typed
  reads, source filters, and grounded summaries.
- Admin EOD/report questions must use the `eods` / `reports` source filters, not
  the broad `records` projection. Pronoun/follow-up reads use the server's
  `context` target, never model-invented person ids.

## Data and auth

- Auth is Better Auth over Neon Postgres (`src/lib/auth.ts`). Files under
  `src/lib/supabase/` are compatibility helpers; their names do not prove
  Supabase Auth, Storage, Realtime, or service-role behavior is active.
- Object storage uses the R2/local adapter in `src/lib/db/storage.ts`. Keep
  Node storage imports lazy/bundle-safe.
- The proxy's session-cookie presence check is local and cheap; protected routes
  must verify authoritative sessions and scope reads/writes to the authorized
  user and organization. Cookie presence is not authorization.
- Preserve bearer, updater-download, desktop CORS, and public-route contracts.
  Large upload routes authenticate themselves and stay out of proxy body
  buffering.
- Before any database write, verify the resolved host. The migration resolver
  prefers `MIGRATION_DATABASE_URL`, then `DATABASE_URL_UNPOOLED`, then
  `DATABASE_URL`. On an established database apply only the new additive
  migration; never replay the historical set.

## Product invariants

- Activity inference must not create `work_check_ins` rows or advance
  `last_substantive_update_at`. Read the cadence/interval code before changing
  defaults. The active check-in cadence defaults to 60 minutes
  (`WORK_OS_CHECK_IN_INTERVAL_MINUTES`, 5–240); the first follow-up defaults to
  75 minutes. Per-person overrides live in `config/work-os.local.json`.
- Interval recaps are one evidence-bounded recap per due check-in. Confirm or
  amend queues one bounded next-step generation pass; proposals are never
  auto-applied. Keep `performed` (employee's own work) distinct from
  `triggered` (consequence of their work) in GitHub evidence.
- The mascot's identity/art lives in
  `desktop/work-os-companion/src/mascot.ts`. Render it through the shared
  `MascotMark` and configured chat crop; never hardcode agent identity or art.
- Every Tauri command needs an ACL grant for each invoking window. Keep
  window-specific commands in window-specific modules; companion ACL and mascot
  guard tests must stay green.
- Keep fonts self-hosted and avoid render-blocking external resources.
- Never `npm install` while a server is running. If the Turbopack cache is
  corrupted, remove `.next` and rebuild/restart.

## Verification

- Run the focused tests for the touched files, then `work-os:typecheck`, then
  the full `work-os:test` before merging or deploying.
- UI changes require rendered desktop and narrow checks, loading/empty/dense/
  error/keyboard/focus/reduced-motion states where applicable, plus TestSprite
  when a reusable fixture exists or is needed anyway. A successful build or
  static assertion is not visual acceptance.
- Treat a backend harness "pass" as lint unless it executed the code; run the
  same test directly or drive the API/DB. Live probes are the primary evidence
  for provider, runner, and state-machine behavior: read-only first, then the
  smallest write that proves the path.
- Review effort belongs on security, tenant isolation, data correctness and
  attribution, and state transitions. Report tool latency separately from
  engineering time.
- The floating companion has a token-free DEV fixture:
  `?window=avatar&avatar-fixture=recorded-completion`. Use it for avatar
  surface checks; keep the live `?window=avatar&token=` path for end-to-end.

## Deployment and convergence

- Work OS is authoritative for its product design, companion, Work OS routes
  and libraries (`src/app/api/work-os/**`, `src/lib/work-os-*`), tests, and
  release workflow. Agent OS is authoritative for its deployed platform shell
  and operational surfaces.
- Shared paths are `src/`, `desktop/`, `supabase/`, `test/`, `scripts/`, and
  root configs. Before changing one, compare the other remote by content
  (`git fetch agentos && git diff agentos/main origin/main -- <path>`), port
  behavior per file, and preserve structural refactors and repo-unique files.
  Never force matching history, use `rsync --delete`, `git read-tree`, or
  `git clean` across the repositories.
- Do not replace Agent OS's `src/app/layout.tsx`, `next.config.ts`,
  `src/proxy.ts`, `scripts/redeploy.sh`, platform components, or platform
  routes with Work OS variants. Work OS's standalone layout and
  `next.config.mjs` belong here.
- Work OS server changes deploy through the Agent OS checkout on the VPS.
  Read the host and SSH key path from the private Agent OS repo
  (`git fetch agentos && git show agentos/main:docs/vps-access.md`); never
  commit them here. Use `npm run redeploy` (atomic staging build, swap, restart,
  asset checks, rollback on failure). Never build over a running server's
  active `.next` tree. Verify the deployed commit, assets, and a representative
  live flow afterward.
- Companion releases must synchronize `package.json`, `tauri.conf.json`, and
  `Cargo.toml`, and move the release section out of `## Unreleased` in
  `CHANGELOG.md` using the ship date. CI fails without it; the GitHub release
  notes and What's New modal are built from that section. Write entries for the
  employee who just installed the update.

## Other surfaces

- `daily-log/` is a generated work-evidence viewer. Regenerate and deploy with
  `bash scripts/deploy-daily-log.sh`; each completed top-level task lands on its
  assignee's local day, and subtasks are omitted.
