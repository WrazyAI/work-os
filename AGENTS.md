<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may
all differ from your training data. Read the relevant guide in
`node_modules/next/dist/docs/` before writing any code. Heed deprecation
notices.
<!-- END:nextjs-agent-rules -->

# Work OS agent instructions

These instructions apply to the whole repository. Keep them aligned with
current code; historical commits and deployment snapshots are context.

## Task synchronization and worktree isolation

Before each new task or agenda, sync with the latest `main` and resolve
conflicts before editing. Every agent must make its changes in a dedicated git
worktree branched from the latest `main`. Never edit a shared checkout
(`/home/maigreeks/projects/work-os`, `/home/maigreeks/projects/agent-os-main`,
or another agent's worktree) — parallel agents editing one checkout is what
swept files into unrelated commits and raced builds. Shared checkouts are for
merges, convergence, and deploys only, and must never hold uncommitted work.

```bash
git fetch origin
git worktree add /home/maigreeks/projects/.worktrees/<task-slug> -b codex/<task-slug> origin/main
```

Link dependencies from an existing worktree instead of installing
(`npm install` while a server runs corrupts the Turbopack cache):

```bash
ln -s /home/maigreeks/projects/.worktrees/<existing>/node_modules \
      /home/maigreeks/projects/.worktrees/<task-slug>/node_modules
```

Do all edits, tests, and commits in the worktree. Rebase on the latest `main`
immediately before pushing; push verified work into `main`
(`git push origin HEAD:main`) and converge shared files into the other
repository per the cross-repo rules below. Deploy only after the merge. Remove
the worktree once its work is merged, or keep it only while follow-up work is
actively in flight; do not carry unmerged completed work into unrelated
follow-up work.

Read the changelog when reconciling: a rebase or merge can bring in work other
agents landed first. Read `desktop/work-os-companion/CHANGELOG.md` (or the
latest GitHub release notes) and skim `git log origin/main` for anything the
entries do not cover; reconcile unfamiliar files with that context instead of
guessing. Add a changelog entry when a change is release-facing.

## Mandatory work ledger

Create or reuse a Nifty task before user-requested investigation,
implementation, deployment, integration, or external action. Read existing
tasks first and reuse equivalent active work; use the canonical VPS logger
(`/home/dev/agent-os/scripts/log-nifty-tasks.mjs`) for creation. If access
fails, report the exact blocker and stop before changes rather than doing
untracked work.

- The progress project is **Tasks** (`czFZk9928z`). Keep descriptions short
  (one to three sentences) and subtask names to five to eight words; put
  implementation detail in subtasks, not bullet-pointed descriptions.
- Keep incomplete work open with a concise blocker; complete each task and
  known subtask only after its outcome and verification are done, and mark them
  as you go rather than batching at the end.
- Nifty's partial task update can change completion even when `completed` is
  omitted. Read the task first, include its current completion value in any
  update, and read back `name`, `completed`, and `archived` after every
  completion write.
- Keep Nifty credentials on the VPS; never print or paste a token.
- For explicitly requested duplicate cleanup, page tasks, retain one canonical
  task per outcome, archive duplicates rather than deleting them, and read back
  the canonical and archived states.
- EOD reports belong in the **EOD Report** project (`Dyo7QY7XNR`) as a task
  named `<Full Name><MM/DD/YYYY>`; EOD Report is not itself a task. Put the
  report in the description: shift start and end time, number of tasks
  completed and in progress, a short outcome-focused shift summary, and a
  blocker line only when something remains open. Drafting and submitting are
  separate: a draft is a read-only response and never authorizes creating or
  updating the EOD task.

Every handoff must state actual verification, remaining work, and the exact
external dependency when a provider, credential, permission, or deployment is
missing. A subprocess exit alone does not prove the user-visible flow.

## Product design

Before designing, implementing, reviewing, or modifying any Work OS interface,
read `design.md` completely. It governs companion and web surfaces, including
employee, manager, administrator, onboarding, review, evidence, and settings.
Use the current desktop Today, Tasks, shared composer, details, and menus as
visual authority; do not copy older patterns that conflict with the blueprint.

Follow the applicable component contracts, semantic tokens, responsive and
operational state matrices, accessibility, truthful provenance, task-first
hierarchy, and progressive disclosure. Validate desktop and narrow layouts,
loading, empty, dense, error, keyboard/focus, overlay collisions, and reduced
motion. Inspect rendered screenshots and exercise controls before completion.
Report tested states and remaining gaps. Document intentional deviations;
update `design.md` when adding a reusable pattern and its full contract.

## Current architecture and invariants

Work OS contains the Next.js web surface and Tauri desktop companion.
`docs/NEON-MIGRATION-PLAN.md` describes the migration context; current code is
in `src/lib/auth.ts`, `src/lib/db/`, and `src/lib/supabase/` compatibility
helpers. Auth is Better Auth over Neon Postgres. Legacy `supabase` names do not
prove Supabase Auth, Storage, Realtime, or service-role behavior is still
active. Object storage uses the R2/local adapter in `src/lib/db/storage.ts`.

The deployed operations app lives in the separate Agent OS checkout. Its local
execution engine requires host binaries and credentials; do not move
host-dependent routes or execution to serverless hosting without redesign.
Verify target services and runtime state before operational claims.

- Keep the proxy's session-cookie presence check local and inexpensive.
  Protected routes must verify authoritative sessions and scope reads/writes
  to the authorized user and organization; cookie presence is not authorization.
- Preserve existing bearer, updater-download, desktop CORS, and public-route
  contracts. Large upload routes authenticate themselves and stay excluded
  from proxy body buffering; do not casually re-add them to the matcher.
- The mascot's identity/art lives in
  `desktop/work-os-companion/src/mascot.ts`. Use the shared `MascotMark`
  renderer and configured chat crop; never hardcode agent identity or art.
- Tauri commands need ACL grants for every invoking window. Keep
  window-specific commands in appropriate modules and preserve companion
  ACL/mascot guard tests. Keep desktop build commands portable for Windows CI;
  do not hardcode workstation Node paths into Tauri/Vite build configuration.
- Keep fonts self-hosted and avoid render-blocking external resources. Keep
  storage Node imports lazy/bundle-safe. Preserve provider provenance,
  idempotent mutations, and truthful approval/completion states.

AI activity inference must not create `work_check_ins` rows or advance
`last_substantive_update_at`. Read check-in and activity-interval code before
changing cadence or bounds; configuration defaults belong with that code.

### Activity Interval Reviews and next steps

The active check-in cadence defaults to sixty minutes
(`WORK_OS_CHECK_IN_INTERVAL_MINUTES`, 5-240); the first progress check-in lands
`WORK_OS_FIRST_FOLLOW_UP_MINUTES` (default 75, range 5-240) after plan
confirmation or clock-in, and once it is due an unconfirmed plan no longer
blocks the cadence. Activity Interval Reviews build one evidence-bounded recap
per due check-in from Worktivity frames; bounds are
`WORK_OS_ACTIVITY_INTERVALS_ENABLED` (default on),
`WORK_OS_ACTIVITY_INTERVAL_MAX_MINUTES` (120),
`WORK_OS_ACTIVITY_INTERVAL_MAX_FRAMES` (12),
`WORK_OS_ACTIVITY_INTERVAL_MAX_RAW_FRAMES` (5), and
`WORK_OS_ACTIVITY_INTERVAL_MAX_PER_DAY` (10; a valid non-hourly cadence
override triples the cap up to 72). Per-person cadence overrides live in
`config/work-os.local.json` (matched by email or person id;
`WORK_OS_LOCAL_CONFIG_PATH` can point elsewhere): a person entry overrides the
deployment environment, and everyone else falls back to the environment and
then the 60-minute default. AI inference never creates a
`work_check_ins` row and never advances `last_substantive_update_at`.

Confirming or amending a recap queues one bounded next-step generation pass
(`src/lib/work-os-next-steps.ts`) through the existing proposal pipeline:
`complete_task` for open tasks/subtasks the approved evidence shows finished,
and `create_task`/`add_subtask` for concrete untracked deliverables. Suggestions
must cite the recap activities they are based on, clear the confidence floor,
and target the exact open-task list the model saw; nothing is ever auto-applied,
and generation never blocks the recap decision or writes check-ins or cadence.

When `github_evidence` is enabled and the employee has verified GitHub
accounts, interval recaps and EOD drafts also receive attributed GitHub
activity. Keep the two relationships exact: `performed` is the employee's own
account's work; `triggered` is a consequence of their work (CI runs linked by
same-window pushed commits, deployments they created, reviews or closures on
their pull requests) and must never be described as their own action. Recorded
activity may be stated exactly as recorded but is never Nifty task completion,
never attendance, and never a substitute for screenshot evidence; the model's
structured `recorded_activity` output is validated against the recorded list.

## Verification and review cadence

Use the native WSL Node toolchain for builds/tests/packaging, never Windows
Node/npm through `/mnt/c`. Resolve the installed toolchain before use and ensure
child scripts use the same PATH; workstation-specific version paths are not
portable build configuration.

Run relevant tests and `npm run work-os:typecheck` / `npm run work-os:test` for
affected Work OS behavior. One CodeRabbit pass per completed task batch, not per
commit: run `coderabbit review --agent --base-commit <batch base>` once the
batch is complete, fix every still-valid finding, and rerun only when a fix
materially changes the reviewed surface. Spend review passes on security,
tenant isolation, data correctness and attribution, and state transitions;
avoid per-commit reviews.

UI-affecting changes require TestSprite when a reusable fixture exists or is
needed anyway, plus rendered/browser checks. The backend harness validates code
without executing it — treat a backend "pass" as lint and execute the same test
directly (or drive the API/DB) before reporting a verdict. Live probes are the
primary evidence for provider, runner, and state-machine behavior: read-only
queries first, then the smallest write that proves the path. The floating
companion has a token-free DEV fixture at
`?window=avatar&avatar-fixture=recorded-completion` for avatar-surface checks;
the live `?window=avatar&token=` path stays the end-to-end option. Report tool
latency separately from engineering time.

### TestSprite CLI

The CLI is installed at
`/home/zahemen/.nvm/versions/node/v24.20.0/bin/testsprite`; invoke it with that
toolchain on PATH. Auth is already configured — never re-run `testsprite setup`;
if `auth status` itself fails, stop and tell the operator.

Work OS projects: **Work OS Companion** `e8fa6d35-586c-47a7-a69c-13e6b8552a0b`
(frontend, → https://app.wrazyos.com) and **Work OS Web API**
`e35f94fb-0e9d-42f5-8eba-a5a5e13683b7` (backend, →
https://srv1726015.tailbf7608.ts.net). Frontend runs use the project's
configured environment URL; use `--local <port>` for a localhost-only frontend.
Existing frontend plans log in with the `e2e-verify@wrazyos.com` fixture; when
that sign-in fails, rotate it with
`tsx scripts/rotate-e2e-fixture.mts --password-file <secret> --apply` and
refresh the frontend project credential so stored scripts resolve. Keep the
fixture on that email because stored scripts hardcode it.
`tsx scripts/e2e-cleanup.mts <user-id> [--dry-run]` removes a disposable e2e
user. Backend tests need a project credential and at least one literal
`assert` in the Python.

## Releases and deployment

Companion releases must synchronize version metadata in
`desktop/work-os-companion/package.json`,
`desktop/work-os-companion/src-tauri/tauri.conf.json`, and
`desktop/work-os-companion/src-tauri/Cargo.toml`. Move released entries from
`## Unreleased` into `## <version> — <YYYY-MM-DD>` in
`desktop/work-os-companion/CHANGELOG.md`, using the day the build ships; the
What's New history shows that date beside the version. CI fails without it and
the GitHub release notes are built from that section. Write every entry for
the employee who just installed the update — one short, plain bullet per
change — because first launch after an update shows it in the changelog modal.
Keep installer/updater verification and signing requirements intact.

Work OS changes deploy through the deployed Agent OS checkout on the VPS
(`/home/dev/agent-os`). This repository is public, so the host address and the
SSH key path are kept out of it; read them from the private Agent OS repo
(`git fetch agentos && git show agentos/main:docs/vps-access.md`). Use the
atomic redeploy path there (`npm run redeploy`): it builds a staging tree, swaps
it, restarts the web service, checks live assets, and rolls back on failure.
Never build over a running server's active `.next` tree, and verify the
deployed identity, assets, and a representative live flow afterward.

Database changes run against Neon. Apply an explicit additive migration with
`npm run db:apply:work-os` (Work OS) or `npm run db:apply -- <migration.sql>`;
on an established database never replay the historical set. Verify the resolved
host before any write — the resolver prefers `MIGRATION_DATABASE_URL`, then
`DATABASE_URL_UNPOOLED`, then `DATABASE_URL`. Never expose credentials or treat
migration completion as proof that live behavior is correct.

## Work OS and Agent OS convergence

The repositories have independent histories and must be reconciled by content,
not by git merge. Work OS is authoritative for its product design, companion,
Work OS routes/libraries (`src/app/api/work-os/**`, `src/lib/work-os-*`), tests,
and release workflow. Agent OS is authoritative for its deployed platform shell
and operational surfaces. Do not assume either whole tree is ahead. Shared
paths are `src/`, `desktop/`, `supabase/`, `test/`, `scripts/`, and the root
configs; `cron/`, `local-seo/`, `config/hermes/`, the notebooks, and legacy
agent routes are Agent OS-unique and must be left alone.

Before changing shared paths, compare the other remote's content
(`git fetch agentos && git diff agentos/main origin/main -- <path>`), port
behavior per file, preserve structural refactors and repo-unique files, review
diffs, and verify both sides before claiming convergence. Never force matching
history, use bulk tree copies, `rsync --delete`, `git read-tree`, `git clean`,
or any cleanup that deletes the other repo's unique work. Preserve surface
guard tests (`test/work-os-surface.test.mts` here; `test/agent-os-surface.test.mts`
there).

Never replace Agent OS's `src/app/layout.tsx`, `next.config.ts`, `src/proxy.ts`,
`scripts/redeploy.sh`, platform components, or platform routes with Work OS
variants. Work OS's standalone layout and `next.config.mjs` belong to this repo.
`scripts/converge-to-agentos.mts` handles blob-identical files in an isolated
worktree; new or diverged files require explicit review, and the helper pushes
to Agent OS, so run it only within authorized cross-repo integration. Record
both commit identities and live verification when convergence is complete.
