# Task Overflow Actions and Manual Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give employees and administrators a permission-aware ellipsis menu and side-panel lifecycle actions on desktop-companion task surfaces, record who assigned each task, and add a manual Pending / In progress workflow status with derived Overdue.

**Architecture:** One additive migration adds `workflow_status` and `assigned_by_person_id` to `work_tasks`. A pure capability module is the single source of truth for the permission matrix, imported by both the server and the companion UI. Server routes enforce capabilities and attach a `capabilities` object to task payloads. The companion renders only permitted menu items; the dashboard queue gains a menu, the employee drawer and administration drawer gain lifecycle/status/assignment actions.

**Tech Stack:** Next.js route handlers, Neon Postgres via `src/lib/supabase/admin`, TypeScript, React 19, TanStack Query, Vitest (companion), `node:test` (server), Tauri desktop companion.

**Spec:** `docs/superpowers/specs/2026-10-27-task-actions-and-manual-status-design.md`

## Global Constraints

- Web surfaces (`src/modules/work-os/employee/EmployeeTasks.tsx`, `src/modules/work-os/admin/AdminTasks.tsx`, `AdminTasks.tsx`) are out of scope; do not restyle or extend them.
- Status vocabulary on companion task pills: `Pending`, `In progress`, `Overdue`, `Done`. "Open" stays the collective noun in counts and copy.
- Overdue is always derived from `due_date < currentDate` for incomplete tasks; never store an overdue status.
- Completing or reopening a task never changes `workflow_status`.
- A status change is refused while overdue; the due date must move first.
- Permanent deletion always asks for confirmation; archiving is reversible and labelled so.
- Every mutation is organization-scoped and capability-checked server-side. UI capability flags never replace the server check.
- New task rows are `workflow_status = 'pending'` and record the creator as `assigned_by_person_id`.
- Companion tests: `cd desktop/work-os-companion && npx vitest run <file>`. Server tests: `node --import tsx --test <file>`. Typecheck: `npm run work-os:typecheck`.

## Review Focus

- A legacy task with exactly one recorded assignee keeps that assignee's
  current edit/archive/delete control through the 0065 backfill; a null
  assigner (any other legacy row) is administrator-only for management, and the
  assignee keeps only completion and status. Both cases need a test.
- An assignee of an assigned task must be refused edit/archive/delete/assign, while complete/reopen still work.
- A manager may only assign within their managed teams; a forged person id must fail before any write.
- An overdue task displays Overdue even when `workflow_status = 'in_progress'`, and its status control is disabled for everyone until the due date moves.
- Reopening a task after its due date passed must display Overdue, not the stored status.
- Completing a parent task still cascades to open subtasks, and capability checks apply to the parent the caller acted on.
- Unknown `workflow_status` values are rejected with a 400, never stored.
- Menu and drawer actions must remain keyboard reachable, close on Escape/outside press, and never change row height.

---

### Task 1: Status and assignment model with the pure permission core

**Files:**
- Create: `supabase/migrations/0066_work_task_assignment_and_status.sql`
- Create: `src/lib/work-os-task-permissions.ts`
- Create: `test/work-os-task-permissions.test.mts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export type TaskWorkflowStatus = "pending" | "in_progress";`
  - `export type TaskDisplayState = "pending" | "in_progress" | "overdue" | "complete";`
  - `export type TaskActor = { role: "admin" | "manager" | "employee"; personId: string | null };`
  - `export type TaskCapabilities = { canEdit: boolean; canArchive: boolean; canDelete: boolean; canAssign: boolean; canComplete: boolean; canReopen: boolean; canChangeStatus: boolean; canMove: boolean; statusLocked: boolean; overdue: boolean };`
  - `export function isWorkflowStatus(value: unknown): value is TaskWorkflowStatus;`
  - `export function taskAssignerId(task: Record<string, any>): string | null;`
  - `export function taskIsOverdue(task: Record<string, any>, today: string): boolean;`
  - `export function taskDisplayState(task: Record<string, any>, today: string): TaskDisplayState;`
  - `export function taskCapabilities(task: Record<string, any>, actor: TaskActor, today: string): TaskCapabilities;`

- [ ] **Step 1: Write the failing tests**

Create `test/work-os-task-permissions.test.mts`. Cover:

```ts
const assigned = { assignee_person_ids: ["employee"], assigned_by_person_id: "manager", completed: false, due_date: "2026-10-27" };
const selfOwned = { assignee_person_ids: ["employee"], assigned_by_person_id: "employee", completed: false, due_date: "2026-10-27" };
const legacy = { assignee_person_ids: ["employee"], assigned_by_person_id: null, completed: false, due_date: "2026-10-27" };
```

Assertions:
- admin on `assigned`: every capability true except `canChangeStatus`/`statusLocked` semantics below.
- manager (assigner) on `assigned`: `canEdit`, `canArchive`, `canDelete`, `canAssign`, `canChangeStatus` true; `canComplete`, `canReopen` false.
- employee (assignee) on `assigned`: `canComplete` true, `canChangeStatus` true, `canEdit`/`canArchive`/`canDelete`/`canAssign` false.
- employee on `selfOwned`: `canEdit`, `canArchive`, `canDelete`, `canAssign`, `canComplete`, `canChangeStatus` true.
- employee on `legacy` (`assigned_by_person_id: null`): `canEdit`, `canArchive`, `canDelete`, `canAssign` false (null assigner is admin-only; only the single-assignee backfill preserves legacy control); `canComplete`/`canChangeStatus` true.
- overdue task `{ due_date: "2026-10-26" }` with today `"2026-10-27"`: `overdue` true, `statusLocked` true, `canChangeStatus` false for admin, assigner, and assignee; `canComplete` stays true for the assignee.
- `taskDisplayState`: complete wins over everything; overdue wins over `in_progress`; then `in_progress`; then `pending`.
- `isWorkflowStatus("in_progress")` true; `isWorkflowStatus("done")` false; `taskAssignerId({ assigned_by_person_id: "p1" })` returns `"p1"`.
- Migration contract: read the SQL file and assert it adds both columns, defaults `workflow_status` to `'pending'`, constrains it to `('pending','in_progress')`, backfills `assigned_by_person_id` from a single-element `assignee_person_ids`, and adds the `(organization_id, assigned_by_person_id)` index.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test test/work-os-task-permissions.test.mts`
Expected: FAIL — module not found / migration missing.

- [ ] **Step 3: Write the migration**

`0066_work_task_assignment_and_status.sql`:

```sql
alter table public.work_tasks
  add column if not exists workflow_status text not null default 'pending'
    check (workflow_status in ('pending', 'in_progress')),
  add column if not exists assigned_by_person_id uuid references public.work_people (id) on delete set null;

update public.work_tasks
set assigned_by_person_id = assignee_person_ids[1]
where assigned_by_person_id is null
  and coalesce(array_length(assignee_person_ids, 1), 0) = 1;

create index if not exists work_tasks_assigned_by_idx
  on public.work_tasks (organization_id, assigned_by_person_id);
```

No backfill sets `workflow_status` for existing in-progress work: every existing open task becomes Pending, which is the truthful default.

- [ ] **Step 4: Implement the pure module**

`src/lib/work-os-task-permissions.ts` must import nothing. Implement:
- `isWorkflowStatus` as a two-value check.
- `taskIsOverdue`: false when `completed === true`; compare the `YYYY-MM-DD` prefix of `due_date` (reuse a local regex; do not import date helpers) against `today`; malformed/missing dates are not overdue.
- `taskDisplayState`: complete → `overdue` → `in_progress` → `pending`.
- `taskAssignerId`: the string `assigned_by_person_id`, else `null`.
- `taskCapabilities` implementing the matrix in the spec. `statusLocked` is `!completed && overdue`; `canChangeStatus` is `!statusLocked && (admin || isAssigner || isAssignee)`; `canComplete` is `!completed && (admin || isAssignee)`; `canReopen` is `completed && (admin || isAssignee)`; `canEdit`/`canArchive`/`canDelete`/`canAssign` are `admin || isAssigner`; `canMove` equals `canEdit`. A null assigner means there is no assigner: only an administrator manages the task, and its assignees keep completion/reopen and status. There is no null-assigner fallback (the 0065 single-assignee backfill already preserves legacy single-assignee control).

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --import tsx --test test/work-os-task-permissions.test.mts`
Expected: PASS, all subtests.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0066_work_task_assignment_and_status.sql src/lib/work-os-task-permissions.ts test/work-os-task-permissions.test.mts
git commit -m "feat(work-os): add task assignment provenance and workflow status"
```

---

### Task 2: Employee task API enforcement and scoped assignment

**Files:**
- Modify: `src/lib/work-os-api.ts` (add `WorkOsForbiddenError`, mapped to 403 by `jsonError`)
- Modify: `src/lib/work-os-task-assignees.ts` (add `scopedAssignableTaskPeople`)
- Modify: `src/lib/work-os-local-tasks.ts` (`assignedByPersonId` input, insert both new fields)
- Modify: `src/lib/work-os-employee-tasks.ts` (creation options scope, update/status/complete/archive/delete/move gates)
- Modify: `src/app/api/work-os/me/tasks/[taskId]/route.ts` (`workflow_status` branch)
- Modify: `test/work-os-task-assignees.test.mts`
- Create: `test/work-os-task-actions.test.mts`

**Interfaces:**
- Consumes: `taskCapabilities`, `taskIsOverdue`, `isWorkflowStatus` from Task 1.
- Produces:
  - `export class WorkOsForbiddenError extends Error` (name `WorkOsForbiddenError`), `jsonError` returns `403`.
  - `export function scopedAssignableTaskPeople<T extends { id: string }>(people: T[], allowedPersonIds: string[] | null): T[]` — `null` returns everyone.
  - `CreateLocalWorkOsTaskInput.assignedByPersonId?: string | null`.
  - `export async function updateWorkOsEmployeeTaskStatus(access: WorkOsAccess, taskId: string, status: unknown): Promise<{ task: Json; providerStatus: string }>`.
  - `export async function employeeTaskToday(access: WorkOsAccess, personId: string): Promise<string>` in `src/lib/work-os-employee-tasks.ts` — shift timezone's local date.

- [ ] **Step 1: Write the failing tests**

`test/work-os-task-actions.test.mts`:
- `scopedAssignableTaskPeople`: `null` keeps all four people; `["employee"]` keeps only that person; an empty array keeps none.
- Source contracts (read files with `readFileSync`):
  - `src/lib/work-os-employee-tasks.ts` calls `taskCapabilities(` and throws `WorkOsForbiddenError` in `updateWorkOsEmployeeTask`, `updateWorkOsEmployeeTaskStatus`, `setWorkOsEmployeeTaskCompletion`, `archiveWorkOsEmployeeTask`, `deleteWorkOsEmployeeTask`, and `moveWorkOsEmployeeSubtask`.
  - `updateWorkOsEmployeeTaskStatus` contains `due_date_passed` and writes `workflow_status`.
  - `createLocalWorkOsTask` writes `assigned_by_person_id` and `workflow_status: "pending"`.
  - `getWorkOsTaskCreationOptions` calls `accessibleWorkOsPersonIds` and `scopedAssignableTaskPeople`.
  - `src/app/api/work-os/me/tasks/[taskId]/route.ts` calls `updateWorkOsEmployeeTaskStatus` and returns 400 for a malformed `workflow_status`.
  - `src/lib/work-os-api.ts` maps `WorkOsForbiddenError` to status 403.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test test/work-os-task-actions.test.mts`
Expected: FAIL — `scopedAssignableTaskPeople` is not exported.

- [ ] **Step 3: Add the forbidden error**

In `src/lib/work-os-api.ts`, define:

```ts
/** The caller can see the record but may not take this action. */
export class WorkOsForbiddenError extends Error {
  constructor(message = "You do not have permission to change this task") {
    super(message);
    this.name = "WorkOsForbiddenError";
  }
}
```

Map it in `jsonError` to `{ error: message }` with status 403, before the generic message branch.

- [ ] **Step 4: Scope assignment options**

Replace `filterAssignableTaskPeople` usage in `getWorkOsTaskCreationOptions` with:

```ts
const allowed = await accessibleWorkOsPersonIds(access);
const assignable = scopedAssignableTaskPeople(people, allowed);
```

`accessibleWorkOsPersonIds` returns `null` for admins (everyone), the manager's own person plus members of managed teams for managers, and `[self]` for employees. Remove `filterAssignableTaskPeople` from `work-os-task-assignees.ts` and replace its tests with `scopedAssignableTaskPeople` coverage; keep `attachTaskAssigneeIdentities` untouched.

- [ ] **Step 5: Write provenance and initial status on creation**

- `CreateLocalWorkOsTaskInput` gains `assignedByPersonId?: string | null`.
- `createLocalWorkOsTask` inserts `assigned_by_person_id: input.assignedByPersonId ?? access.personId ?? null` and `workflow_status: "pending"`.
- `createWorkOsEmployeeTask` passes `assignedByPersonId: access.personId`.
- Plan-materialized tasks (`createLocalTaskRow`) and admin-created tasks inherit the creator through `access.personId`.

- [ ] **Step 6: Enforce capabilities in the employee task library**

- `updateWorkOsEmployeeTask`: load task, compute `taskCapabilities(task, actor(access), await employeeTaskToday(...))`; throw `WorkOsForbiddenError` unless `canEdit`. Accept and persist `name`, `description`, `due_date`, `start_date`, `priority`, and `assignee_person_ids`. For an assignee change, require `canAssign`, validate against the scoped people list, and include `assigned_by_person_id: access.personId` in the update. Audit `task.assigned` when the set changes.
- `updateWorkOsEmployeeTaskStatus`: throw `WorkOsNotFoundError` for an invisible task; `WorkOsValidationError` for a value failing `isWorkflowStatus`; `WorkOsForbiddenError` when `canChangeStatus` is false; `WorkOsConflictError("Update the due date before changing this task's status", "due_date_passed")` when `statusLocked`. Persist `workflow_status` with `updateTask` and audit `task.status_changed`.
- `setWorkOsEmployeeTaskCompletion` (and `completeWorkOsTask`): require `canComplete` when completing and `canReopen` when reopening; admins bypass by role.
- `archiveWorkOsEmployeeTask` / `deleteWorkOsEmployeeTask`: require `canArchive` / `canDelete`.
- `moveWorkOsEmployeeSubtask`: require `canMove` on the subtask.
- Keep every refusal before the first write.

- [ ] **Step 7: Route the status change**

In `src/app/api/work-os/me/tasks/[taskId]/route.ts` PATCH, branch before the generic update:

```ts
if ("workflow_status" in body) return NextResponse.json(await updateWorkOsEmployeeTaskStatus(auth.access, taskId, body.workflow_status));
```

- [ ] **Step 8: Run the tests**

Run: `node --import tsx --test test/work-os-task-actions.test.mts test/work-os-task-assignees.test.mts test/work-os-task-permissions.test.mts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/work-os-api.ts src/lib/work-os-task-assignees.ts src/lib/work-os-local-tasks.ts src/lib/work-os-employee-tasks.ts src/app/api/work-os/me/tasks/[taskId]/route.ts test/work-os-task-assignees.test.mts test/work-os-task-actions.test.mts
git commit -m "feat(work-os): enforce task action permissions on employee routes"
```

---

### Task 3: Capability payloads and the administration task API

**Files:**
- Create: `src/lib/work-os-task-capabilities.ts`
- Create: `src/lib/work-os-task-admin.ts`
- Modify: `src/lib/work-os-tasks.ts` (`updateTask` accepts `workflow_status`)
- Modify: `src/app/api/work-os/me/tasks/route.ts`
- Modify: `src/app/api/work-os/me/tasks/[taskId]/route.ts`
- Modify: `src/lib/work-os-day-view.ts`
- Modify: `src/app/api/work-os/tasks/route.ts`
- Modify: `src/app/api/work-os/tasks/[taskId]/route.ts`
- Create: `test/work-os-task-capabilities.test.mts`

**Interfaces:**
- Consumes: Task 1 and Task 2 exports.
- Produces:
  - `export function withTaskCapabilities<T extends Record<string, any>>(tasks: T[], actor: TaskActor, today: string): Array<T & { capabilities: TaskCapabilities }>`
  - `export async function employeeToday(access: WorkOsAccess): Promise<string>` — shift timezone's local date, `null` person falls back to UTC.
  - `export async function updateWorkOsAdminTask(access: WorkOsAccess, taskId: string, body: Json): Promise<Json>`
  - `export async function removeWorkOsAdminTask(access: WorkOsAccess, taskId: string, mode: "archive" | "delete"): Promise<Json>`

- [ ] **Step 1: Write the failing tests**

`test/work-os-task-capabilities.test.mts`:
- Unit: `withTaskCapabilities` copies rows and appends `capabilities` computed by the shared pure helper, without mutating the input array.
- Source contracts:
  - `src/app/api/work-os/me/tasks/route.ts` decorates `tasks` in the `open`, `today`/`day`, `history`, and default branches, and returns `capabilities` in the detail route.
  - `src/lib/work-os-day-view.ts` decorates both `tasks` and `taskHistory`.
  - `src/app/api/work-os/tasks/route.ts` decorates the admin list.
  - `src/app/api/work-os/tasks/[taskId]/route.ts` decorates the detail and exports `DELETE` calling `removeWorkOsAdminTask`.
  - `updateWorkOsAdminTask` rejects an overdue status change with `due_date_passed`, routes `completed` through `completeWorkOsTask`, and records `assigned_by_person_id` when assignment changes.
  - `src/lib/work-os-tasks.ts` `updateTask` handles a `workflow_status` key.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test test/work-os-task-capabilities.test.mts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the capability seam**

`src/lib/work-os-task-capabilities.ts`:

```ts
import { loadShiftData } from "@/lib/work-os-internal";
import { localDateForTimezone } from "@/modules/work-os/companion";
import { taskCapabilities, type TaskActor, type TaskCapabilities } from "@/lib/work-os-task-permissions";
import type { WorkOsAccess } from "@/lib/work-os-api";

export function withTaskCapabilities<T extends Record<string, any>>(tasks: T[], actor: TaskActor, today: string) {
  return tasks.map((task) => ({ ...task, capabilities: taskCapabilities(task, actor, today) }));
}

export async function employeeToday(access: WorkOsAccess): Promise<string> { /* shift timezone or UTC */ }
```

`employeeToday` returns `localDateForTimezone(new Date(), timezone)` from `loadShiftData(access, access.personId, new Date())`; when `access.personId` is null it returns the UTC date.

- [ ] **Step 4: Decorate the employee payloads**

- `me/tasks` route: compute `const today = await employeeToday(auth.access)` once at the top; wrap every returned `tasks` array with `withTaskCapabilities(...)` and pass the actor `{ role: auth.access.role, personId: auth.access.personId }`.
- `me/tasks/[taskId]` detail: decorate `task` and `subtasks`.
- `work-os-day-view.ts`: decorate `workspace.tasks` and `taskHistory` with the resolved `shiftDate`.

- [ ] **Step 5: Add admin update/remove and decorate admin reads**

`src/lib/work-os-task-admin.ts`:
- `updateWorkOsAdminTask`: admin-only (the route already enforces `requireWorkOsAdmin`). Load the task; when `completed` is present route to `completeWorkOsTask`; when `workflow_status` is present validate, refuse overdue with `due_date_passed`, persist it; otherwise persist the editable fields through `updateTask`; when `assignee_person_ids` is present set `assigned_by_person_id` to `access.personId` and audit `task.assigned`.
- `removeWorkOsAdminTask`: delegate to `archiveWorkOsEmployeeTask`/`deleteWorkOsEmployeeTask` (admins pass the capability gate by role), and audit.

`src/app/api/work-os/tasks/[taskId]/route.ts`:
- GET decorates `task` and `subtasks` with capabilities.
- PATCH calls `updateWorkOsAdminTask` instead of `updateTask`.
- NEW `DELETE` reads `?mode=archive|delete`, defaults to `archive`, and calls `removeWorkOsAdminTask`.

`src/app/api/work-os/tasks/route.ts`: GET decorates the list with capabilities; POST returns a decorated task.

- [ ] **Step 6: Extend `updateTask`**

In `src/lib/work-os-tasks.ts`, add:

```ts
if ("workflow_status" in patch) {
  const status = patch.workflow_status;
  if (status !== "pending" && status !== "in_progress") throw new WorkOsValidationError("workflow_status must be pending or in_progress");
  row.workflow_status = status;
}
if ("assigned_by_person_id" in patch) row.assigned_by_person_id = nonEmptyString(patch.assigned_by_person_id);
```

Do not reset `workflow_status` in the `completed` branch; completion leaves the workflow status intact.

- [ ] **Step 7: Run the tests**

Run: `node --import tsx --test test/work-os-task-capabilities.test.mts test/work-os-task-actions.test.mts test/work-os-route-contracts.test.mts && npm run work-os:typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/work-os-task-capabilities.ts src/lib/work-os-task-admin.ts src/lib/work-os-tasks.ts src/app/api/work-os/me/tasks/route.ts src/app/api/work-os/me/tasks/[taskId]/route.ts src/lib/work-os-day-view.ts src/app/api/work-os/tasks/route.ts src/app/api/work-os/tasks/[taskId]/route.ts test/work-os-task-capabilities.test.mts
git commit -m "feat(work-os): expose task capabilities and admin lifecycle routes"
```

---

### Task 4: Companion row menus with permission-aware status actions

**Files:**
- Create: `desktop/work-os-companion/src/taskActions.ts`
- Create: `desktop/work-os-companion/src/taskActions.test.ts`
- Modify: `desktop/work-os-companion/src/taskWorkspace.ts`
- Modify: `desktop/work-os-companion/src/taskSurfaces.tsx` (export a `TaskActionMenuItems` component)
- Modify: `desktop/work-os-companion/src/DashboardSurface.tsx`
- Modify: `desktop/work-os-companion/src/App.tsx`
- Modify: `desktop/work-os-companion/src/TasksPreview.tsx`
- Modify: `desktop/work-os-companion/src/TodayPreview.tsx`

**Interfaces:**
- Consumes: `taskDisplayState` / `TaskCapabilities` from `../../../src/lib/work-os-task-permissions`.
- Produces:
  - `taskActions.ts`: `export type TaskMenuAction = "pending" | "in_progress" | "complete" | "reopen" | "edit" | "assign" | "archive" | "delete";`
  - `export function taskStatusLabel(state: TaskDisplayState): string` (`Pending`, `In progress`, `Overdue`, `Done`).
  - `export function taskActionItems(task, today): TaskMenuAction[]` — ordered, permission-driven, omitting forbidden actions.
  - `export function taskStatusOptions(task, today): Array<{ value: "pending" | "in_progress"; label: string; disabled: boolean; note?: string }>` — both options disabled when `capabilities.statusLocked`, with note `Update the due date first`.
  - `TaskActionMenuItems` props: `{ task: TaskRow; currentDate: string; busy: boolean; onStatus: (status: "pending" | "in_progress") => void; onComplete: (completed: boolean) => void; onEdit: () => void; onAssign?: () => void; onArchive: () => void; onDelete: () => void; onClose: () => void }`.
  - `DashboardSurfaceActions` gains `onEditTask?`, `onArchiveTask?`, `onDeleteTask?`, `onStatusTask?`, plus `currentDate: string` on `OffShiftDashboard`.

- [ ] **Step 1: Write the failing tests**

`taskActions.test.ts`:
- `taskStatusLabel` maps the four states to the exact labels.
- `taskActionItems` for an assignee: no `edit`/`assign`/`archive`/`delete`; includes `complete`, `pending`, `in_progress`.
- For an assigner: includes `edit`/`assign`/`archive`/`delete`; excludes `complete` unless also assignee.
- For an overdue task: no `pending`/`in_progress` items; `complete` remains.
- For an admin: every item; `reopen` replaces `complete` when completed.
- `taskStatusOptions` marks both values disabled for an overdue task with the due-date note.
- `taskState` in `taskWorkspace.ts` still returns `complete | overdue | open` for legacy callers; add and test `displayTaskState(task, today)` returning the four-state display value.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop/work-os-companion && npx vitest run src/taskActions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the action model**

Create `taskActions.ts` importing `taskDisplayState`, `taskCapabilities`, `type TaskCapabilities`, `type TaskDisplayState` from `../../../src/lib/work-os-task-permissions`. Export the four functions above. `taskActionItems` reads `task.capabilities` when present and otherwise computes capabilities from `{ role: "employee", personId: null }` — the fallback must never grant edit/archive/delete.

- [ ] **Step 4: Build the shared menu component**

In `taskSurfaces.tsx`, export `TaskActionMenuItems` that renders, in order:
1. `Pending` and `In progress` menu items (with a check mark on the active status), disabled when the capability or overdue lock forbids them.
2. `Mark task done` / `Reopen task`.
3. `Edit task`.
4. `Assign` (only rendered when `onAssign` is provided).
5. `Archive` with `<small>reversible</small>`.
6. `Delete permanently` with `className="danger"`.

Every item calls `onClose()` before its action. Add CSS only if an existing class cannot express the disabled state; prefer `[disabled]` and existing `.subtask-menu` styles.

- [ ] **Step 5: Replace the dashboard lifecycle menu and add the off-shift row menu**

- `App.tsx`: replace the body of `TaskLifecycleMenu` with `<TaskActionMenuItems ...>`; add `onStatusTask` wiring that PATCHes `/api/work-os/me/tasks/:id` with `{ workflow_status }` and invalidates day/task queries.
- `DashboardSurface.tsx`: add an ellipsis to `DashboardTaskRow` using `EllipsisMenu` + `TaskActionMenuItems`. `OffShiftDashboard` and `ActiveWorkdayDashboard` pass the new action props; render the trigger only when at least one action is available.
- The row's existing completion control stays; the menu is additive.

- [ ] **Step 6: Update previews and render tests**

- `TasksPreview.tsx` and `TodayPreview.tsx` provide the new callbacks (`onStatusTask`, `onEditTask`, `onArchiveTask`, `onDeleteTask`) as local state updates so the previews exercise the menu.
- Update `DashboardSurface.render.test.ts` to assert an "Actions for …" trigger on an off-shift dashboard task and assert the menu items render for an assigner and omit them for an assignee.
- Update `TasksPreview`-driven tests only if type errors surface.

- [ ] **Step 7: Run the tests**

Run: `cd desktop/work-os-companion && npx vitest run src/taskActions.test.ts src/DashboardSurface.render.test.ts src/tasksWorkspace.render.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/work-os-companion/src/taskActions.ts desktop/work-os-companion/src/taskActions.test.ts desktop/work-os-companion/src/taskWorkspace.ts desktop/work-os-companion/src/taskSurfaces.tsx desktop/work-os-companion/src/DashboardSurface.tsx desktop/work-os-companion/src/App.tsx desktop/work-os-companion/src/TasksPreview.tsx desktop/work-os-companion/src/TodayPreview.tsx desktop/work-os-companion/src/DashboardSurface.render.test.ts
git commit -m "feat(companion): add permission-aware task action menus"
```

---

### Task 5: Employee task side panel with lifecycle, status, and assignment

**Files:**
- Modify: `desktop/work-os-companion/src/taskSurfaces.tsx` (`TaskDetailsModal`, new `TaskDetailActions`)
- Modify: `desktop/work-os-companion/src/App.tsx` (drawer wiring, assignment options)
- Modify: `desktop/work-os-companion/src/TasksPreview.tsx`
- Create: `desktop/work-os-companion/src/TaskDetailsModal.render.test.ts` (if absent; extend if present)

**Interfaces:**
- Consumes: Task 4's action model and Task 2/3's API.
- Produces:
  - `TaskDetailsModal` new props: `assignablePeople?: Array<{ id: string; displayName: string; email: string | null }>; onAssign?: (personIds: string[]) => void; onStatus?: (status: "pending" | "in_progress") => void; onArchive?: () => void; onDelete?: () => void; onEditFields?: (fields: { name?: string; description?: string; due_date?: string | null }) => void;`.
  - `TaskDetailActions` component: status control, assignment control, and an overflow menu with archive/delete.
  - `TaskEditModal` gains `dueDate?: string` and `onDueDate?: (value: string) => void`; an empty value clears the due date. The assigner/admin needs this to resolve the overdue status lock from the companion. Keep the existing title/description contract.

- [ ] **Step 1: Write the failing render test**

`TaskDetailsModal.render.test.ts` renders `TaskDetailsModal` with a fixture whose `capabilities.canChangeStatus` is true and asserts:
- `Task status` control is present and shows the current label.
- `Archive task` and `Delete task` exist in an actions menu.
- An assignee fixture (`canEdit: false`, `canComplete: true`) does not render Edit/Archive/Delete and does render `Mark complete`.
- An overdue fixture renders the status control disabled and the copy `Update the due date first`.
- The edit modal renders a `Due` date input for a `canEdit` actor and its change calls `onDueDate`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop/work-os-companion && npx vitest run src/TaskDetailsModal.render.test.ts`
Expected: FAIL — missing controls.

- [ ] **Step 3: Add the drawer actions**

In `taskSurfaces.tsx`:
- `TaskDetailsModal` reads `task.capabilities` (fallback `{}`) and `taskDisplayState(task, currentDate)`.
- Replace the two-state `state` computation with the four-state display helper and label via `taskStatusLabel`.
- Add a `task-detail-actions` row under the breadcrumb: a status trigger with a menu of Pending / In progress (disabled per capability and overdue lock), and an overflow menu with Edit task, Archive task, Delete task. The footer keeps `Edit task` and `Mark complete` only for permitted actors.
- Add an assignee section: read-only `AssigneeTags` when `canAssign` is false; when true, a menu listing `assignablePeople` with check marks and an `Assign` confirmation, plus `Assigned by <name>` when `assignedBy` is present.
- Add the three callbacks to every existing render of `TaskDetailsModal` in `App.tsx` and `TasksPreview.tsx`; `onAssign` PATCHes `assignee_person_ids` and invalidates the detail/day queries.

- [ ] **Step 4: Verify the employee flows in the preview**

Run the Vite dev server and open `?preview-tasks&scenario=details`:
- with a self-owned fixture the drawer offers edit, status, assign, archive, delete;
- with an assignee-only fixture it offers complete/reopen and status but not edit/archive/delete;
- an overdue fixture disables the status control with the due-date note.

- [ ] **Step 5: Run the tests and typecheck**

Run: `cd desktop/work-os-companion && npx vitest run src/TaskDetailsModal.render.test.ts src/taskActions.test.ts && npm run build`
Expected: PASS and a clean build.

- [ ] **Step 6: Commit**

```bash
git add desktop/work-os-companion/src/taskSurfaces.tsx desktop/work-os-companion/src/App.tsx desktop/work-os-companion/src/TasksPreview.tsx desktop/work-os-companion/src/TaskDetailsModal.render.test.ts
git commit -m "feat(companion): add lifecycle and status actions to the task drawer"
```

---

### Task 6: Administration task record actions and drawer

**Files:**
- Modify: `desktop/work-os-companion/src/admin/data.ts` (`AdminTaskRow.capabilities`, update/delete API helpers)
- Modify: `desktop/work-os-companion/src/admin/TasksPage.tsx`
- Modify: `desktop/work-os-companion/src/admin/AdminPreview.tsx` (fixtures only if types require)
- Create: `desktop/work-os-companion/src/admin/adminTasksActions.render.test.ts`

**Interfaces:**
- Consumes: Task 4's `TaskActionMenuItems`, Task 3's capability payload, Task 2/3 endpoints.
- Produces:
  - `data.ts`: `export const updateAdminTask = (taskId, body) => send(`/api/work-os/tasks/${id}`, "PATCH", body)` and `export const deleteAdminTask = (taskId, mode) => send(`/api/work-os/tasks/${id}?mode=${mode}`, "DELETE")`.
  - `AdminTaskRow` includes `workflow_status?: string | null`, `assigned_by_person_id?: string | null`, and `capabilities?: TaskCapabilities`.
  - `TasksPage` row menu and drawer actions; an edit drawer with title, description, due date, priority, and assignee.

- [ ] **Step 1: Write the failing render test**

`adminTasksActions.render.test.ts` renders `TasksPage` with mocked query data (follow the existing `adminTasksSort.render.test.ts` harness) and asserts:
- Each row renders `aria-label="Actions for <title>"`.
- The menu includes `Pending`, `In progress`, `Edit task`, `Archive`, `Delete permanently`.
- A completed row shows `Reopen`.
- The drawer for a task shows `Task status`, `Assignee`, `Archive task`, and `Delete task`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop/work-os-companion && npx vitest run src/admin/adminTasksActions.render.test.ts`
Expected: FAIL — no trigger.

- [ ] **Step 3: Add the client mutations**

In `admin/data.ts`: add the two helpers, include the new fields in `normalizeTaskRow`, and pass through `capabilities`.

- [ ] **Step 4: Add the row menu**

In `TasksPage.tsx`, add a trailing actions cell (replace or append to the `Complete/Reopen` cell — keep that button and add the ellipsis beside it). Use `EllipsisMenu` and `TaskActionMenuItems`. Wire:
- status → `updateAdminTask(id, { workflow_status })`
- complete/reopen → the existing `complete` mutation
- edit/assign → open an edit drawer seeded from the row
- archive/delete → confirm, then `deleteAdminTask`, invalidating `adminKeys.tasks` and `adminKeys.taskDetails`.

- [ ] **Step 5: Extend the drawer**

The existing detail drawer gains:
- a status control (Pending / In progress, disabled when overdue with the due-date note),
- an assignee select populated from the people roster,
- `Edit task` opening the edit drawer,
- `Archive task` and `Delete task` with confirmation,
- `Assigned by <name>` when recorded.

- [ ] **Step 6: Run the tests**

Run: `cd desktop/work-os-companion && npx vitest run src/admin/adminTasksActions.render.test.ts src/admin/adminTasksSort.render.test.ts src/admin/AdminWorkspace.render.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/work-os-companion/src/admin/data.ts desktop/work-os-companion/src/admin/TasksPage.tsx desktop/work-os-companion/src/admin/adminTasksActions.render.test.ts
git commit -m "feat(companion): add admin task record actions"
```

---

### Task 7: Docs, changelog, and verification

**Files:**
- Modify: `design.md`
- Modify: `desktop/work-os-companion/CHANGELOG.md`
- Modify: `desktop/work-os-companion/src/styles.css` (only if Task 4/5/6 added a new class)
- Modify: `AGENTS.md` (only if a new invariant needs recording)

**Interfaces:**
- Consumes: all shipped behavior.
- Produces: no code interface.

- [ ] **Step 1: Update the design blueprint**

- §6.2: status vocabulary becomes Pending, In progress, Overdue, Done; overdue precedence stated; menu column contract.
- §6.5: the drawer includes lifecycle actions and the status control, and names the overdue lock.
- §8.3: the status submenu is a detached menu like every other menu.
- §16.2: the administration task row carries an action menu and the drawer carries status/assign/archive/delete.

- [ ] **Step 2: Add the changelog entries**

Under `## Unreleased`, one plain bullet per employee-visible change:
- `Tasks now have a quick actions menu in your task list and task details.`
- `You can mark a task In progress, and tasks past their due date stay Overdue until the date changes.`
- `Administrators can assign tasks and manage them from the organization task record.`

Do not bump versions; releases move entries when the build ships.

- [ ] **Step 3: Run the full affected suites**

```bash
npm run work-os:typecheck
npm run work-os:test
cd desktop/work-os-companion && npm run build && npx vitest run
```

Expected: clean typecheck, all server tests, companion build, and all Vitest suites pass.

- [ ] **Step 4: Render the three surfaces**

Start `cd desktop/work-os-companion && npx vite` and check:
- `?preview-today` at 984px, 760px, and 420px: ellipsis present, menu opens, rows do not change height, focus ring visible.
- `?preview-tasks&scenario=details`: drawer status/assign/archive/delete per capability; overdue lock copy.
- `?preview-admin`: admin row menu and drawer actions.

Capture screenshots and note any gap. TestSprite: if the companion project cannot target the local preview, record that in the final report rather than claiming a TestSprite run.

- [ ] **Step 5: Apply the migration to a disposable target first**

Resolve the migration target with `npm run db:apply -- supabase/migrations/0066_work_task_assignment_and_status.sql` only after confirming the printed host is the intended database. Verify the columns and the backfill count with a read-only query. Do not replay historical migrations.

- [ ] **Step 6: Commit**

```bash
git add design.md desktop/work-os-companion/CHANGELOG.md AGENTS.md desktop/work-os-companion/src/styles.css
git commit -m "docs(work-os): document task actions, assignment, and status"
```

---

## Self-review notes

- Spec coverage: assignment provenance (Tasks 1, 2, 3), permission matrix (1, 2, 3), status model and overdue lock (1–5), row menus (4, 6), drawer actions (5, 6), admin override (3, 6), legacy single-assignee backfill (1, 2), docs (7).
- The web surfaces are intentionally untouched per the spec's non-goal.
- `TaskStatus` naming: the stored column is `workflow_status`; the display helper is `taskDisplayState`; the legacy `taskState` remains for existing callers.
- Capability payloads are the only server/client contract; no client recomputes permissions from role alone.
