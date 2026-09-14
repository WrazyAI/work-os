# Nifty Exit Plan — Work OS Local Task Authority

**Status:** Approved for implementation — operator directed Phase A work on 2026-09-14
**Date:** 2026-09-14
**Repos:** `WrazyAI/work-os` (canonical product surface) · `WrazyAI/agent-os` (deployed app + runner)
**Ledger:** Nifty `sFgUhkIiFF` — "Migrate Work OS task authority from Nifty to Neon"
**Related:** `docs/NEON-MIGRATION-PLAN.md`, Nifty `3XjXxs8pxu` (prior task-ownership assessment)

---

## 1. Objective

Make Work OS the authoritative task system on the in-house Neon Postgres store:

1. Every employee-facing task surface reads from Neon without requiring a Nifty sync.
2. Task creation, editing, completion, archiving, deletion, and subtasks write to Neon.
3. The Nifty sync dependency is removed from runtime; Nifty can be retired for Work OS.

**Out of scope unless separately approved:** Daily Log (separate Vercel app reads Nifty
directly), Worktivity attendance reconciliation (separate provider), GitHub/GHL webhooks
(independent providers).

---

## 2. Verified current state (2026-09-14)

### The backfill is effectively already done

The Nifty mirror has been running for months. Verified live on Neon:

| Data | Count | Notes |
|---|---:|---|
| `work_tasks` mirrored from Nifty | 1,586 | 100% have `provider_task_id` + `assignee_person_ids` |
| — open / completed / archived / deleted | 205 / 1,343 / 33 / 4 | completion timestamps captured |
| — with due dates | 1,270 | |
| — subtasks | 101 | parent linkage present |
| — with milestone id | 1,487 | `raw.milestone` on 1,485 |
| `work_projects` | 12 | local UUIDs + provider ids |
| `task_comments` | 0 | nothing to migrate; not surfaced in Work OS |
| `work_provider_field_mappings` | 0 | Nifty custom-field sync unused |

All other Work OS data is already Neon-native and not Nifty-dependent: daily plans, plan
items, check-ins, evidence, evidence events, reports, sessions, session events, task day
events, attendance observations, screenshot summaries, insights.

### The live failure this plan must fix first

The approval endpoint runs a **full Nifty org sync inline**. `syncNifty` upserts all 1,586
tasks serially plus projects/members/plan repair; measured duration from production:

- "Integrate CodeRabbit and TestSprite into Work OS" proposal created `15:24:17`,
  marked `applied` at `15:26:24` — **2 m 07 s**.
- The companion aborts approval requests at 60 s, so the UI showed
  *"The server took too long to respond. It may still have filed — check Review before
  retrying."* while the server actually created the task.
- Result: 3 duplicate proposals for that task (1 applied, 2 pending) from retries.

All-time `complete_task` proposals: **0 applied**, 9 pending, 4 rejected, 2 `needs_review`
(the two `needs_review` rows are from an old completion-evidence gate that is already
removed in current code).

---

## 3. What depends on Nifty today

| Layer | Location | Change needed |
|---|---|---|
| Task writes | `src/lib/work-os-tasks.ts` (`createTask`, `updateTask`, `completeTask`, `archiveTask`, `deleteTask`, `moveTaskToParent`, `applyMappedFields`) | local implementations; drop Nifty API calls |
| Sync triggers | `src/lib/work-os-day-view.ts` (day freshness), `src/lib/work-os-employee-tasks.ts:81` (task detail), `src/lib/work-os-proposals.ts:94,404` (approvals), `src/app/api/work-os/nifty/sync/route.ts` | remove from runtime |
| Attribution | `listPersonTasks` ledger merge, `isNiftyTaskAttributableToMember`, `work_people.nifty_member_id` | local tasks match by `assignee_person_ids`; keep Nifty path only for history |
| Nifty surface | `src/app/api/work-os/nifty/*` (members, oauth start/callback, projects, status, sync, tasks), Nifty task-id parsing in `work-os-provider-webhooks.ts` | retire at cutover |
| UI / readiness | companion `App.tsx` (21), `taskSurfaces.tsx` (13), `AvatarApp.tsx` (8), `TaskSelectionCard.tsx` (4), web `EmployeeWorkOsHome.tsx`, `work-os-readiness.ts`, `work-os-insights.ts` | Work OS task language; drop "Nifty current/syncing/write-back/outcomes" |
| Config | `NIFTY_*`, `WORK_OS_NIFTY_LEDGER_PROJECT_ID`, `WORK_OS_NIFTY_DEFAULT_TASK_GROUP_ID` | retire after rollback window |
| Design blueprint | `design.md` sections naming Nifty as authoritative/provenance | update authority language |
| Runner | none — no Nifty jobs in `scripts/agent-runner.ts`; only Worktivity + screenshot timers exist | nothing to change |

---

## 4. Target architecture

- **Provider identity.** New tasks: `provider = "work_os"`, `provider_task_id = NULL`,
  local UUID `id`. Historical rows keep `provider = "nifty"` and their ids — no rewrite.
- **Assignment.** `assignee_person_ids` (local `work_people.id`) is the only assignment
  source. `nifty_member_id` stays for historical attribution only.
- **Projects.** New tasks reference a local `work_projects.id`. Default project decided
  below (recommended: reuse the existing ledger project row until a real project model).
- **Subtasks.** Local parents link via `parent_task_id` (already a column); queries gain
  dual support alongside `parent_provider_task_id`.
- **Completion.** Local `completed` + `completed_at` + `work_task_day_events` entries
  (already written by `setWorkOsEmployeeTaskCompletion`). Approval gate unchanged.
- **Statuses.** Nifty board columns (`task_group_id`) have no local equivalent today —
  decision required (Section 6).
- **Switch.** Org/member `feature_flags` JSONB already supports per-org flags; use
  `local_task_authority` so cutover and rollback are configuration, not deployment.
- **Sync.** `syncNifty` becomes a manual import/reconciliation tool only (never called
  from request paths), then is deleted after the rollback window.
- **No dual-write.** One writer at a time: Nifty while the flag is off, Neon while on.
  The mirror stays read-only in local mode.

---

## 5. Phased plan

### Phase A — Unblock approvals (P0, small)

**Deliverables**
1. `work-os-proposals.ts`: remove `await syncNifty(ownerId)` from `applyProposal`
   (`create_task` reconciliation) and from the pre-apply staleness check. Task-linked
   staleness uses `syncNiftyTask(ownerId, providerTaskId)` (single call); `complete_task`
   and `reopen_task` skip staleness entirely (idempotent, existence validated).
2. Companion reconciliation: on approval timeout, re-read the proposal
   (`GET /api/work-os/proposals/[proposalId]`, new owner-scoped route) and report the
   truth — applied / real failure reason / "still processing, do not retry".
3. Reject the 2 duplicate pending "CodeRabbit" proposals (one already applied).

**Acceptance:** approval round-trip `created_at → updated_at` < 5 s on the live server;
typecheck + tests green in both repos; companion shows truthful outcome on a forced
timeout.

### Phase B — Backfill verification (small)

**Deliverables**
1. One final full sync, then a reconciliation report (`docs/NIFTY-BACKFILL-REPORT.md`):
   counts by state, projects, assignments, due dates, subtasks, sample field diffs
   (Nifty API vs Neon).
2. Verify every `assignee_person_ids` value resolves to a `work_people.id` in the same
   organization / `user_id` — array membership alone is not enough because `uuid[]`
   only enforces UUID syntax. Report any unmatched assignment as a blocker before
   Phase C.
3. Confirm zero Work-OS-surfaced data classes live only in Nifty.

**Acceptance:** report shows parity (or itemized, resolved gaps) for every table above,
with zero unresolved assignee-domain mismatches.

### Phase C — Local task authority (medium, dark launch)

**Deliverables**
1. Local write paths behind `local_task_authority` (org flag, default off):
   - create → local insert (`provider = "work_os"`), day event `creation_observed`
   - update → local column patch (`title`, `description`, `due_date`, `start_date`,
     `priority`, `labels`, `expected_outcome`, `definition_of_done`)
   - complete/reopen → local state + `completed_at` (existing layer)
   - archive/delete → local tombstone (existing local half; drop Nifty call)
   - move subtask → local `parent_task_id` update (drop Nifty polling)
   - drop `applyMappedFields` / `mappedSemanticFields` (0 mappings in use)
2. Provider-neutral query audit: every filter on `provider_task_id` /
   `parent_provider_task_id` gains local support (`parent_task_id`, `id`).
3. Attribution: local tasks match by `assignee_person_ids`; ledger/attribution query runs
   only for Nifty-provider rows.
4. Tests: local CRUD, mixed-provider listing, subtask progress, day events, proposals.

**Acceptance:** with the flag off, behavior is byte-identical to today; with the flag on
in a test org, the full desktop task lifecycle for new local rows works with zero Nifty
API calls. Historical Nifty-backed rows may still refresh through the task-detail path
until Phase D removes it; the mixed-provider test covers both row kinds explicitly.

### Phase D — Cutover and retirement (next pass recommended)

**Deliverables**
1. Flip `local_task_authority` for the owner org; observe 24–48 h.
2. Remove sync triggers, Nifty routes/webhooks/credentials, and dead code.
3. UI + `design.md` copy updates ("Nifty" → Work OS task language; static tests updated).
4. Revoke Nifty tokens after the rollback window; archive the export tool.

**Acceptance:** no runtime Nifty calls (server logs clean), all surfaces show Work OS
task state, desktop + web verified at wide/compact widths.

---

## 6. Decisions required before Phase C

1. **Status columns.** Nifty board columns (`task_group_id`, e.g. `PDp!eGkwR5`) have no
   local model. Options: (a) drop the status-move tool, (b) add a local `board_status`
   text field, (c) keep only open/completed/archived. What are the columns used for
   today?
2. **Default project for new tasks.** Reuse the mirrored ledger project row (recommended
   for continuity) or create a formal "Inbox" project?
3. **Provider value name.** `work_os` (recommended) vs `local`.
4. **Milestones.** No milestones table exists; names live in `raw`. Keep as read-only
   metadata from `raw` (recommended) or build a local milestone model now?
5. **Naming.** Confirm user-facing "Nifty" → "Work OS"/"Tasks" everywhere, including
   `design.md` provenance language.
6. **Cutover style.** Dark-launch then flip (recommended) vs flip live immediately after
   Phase C verification.
7. **Daily Log.** Leave reading Nifty for now (recommended) or include here?
8. **Rollback window.** How long to keep Nifty credentials + export tool after cutover
   (recommend 7–14 days)?

---

## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Duplicate tasks from timeout retries | Phase A reconciliation; reject known duplicates; server-side marker dedupe |
| Mixed-provider query misses | Provider-neutral audit + mixed-listing tests in Phase C |
| Status semantics lost | Decision 6.1 before implementation; default to minimal (open/completed) if unclear |
| Hidden Nifty dependency surfaces late | `rg` dependency map is the checklist; acceptance requires zero runtime calls in logs |
| Rollback after local tasks created | Rollback only restores reads; locally created tasks need the (one-way) export tool — documented, or accept forward-only after flip |
| Cross-repo drift | Apply server/companion changes to both `work-os` and `agent-os` in the same task; verify both |
| UI copy breaks static tests | Update `test/work-os-desktop-static.test.mts` assertions in the same change |

---

## 8. Rollback

- Phase A/B: revert commit; Nifty remains authoritative throughout.
- Phase C (dark launch): the flag is off in production, so no production data is
  written locally. In a test org, locally created rows stay visible if the flag is
  disabled (reads are provider-agnostic); they are exported through the same one-way
  export tool defined for Phase D, or discarded with the test org. Rollback never
  hides a task that was created during the launch.
- Phase D: flag off restores Nifty authority for historical tasks. Disabling the flag is
  gated on a verified export of every locally created row: `updateTask`, `completeTask`,
  `archiveTask`, `deleteTask`, and `moveTaskToParent` all operate through
  `provider_task_id`, so a local row with a null provider id has no Nifty mutation path.
  When export verification is incomplete, the cutover is explicitly forward-only and
  local-row mutations are blocked with a clear message until the export lands.

---

## 9. Verification and release

- **Phase A:** VPS typecheck + tests + redeploy; live timing check via DB
  (`created_at → updated_at` delta); companion tests for reconciliation; auto-release
  next desktop version; updater catalog check.
- **Phase B:** reconciliation report committed to `docs/`.
- **Phase C:** both repos' test suites; dark-launch parity check with the flag on in a
  non-production org.
- **Phase D:** 24–48 h live observation (runner logs, server routes), then credential
  revocation.

---

## 10. Open questions

1. Do you use Nifty board/status columns for anything operational, or only as a backlog
   column? (Determines Decision 6.1.)
2. Should new local tasks be visible to managers/admins in the same web surfaces with
   the same semantics, or is there a manager-side workflow we should preserve first?
3. Any data you want exported from Nifty beyond tasks/projects (e.g., comments,
   attachments, time logs) for compliance or reporting?
4. After cutover, should the historical `provider = "nifty"` distinction remain visible
   anywhere in the UI, or become invisible metadata?
5. Should Phase D run in the same pass if Phase C verifies clean, or wait for a separate
   approval?
