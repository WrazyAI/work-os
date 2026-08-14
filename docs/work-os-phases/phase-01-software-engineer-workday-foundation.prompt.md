# Phase 1 Prompt — Software Engineer Workday Foundation

You are implementing Phase 1 of the Work OS desktop companion pilot in `/home/maigreeks/projects/work-os`, with the integrated application under `desktop/work-os-companion` and the Work OS web/API surface under `src/app/work-os` and `src/app/api/work-os`.

The only pilot employee is David, a software engineer. Do not generalize the product to sales, support, or other worker types in this phase. Build the smallest complete daily work loop for a software engineer while keeping the data model extensible.

Before changing code:

1. Read the repository `AGENTS.md` in full.
2. Read `docs/work-os-pilot.md`, `IMPLEMENTATION-STATUS.md` if present, migrations `0008_work_os.sql` through `0014_work_tasks_milestone_id.sql`, and the current desktop README.
3. Run `git status --short` and preserve every unrelated or pre-existing change.
4. Read today's Nifty tasks in project `czFZk9928z`. Reuse an equivalent active task or create one with `scripts/log-nifty-tasks.mjs` before implementation.
5. Read the relevant Next 16 documentation from `node_modules/next/dist/docs/` before modifying Next routes or server APIs.
6. Use only the absolute WSL Node/npm binaries specified in `AGENTS.md`.

## Objective

Deliver an authoritative, recoverable workday lifecycle covering onboarding, explicit clock-in, plan confirmation, task carry-over, progress updates, and clock-out. Nifty remains the task source of truth. Employee statements produce reviewable proposals and must not silently mutate Nifty.

## Deliverables

### 1. Software-engineer pilot profile

Extend the existing role profile and onboarding contract so the pilot records:

- Role title and role profile.
- Team and manager/reviewer.
- Timezone, working days, shift start/end, and break windows.
- Primary engineering responsibilities.
- Expected output types: code, pull requests, reviews, tests, deployments, technical documents, and incident work.
- Authorized evidence sources.
- Notification, voice, and privacy preferences.
- GitHub identity placeholder, even if GitHub verification is enabled only in Phase 3.

Separate employee-owned fields from manager-owned fields. The employee may propose changes to manager-owned configuration but may not overwrite it directly.

### 2. Explicit work-session state machine

Add an explicit work-session model rather than inferring clock state only from schedule time. At minimum support:

```text
scheduled -> clocked_in -> active -> eod_due -> clocked_out
                       \-> paused
```

The model must record the scheduled shift, actual clock-in/out timestamps, timezone, source, and any late/extended-session acknowledgement. Make clock-in and clock-out idempotent. Prevent two active sessions for the same employee.

Schedule time determines when a shift is expected; it must never falsely claim the employee clocked in.

### 3. Clock-in planning flow

When David clocks in, assemble a My Day plan from:

- Incomplete or overdue Nifty tasks assigned to him.
- Tasks carried over from the previous workday.
- Tasks due today.
- Existing blockers and dependencies.
- A free-form employee plan for new or changed priorities.

Allow David to select, reorder, defer, or propose removal of items from today's plan without deleting the underlying Nifty task. New work and task changes must enter the existing proposal/review flow. Deduplicate against existing Nifty tasks before proposing creation.

### 4. Progress and blocker capture

Support concise text updates for:

- Starting a task.
- Continuing work.
- Material progress.
- Completion claim.
- Blocked work.
- Priority change.
- Unplanned work.

Each update must preserve the employee's original statement and create structured, reviewable proposals. Completion remains a claim until an approved Nifty write occurs.

### 5. Shift-aware prompt contract

Define and test the server-owned prompt schedule contract:

- One plan prompt at clock-in.
- A first follow-up after a meaningful interval when a plan exists.
- Optional hourly fallback prompts when there has been no substantive response.
- Snooze support.
- Suppression during breaks and the final hour.
- Transition to `eod_due` 5–10 minutes before scheduled shift end.
- No normal progress prompt after clock-out.

The server must remain authoritative for the next prompt. Desktop notifications are a delivery mechanism, not the scheduling source of truth.

### 6. Desktop My Day experience

Update the desktop UI to clearly show:

- Current clock state and actual session time.
- Today's agreed plan.
- Carry-over and overdue tasks.
- Current task and blockers.
- Pending Nifty proposals.
- Next expected check-in.
- Nifty freshness or provider failure.
- Clock-out and EOD readiness.

The UI must work offline using the existing queue and reconcile idempotently when connectivity returns.

### 7. API, database, and audit contracts

Add additive migrations and typed APIs for sessions and daily plans. Preserve organization/person RLS boundaries. Every state transition and external proposal must be auditable. Do not place service-role credentials in the desktop client.

Document observed state separately from inferred state. For example, `clocked_in_at` is observed; “actively working” is inferred unless backed by an employee update or approved evidence.

## Verification

Add or extend tests for:

- Migration replay and constraints.
- RLS isolation.
- Clock-in/out idempotency.
- Duplicate active-session prevention.
- Timezones and overnight shifts.
- Breaks, leave, changed shifts, and extended sessions.
- Carry-over task selection and deduplication.
- Prompt suppression in the final hour.
- Offline update replay.
- No direct Nifty mutation before employee approval.
- Desktop scenario presets for every session state.

Run the Work OS typecheck/test suites and the desktop build using the absolute WSL toolchain. If a live web deployment is required, use `redeploy`, never a standalone live-server build.

## Definition of done

Phase 1 is complete only when all of the following are demonstrated end-to-end for David:

1. His role, schedule, team, manager, and privacy preferences are represented and readable from onboarding.
2. He can explicitly clock in exactly once and recover the session after restarting the app.
3. My Day shows current and carried-over Nifty tasks with provider freshness.
4. He can confirm a plan and submit progress/blocker updates offline or online.
5. Proposed Nifty changes are reviewable and no provider write occurs before approval.
6. Normal check-ins stop in the final hour and the session transitions to EOD mode.
7. He can clock out, and a second device or process cannot create a conflicting active session.
8. Automated tests cover the state machine, access controls, scheduling boundaries, and task proposal safety.
9. A Windows runtime smoke test confirms the installed app performs the full flow without a terminal window.

Do not report completion from a successful build alone. Include exact runtime evidence, what remains open, and any external dependency.

## Needed to proceed that is not already available in `.env.local`

No additional secret is required to implement and locally test the Phase 1 core. The current `.env.local` already contains Supabase, Nifty, OpenAI, Worktivity, and provider-encryption credentials.

The following non-secret product/configuration inputs are still required:

- David's authoritative working days, timezone, shift start/end, and break policy.
- David's manager/reviewer identity and team assignment.
- The initial software-engineer responsibility statement and definition-of-done examples.
- The Nifty projects, milestone/status groups, and member ID that belong in the pilot.
- A decision on whether clock-in is manual only or may also be suggested by schedule/activity. It must remain explicit unless policy says otherwise.
- A decision on late clock-in, overtime, missed clock-out, and leave behavior.
- A Windows user session for final native acceptance.

Production signing is not required to complete functional Phase 1 development. If Phase 1 must be distributed as a trusted signed installer, the GitHub/release secret store—not `.env.local`—must provide `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `TAURI_UPDATER_PUBLIC_KEY`, `WINDOWS_CERTIFICATE_BASE64`, and `WINDOWS_CERTIFICATE_PASSWORD`.
