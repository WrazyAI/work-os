# Admin Otto Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins receive and hear employee-reviewed recaps and retrieve employee work records by name through the existing companion.

**Architecture:** Keep employee `/me` behavior intact and add an admin-authorized read adapter around existing Work OS services. Persist reviewed recap versions and subscription epochs transactionally, materialize a per-admin inbox, and reuse the current audio/player UI with correction-aware identities. Admin context and transient delivery are coordinated across windows, separate from the personal workday.

**Tech Stack:** Existing TypeScript, Next.js Node routes, PostgreSQL via `pg`, React/Vite/Tauri, TanStack Query, existing structured AI request helpers and fal recap speech. No new model SDK, external MCP server, package installation, queue service or provider account.

**Spec:** `docs/superpowers/specs/2026-10-21-admin-otto-design.md` (approved Oct 21, 2026).

## Global Constraints

- Notify admins **only after the employee confirms or corrects a recap**.
- Playback means **audio narration of that reviewed recap**, not screenshot/video replay.
- Each admin follows **all employees by default**; Selected with zero IDs means none, not All.
- Employee records are read-only in admin chat for this delivery; no employee impersonation, writes, messaging, report approval or arbitrary host execution.
- Windows/macOS installed companion first; no new web chat or external MCP server.
- Admin operation must not require an employee mapping; employee personal requirements remain unchanged.
- Audio starts only on Listen; no arrival autoplay, focus theft, or chat auto-expansion.
- Poll one paged inbox feed every **60 seconds** while the companion process is running, even if its main window is hidden, plus reconnect/focus refresh.
- Inbox retains **30 days of reviewed-event arrivals**, paged by **12**; explicit older-history requests stay possible under normal retention.
- Task pages default to **50**, bounded at **100**, sorted before pagination; record requests span at most **31 local days**, default seven local days.
- Actor + organization + mode isolate conversations/cache/audio; team data never enters the personal offline cache.
- Use additive migrations, native Linux Node, linked existing dependencies and dedicated task worktrees; preserve unrelated work and compare Agent OS shared content before porting.
- Read all current `design.md`, current changelog and relevant `node_modules/next/dist/docs/` guides before implementation; retain semantic tokens, shared mascot, focus/keyboard/reduced-motion contracts.
- Every implementation task includes its tests in `npm run work-os:test` (explicit file list) or companion Vitest discovery; static source guards supplement, never replace, execution tests.

## Review Focus

1. Two decisions/pref saves racing in different DB transactions must not skip an arrival because a sequence was allocated before commit (Tasks 2–4).
2. A correction during slow or cached audio preparation must never play stale inference as reviewed truth; demotion during synthesis must deny bytes (Task 7).
3. Follow none, unfollow/refollow, temporary inactivity and revoked-then-restored access must not resurrect alerts from the suppressed period (Tasks 3–4).
4. Employee names shared across organizations, multiple assignees, or UTC/DST boundaries must not leak scope, duplicate tasks, or mislabel yesterday (Tasks 5–6).
5. Simultaneous main/avatar windows, a sleeping device and crash-after-display must yield a recoverable inbox without double audio, toast storms or mixed personal/team history (Tasks 8–10).

---

## Execution setup and dependency map

This is one dependent feature, not independent projects. Run Tasks 1–4 in order;
Tasks 5–6 then provide queries; Task 7 uses reviewed versions; Tasks 8–10 assemble
the companion and settings; Task 11 verifies and releases the whole flow. Do not
ship half-wired notifications as a separate release. Parallel work is optional
only after interfaces are committed and files do not overlap.

Use a new worktree from then-current `origin/main` for implementation and the
Nifty outcome ledger, not a shared checkout. Resolve the installed Linux Node
and link root/companion dependencies from a verified existing worktree; no
`npm install`. Planning ran no runtime tests and is not a green build baseline.
Before editing, run root typecheck/tests and companion `tsc --noEmit`/Vitest;
record inherited failures rather than silently attributing them to this plan.

`0063` is the next unused Work OS migration at planning baseline `010a96cd`.
Recheck both remotes before adding it; if taken, renumber this migration and its
test references together. Never replay historical migrations on an established DB.
Read the installed Next routing/server-handler guides when implementing routes.

At release, current `main` had already taken `0063_work_agent_access.sql` and
`0064_work_agent_day_event_cursor.sql`; this batch is therefore
`0065_work_admin_otto.sql`, and test helpers/deploy commands use 0065.

### File map (responsibility, not a broad refactor)

| File(s) | Responsibility |
| --- | --- |
| `src/modules/work-os/admin-otto/contracts.ts` (new) | Browser-safe versioned wire types; server and companion import these types. |
| `src/lib/work-os-admin-otto-access.ts` (new) | Authoritative admin companion access and request revalidation. |
| `src/app/api/work-os/desktop/{authorize,session}/route.ts`, `src/lib/work-os-desktop-auth.ts` | Allow unmapped admins through existing secure PKCE/session flow without altering employee requirements. |
| `supabase/migrations/0065_work_admin_otto.sql` (new; renumbered from 0063 at release) | Reviewed event/clock, subscription windows, inbox delivery and ephemeral conversation schema; scoped lifecycle triggers. |
| `src/lib/work-os-reviewed-recaps.ts` (new), existing activity-interval decision route/module | One atomic employee review and immutable reviewed script/version. |
| `src/lib/work-os-admin-otto-preferences.ts` (new) | Initialize/default/follow modes, eligibility epochs and optimistic saves. |
| `src/lib/work-os-admin-otto-inbox.ts` (new) | Bounded materialization, current-visibility projection, personal read/dismiss and lease-based delivery. |
| `src/modules/work-os/admin-task-model.ts` (new), `src/lib/work-os-admin-otto-reads.ts` (new) | Shared effective dates/order and sanitized org-scoped task/record/directory reads. |
| `src/lib/work-os-admin-otto-intent.ts`, `src/lib/work-os-admin-otto-chat.ts` (new) | Bounded structured read intent, name resolution, server-owned context and deterministic result cards. |
| `src/lib/work-os-admin-otto-speech.ts` (new), `src/lib/work-os-recap-speech.ts` | Reviewed-only audio guard, version-keyed cache, bounded synthesis; keep employee path unchanged. |
| `src/app/api/work-os/admin/otto/**/route.ts` (new) | Thin authorized transport adapters, listed per task below. |
| `desktop/work-os-companion/src/adminOtto/{api,mode,delivery,queryKeys,audioOwner}.ts` (new) | Typed API, window context synchronization, single delivery/audio ownership, nonpersisted admin query keys. |
| `desktop/work-os-companion/src/adminOtto/{AdminOttoChat,AdminRecapInbox,AdminRecapView,AdminOttoSettings}.tsx` (new) | Shared bounded admin surfaces and personal following controls. |
| Existing `App.tsx`, `AvatarApp.tsx`, `admin/AdminWorkspace.tsx`, `admin/SettingsPage.tsx`, `PersonalSettings.tsx`, playback/fixture modules | Thin integration points; do not add another large inline admin subsystem. |
| `test/work-os-admin-otto-*.test.mts`, companion `src/adminOtto/*.test.ts[x]` (new) | Executable service/route/concurrency/model/render tests, not just source-text matching. |
| `scripts/verify-admin-otto.mts` (new, Task 11) | Explicitly authorized disposable-fixture live acceptance and safe cleanup. |

## Shared contracts (Task 1 owns their definition)

All exports below live in `src/modules/work-os/admin-otto/contracts.ts`; companion
uses type-only imports from the same source, never imports server libraries.

```ts
type OttoScope = { userId: string; organizationId: string; mode: "admin" | "employee" };
type PersonRef = { id: string; displayName: string; active: boolean; timezone: string };
type Target = { kind: "team" } | { kind: "names"; names: string[] } | { kind: "ids"; ids: string[] };
type Resolution = { kind: "resolved"; people: PersonRef[] }
  | { kind: "missing"; name: string }
  | { kind: "ambiguous"; name: string; choices: PersonRef[] };
type Page<T> = { items: T[]; nextCursor: string | null; total: number; asOf: string; coverage: string[] };
type SpeechLine = { text: string; time: string | null };
type ReviewedRecap = {
  intervalId: string; eventId: string; person: PersonRef; reviewVersion: number;
  reviewKey: string; sourceRevision: number; scriptHash: string;
  reviewStatus: "confirmed" | "amended"; reviewedAt: string;
  windowStart: string; windowEnd: string; timezone: string;
  original: { headline: string; detail: string; activities: string[] };
  employeeFeedback: string | null; speechLines: SpeechLine[]; coverage: string[];
};
type FollowSettings = { mode: "all" | "selected"; personIds: string[]; revision: number; activated: boolean };
type InboxItem = { deliveryId: string; recap: ReviewedRecap; seenAt: string | null; listenedAt: string | null };
type InboxPage = Page<InboxItem> & { unread: number; catchupPending: boolean };
type DeliveryLease = { token: string; expiresAt: string; eventIds: string[]; pendingCount: number };
type TaskCard = {
  id: string; title: string; assignees: PersonRef[]; parentId: string | null;
  createdDate: string | null; effectiveDueDate: string | null;
  status: "open" | "overdue"; recordUrl: string;
};
type LocalWindow = { personId: string; timezone: string; from: string; through: string };
type WorkRecord = { id: string; personId: string; source: "update" | "submitted_eod" | "task" | "reviewed_recap" | "workday";
  occurredAt: string | null; localDate: string; text: string; recordUrl: string };
type ReadIntent = { action: "unfinished" | "records" | "recaps" | "read_recap" | "workday";
  target: Target; date: string | null; from: string | null; through: string | null;
  relativeDay: "today" | "yesterday" | null; overdueOnly: boolean; latest: boolean };
type AdminRead = { kind: "tasks"; page: Page<TaskCard>; people: PersonRef[] }
  | { kind: "records"; page: Page<WorkRecord>; windows: LocalWindow[] }
  | { kind: "recaps"; page: Page<ReviewedRecap> }
  | { kind: "recap"; recap: ReviewedRecap }
  | { kind: "resolution"; resolution: Exclude<Resolution, {kind: "resolved"}> };
type ChatRequest = { conversationId: string | null; requestId: string; text: string;
  choicePersonId?: string; continuation?: string };
type ChatResult = { conversationId: string; turnId: string; reply: string; result: AdminRead | null;
  contextVersion: number; errorCode?: "unsupported" | "ambiguous" | "missing" };
```

IDs and cursors are opaque strings. `reviewKey` is server-issued and binds org,
interval, review version and script hash; versions never reuse an old value.
APIs return `{schemaVersion: 1, ...payload}` and `Cache-Control: no-store`.
No types contain tokens, provider payloads, SQL, storage paths or raw screenshots.

### Task 1: Authorize admin context without employee impersonation

**Files:** Create contracts and `src/lib/work-os-admin-otto-access.ts`; modify desktop authorize/session routes; create `src/app/api/work-os/admin/otto/context/route.ts`; test `test/work-os-admin-otto-access.test.mts`; register root test in `package.json`.

**Interfaces:** `requireAdminOttoAccess(req: Request, capability?: "read" | "voice"): Promise<{access: WorkOsAccess} | {response: NextResponse}>`; `revalidateAdminOttoAccess(req: Request, expected: OttoScope): Promise<WorkOsAccess>`; POST context returns `{schemaVersion:1, scope:OttoScope, personId:string|null, voiceAvailable:boolean, transcriptionAvailable:boolean}`. No activation side effect until Task 3's initializer.

- [ ] **Step 1 — Write failing executable tests:** `unmapped_admin_can_bootstrap_without_person_writes`, `employee_and_manager_cannot_use_admin_context`, `cross_org_header_and_expired_token_are_denied`, `employee_desktop_still_requires_person`. Assert admin context makes zero `work_people` inserts and employee `/me` access remains 409 without a mapping.
- [ ] **Step 2 — Run red:** `node --import tsx --test test/work-os-admin-otto-access.test.mts`; expect missing helper/route failure, not a broken test harness.
- [ ] **Step 3 — Implement the helper/contracts and context handler:** use current authoritative membership/bearer resolver with admin role and existing `employee_companion` gate, never `requirePerson`; voice adds existing `voice_input`. Desktop auth/session retain existing `desktop_companion`, PKCE/origin/expiry checks, but require a person only for non-admin callers. Do not auto-enable flags. Include both absent/mapped-person admin cases in authorization tests.
- [ ] **Step 4 — Run green:** run Step 2 plus existing desktop/session route contracts and `npm run work-os:typecheck`; all new tests and unchanged employee tests pass.
- [ ] **Step 5 — Commit:** stage only this task's named files and root test registration; `git commit -m "feat(work-os): add admin Otto access context"`.

### Task 2: Atomically publish correction-safe reviewed recap versions

**Files:** Create migration `0065_work_admin_otto.sql` (review/clock schema first), `src/lib/work-os-reviewed-recaps.ts`; modify `src/lib/work-os-activity-intervals.ts` and employee decision route; tests `test/work-os-admin-otto-reviews.test.mts` and `test/work-os-admin-otto-db.test.mts`.

**Interfaces:** `decideReviewedRecap(access: WorkOsAccess, intervalId:string, input:{action:"confirm"|"amend";feedback?:string;expectedReviewVersion?:number}): Promise<ActivityIntervalRecord>`; `buildReviewedRecap(row: ActivityIntervalRecord, version:number, eventId:string, person:PersonRef): ReviewedRecap`; `loadReviewedRecap(access:WorkOsAccess, intervalId:string): Promise<ReviewedRecap|null>`. Existing `decideActivityInterval` delegates and keeps its return type; its HTTP body gains optional `expectedReviewVersion`.

**Schema:** `work_admin_otto_clock(organization_id PK, sequence bigint NOT NULL)` and `work_recap_reviews(id uuid PK, organization_id, interval_id, person_id, version int, event_sequence bigint, review_key text, source_revision int, content_hash text, script_hash text, payload jsonb, reviewed_at timestamptz)`. Unique `(organization_id,interval_id,version)` and `(organization_id,event_sequence)`; indexed `(organization_id,event_sequence)` and `(organization_id,interval_id,version DESC)`. Keep immutable versions; compare to the immediately previous hash, not a globally unique hash (A→B→A must yield three versions).

Add `arrival_eligible boolean NOT NULL`: lazy historical snapshots are false;
new employee decisions are true. Materialization never notifies from false
rows. All new tables use organization-scoped composite references where they
link people, memberships, intervals and events; no caller-selected cross-org
relationship can be stored. Revoke PUBLIC access; use the existing server DB
role only, with API/service checks on every read. No anonymous client writes.

- [ ] **Step 1 — Write failing tests:** `inferred_or_rolled_back_review_emits_nothing`, `confirm_retry_emits_one_version`, `amend_changes_key_even_if_generation_revision_is_same`, `review_A_B_A_allocates_three_versions`, `concurrent_stale_decision_conflicts`. Assert no check-in/session/task writes and original inference unchanged. PGlite runs the actual migration SQL; a two-connection PostgreSQL fixture tests commit order/row-lock behavior directly, not PGlite-only mocks.
- [ ] **Step 2 — Run red:** `node --import tsx --test test/work-os-admin-otto-reviews.test.mts test/work-os-admin-otto-db.test.mts`; expect missing schema/service, with transactional test fixture provided explicitly and no production DB fallback.
- [ ] **Step 3 — Implement review transaction:** get one `pg` client from `getPool`, BEGIN, lock/increment the organization clock row, then lock/load interval with org+person ownership, compare expected version, update review and append immutable event plus audit, COMMIT; rollback/release on errors. Use the clock row lock until COMMIT for review and later preference/lifecycle transactions; bare BIGSERIAL allocation is not commit order. Do not perform speech, fan-out or network work in this transaction. Keep the existing `after` next-step generation outside it.
- [ ] **Step 4 — Implement canonical projection:** confirmed script reuses current lead/activity line assembly; amended script visibly/speakably labels `Original AI summary.` then original lead/activities and `Employee correction.` then feedback, using exactly stored words and existing time extraction. Hash source identity, review state, feedback and script. Never read retained original claims without these labels after correction. For old clients without expected version, repeated identical decision is idempotent; a conflicting change to an already-reviewed interval returns 409/reload rather than overwriting unseen corrections. New clients send expected version, allowing deliberate later edits.
- [ ] **Step 5 — Run green:** Step 2 and existing activity-interval/next-step tests; exercise rollback and concurrent commits on disposable PostgreSQL with assertions `secondSequence > firstSequence` in actual commit order. Ensure migrating does not emit historic notifications; old reviewed rows get a deterministic lazy version-1 snapshot on explicit read, without publishing an arrival. First new review after that snapshot starts version 2.
- [ ] **Step 6 — Commit:** `git commit -m "feat(work-os): record immutable reviewed recap events"` after staging exact files/test registration.

### Task 3: Persist per-admin following and eligibility lifecycles

**Files:** Extend migration 0063; create `src/lib/work-os-admin-otto-preferences.ts`; create `src/app/api/work-os/admin/otto/preferences/route.ts`; update POST context; test `test/work-os-admin-otto-preferences.test.mts` and DB integration tests.

**Interfaces:** `initializeAdminOtto(access:WorkOsAccess):Promise<FollowSettings>`; `getAdminOttoPreferences(access:WorkOsAccess):Promise<FollowSettings>`; `saveAdminOttoPreferences(access:WorkOsAccess,input:{mode:"all"|"selected";personIds:string[];expectedRevision:number}):Promise<FollowSettings>`. GET preferences has no first-use activation; explicit POST context activates, PUT preferences saves with optimistic conflict detection.

**Schema:** `work_admin_otto_preferences(organization_id, membership_id, mode, selected_person_ids uuid[], revision int, access_epoch int, activated_sequence bigint NULL, active bool, PRIMARY KEY(organization_id,membership_id))`; `work_admin_otto_follow_windows(organization_id,membership_id,person_id,access_epoch,start_sequence bigint,end_sequence bigint NULL)` with at most one open window per person/member. Store IDs, never roster names; preserve inactive selected IDs for display/resumption. All default mode computes roster from org-scoped active `work_people` (including mapped admins who have employee records).

- [ ] **Step 1 — Write failing tests:** `defaults_all_and_includes_new_active_people`, `explicit_empty_means_none`, `preferences_are_personal_and_org_bound`, `refollow_opens_fresh_window`, `reactivation_preserves_choice_without_backfill`, `role_or_feature_reenable_gets_fresh_epoch`, `stale_pref_save_conflicts`. Interleave review commits and follow saves on two DB connections; events must use windows at commit, not materialization time.
- [ ] **Step 2 — Run red:** `node --import tsx --test test/work-os-admin-otto-preferences.test.mts test/work-os-admin-otto-db.test.mts`; expect absent preference APIs/schema.
- [ ] **Step 3 — Implement initializer/save:** acquire the same org clock first, activate only on first admin POST context, open eligible person windows at that sequence, validate submitted IDs against this org (accept previously selected inactive IDs unchanged, reject new foreign/missing choices), preserve All vs Selected-none and revision. A normal reconnect retains epoch; disabled-access recovery opens a new one.
- [ ] **Step 4 — Implement narrow DB lifecycle triggers:** on relevant `work_org_members` role/active/feature changes, `work_organizations` effective feature changes, and `work_people` active/insert transitions, advance the org clock and close/open windows/reset activation as required. Effective capability uses merged org/member flags; a member override must not be mistaken for an org-wide disable. Trigger only on relevant columns, never every `ui_state` save. Serialize these changes before review transactions observe them; use the same lock acquisition ordering and test for deadlocks. Membership restored or disabled feature restored waits for POST context to reactivate, retaining choices. Employee reactivation opens fresh eligible person windows without replaying inactive-period events.
- [ ] **Step 5 — Run green:** Step 2 plus existing membership/profile tests; database assertions prove new hire handling for All/Selected, no historical arrivals at first activation and no replay after inactivity. A directory failure must not save Selected-none.
- [ ] **Step 6 — Commit:** `git commit -m "feat(work-os): add personal admin Otto follows"` with exact files/test registration.

### Task 4: Materialize the durable inbox and coordinate transient delivery

**Files:** Extend migration 0063; create `src/lib/work-os-admin-otto-inbox.ts`; routes `admin/otto/inbox/route.ts`, `inbox/claim/route.ts`, `inbox/state/route.ts`; tests `test/work-os-admin-otto-inbox.test.mts` and DB integration.

**Interfaces:** `listAdminRecapInbox(access, input:{cursor?:string;limit?:number}):Promise<InboxPage>`; `claimAdminRecapDelivery(access,input:{deviceId:string;windowId:string}):Promise<DeliveryLease|null>`; `updateAdminRecapDelivery(access,input:{eventIds:string[];action:"presented"|"seen"|"listened"|"dismissed"|"release";leaseToken?:string}):Promise<void>`. All `access` arguments are `WorkOsAccess`. GET inbox lists, POST claim claims, PUT state acknowledges/persists. Claim/ack only operate on deliveries owned by this membership/org.

**Schema:** `work_admin_otto_deliveries(organization_id,membership_id,event_id,seen_at,listened_at,dismissed_at,presented_at,superseded_at,lease_token,lease_until,device_id,window_id,PRIMARY KEY(organization_id,membership_id,event_id))`; add `materialized_through_sequence bigint` to preferences. Partial index on unpresented eligible entries. Lease fields are nullable and must not reach other recipients. No recipient fan-out inside employee review transaction.

- [ ] **Step 1 — Write failing tests:** `late_materialization_uses_event_time_follow_window`, `same_timestamp_events_not_skipped`, `ascending_catchup_does_not_skip_page_two`, `superseded_versions_collapse_before_delivery`, `only_one_device_claims`, `expired_claim_recoverable`, `thirty_day_age_uses_review_commit_not_interval_date`, `unfollow_or_role_loss_hides_pending`. Assert seen is not listened, dismiss affects only that item/admin, and denied GET cannot consume a cursor or acknowledge delivery.
- [ ] **Step 2 — Run red:** `node --import tsx --test test/work-os-admin-otto-inbox.test.mts test/work-os-admin-otto-db.test.mts`.
- [ ] **Step 3 — Implement bounded materialization:** per-admin lock, process retained review events in ascending committed sequence, 100 at a time, insert eligible deliveries with ON CONFLICT no-op, then advance `materialized_through_sequence` atomically only through that processed batch. Use historical windows + access epoch; recheck current permission/follow/active person before projecting. Return `catchupPending` until caught up. An event excluded by policy can advance the cursor; an error cannot. Paginate visible inbox newest sequence first, default 12/max 100, no raw image data.
- [ ] **Step 4 — Implement delivery lease:** atomically claim up to 100 currently eligible unpresented events for 30 seconds with server random token; scope all updates and reject foreign/expired tokens. Present one counted bubble per batch, acknowledge only after the surface/OS API accepts presentation; release on close, expiry allows retry. Suppress duplicate toasts after successful ack; document possible repeat on crash before ack, not exactly-once UI claims. Inbox unread remains separate from transient delivery. No toast for events older than 30 days by reviewed commit time.
- [ ] **Step 5 — Run green:** Step 2 including real two-device contention, crash/reclaim, more than 100 arrivals and correction-before-presentation; assert full retained eligible set eventually materializes, only one active lease per event, and no state is lost by a failed poll.
- [ ] **Step 6 — Commit:** `git commit -m "feat(work-os): add reviewed recap inbox and delivery leases"` with exact files/test registration.

### Task 5: Resolve names and read complete, correctly scoped work records

**Files:** Create `src/modules/work-os/admin-task-model.ts`, `src/lib/work-os-admin-otto-reads.ts`; modify `desktop/.../src/admin/TasksPage.tsx` and `src/app/api/work-os/tasks/route.ts` only to use shared date/status/query semantics; routes `admin/otto/people/route.ts`, `tasks/route.ts`, `records/route.ts`, `recaps/route.ts`, `recaps/[intervalId]/route.ts`; tests `test/work-os-admin-otto-reads.test.mts`, companion existing task-sort tests.

**Interfaces:** `resolveAdminOttoPeople(access:WorkOsAccess,target:Target):Promise<Resolution>`; `listAdminOttoTasks(access,input:{personIds:string[]|null;overdueOnly:boolean;cursor?:string;limit?:number;now:Date}):Promise<Page<TaskCard>>`; `listAdminOttoRecords(access,input:{windows:LocalWindow[];cursor?:string}):Promise<Page<WorkRecord>>`; `listAdminOttoRecaps(access,input:{windows:LocalWindow[];latest:boolean;cursor?:string}):Promise<Page<ReviewedRecap>>`; `adminTaskDates(row:Record<string,unknown>):{createdDate:string|null;effectiveDueDate:string|null}`. `null` task person set means team, never an empty set; `[]` returns no rows.

- [ ] **Step 1 — Write failing tests:** `unique_full_or_partial_name_resolves`, `ambiguous_name_waits`, `foreign_id_rejected_even_with_same_name`, `multi_assignee_union_is_distinct`, `old_open_tasks_survive_date_default`, `effective_due_count_matches_rendered_overdue`, `server_sort_precedes_pagination`, `dst_and_yesterday_use_each_person_timezone`, `private_chat_memory_and_draft_reports_excluded`. Seed >100 tasks, nullable/malformed dates, inherited parent links and tombstones; assert page union and exact filtered total, not capped counts.
- [ ] **Step 2 — Run red:** `node --import tsx --test test/work-os-admin-otto-reads.test.mts`; missing readers/types, not provider failure.
- [ ] **Step 3 — Implement org-scoped safe reads:** directory projects only PersonRef; names are parameterized/literal search with unique exact-first resolution. Use canonical local task/assignee authority, including existing validated historical attribution rules, without live Nifty calls or capped in-memory per-person merges. Add bounded SQL union/query in the shared service where current helper cannot provide org+multi-person+exact total; qualify every table/record by organization. Projection strips `raw`, integrations, credentials and storage fields. Prefer one distinct task selection; do not load provider backup as separate task truth.
  GET people returns `Page<PersonRef>`, max 100 per request; server-side Target resolution searches the complete authorized roster rather than the first directory page. All new state-changing cookie-authenticated routes retain the current expected-origin protections; bearer routes retain the native-origin/CORS contract and never accept a request-header organization as authority.
- [ ] **Step 4 — Share admin date/order rules:** recorded provider-created calendar date then local created; due = recorded due else created + one calendar day. Sort all rows by created day DESC NULLS LAST, updated instant DESC NULLS LAST, effective due DESC NULLS LAST, casefolded title then id ASC before keyset page. Cursor binds org/person filter, timezone window and order; tampering or reusing for another filter returns 400. Counts use the same predicates/attribution as rows. Preserve existing column toggles and employee due-order behavior.
- [ ] **Step 5 — Implement bounded record/recap projections:** seven local days unless explicit, today/yesterday per person's timezone, max 31-day request and continuation. Include authored updates, submitted EOD snapshots, canonical task events and reviewed recaps; workday reads are display-only and never call attendance observe/clock operations. Latest reviewed recap queries all retained reviewed history, not just 30-day inbox. Lazily snapshot old reviewed records as in Task 2 without issuing arrival. Add exact org-scoped detail lookup for source destinations; inferred or inaccessible recap requests return unavailable, never synthesize.
- [ ] **Step 6 — Run green:** Step 2, existing root attribution/pagination/admin-count tests and companion task-sort tests; prove SQL row totals/status and UI helpers agree for derived due dates and Date-vs-string driver values.
- [ ] **Step 7 — Commit:** `git commit -m "feat(work-os): expose admin employee-name work queries"` with exact files/test registration.

### Task 6: Route admin chat into a bounded read-only tool catalog

**Files:** Create `src/lib/work-os-admin-otto-intent.ts`, `src/lib/work-os-admin-otto-chat.ts`, route `admin/otto/chat/route.ts`; extend migration 0063 for conversation rows; use existing `src/lib/work-os-ai-model.ts` helpers without changing employee model behavior; test `test/work-os-admin-otto-chat.test.mts`.

**Interfaces:** `parseAdminOttoIntent(text:string, context:{people:PersonRef[];lastIntent:ReadIntent|null}):Promise<ReadIntent|null>`; `executeAdminOttoChat(access:WorkOsAccess,input:ChatRequest):Promise<ChatResult>`. The bounded directory passed to parsing is only for currently resolved context, not an entire company/private-memory dump; unresolved names remain names for the server resolver. `continueAdminOttoRead(access,token:string):Promise<AdminRead>` is internal and takes an opaque server-issued cursor binding conversation and filters.

**Schema:** `work_admin_otto_threads(id uuid PK,organization_id,membership_id,context_version int,last_intent jsonb,resolved_person_ids uuid[],pending_resolution jsonb,created_at,updated_at)` and `work_admin_otto_turns(id uuid PK,thread_id,organization_id,membership_id,request_id uuid,role,text,source_refs jsonb,created_at)` with per-thread request idempotency. Store last 24 short text turns in a response, validate source refs on rehydration; do not persist complete team-result JSON in personal work-conversation tables or client vault. Old turns expire after 30 days; scope/role loss forbids reading them.

- [ ] **Step 1 — Write failing tests:** `five_approved_requests_execute_real_reads`, `their_overdue_ones_preserves_resolved_targets`, `team_is_not_follow_list`, `forged_choice_or_continuation_denied`, `injected_employee_text_cannot_request_writes`, `repeat_request_id_does_not_add_turns`, `context_version_rejects_stale_window_reply`. Assert no employee proposal endpoint, private conversation store, arbitrary SQL, messaging or host runner calls.
- [ ] **Step 2 — Run red:** `node --import tsx --test test/work-os-admin-otto-chat.test.mts` with injected intent-parser and service fakes (deterministic assertions); no billed model call in unit tests.
- [ ] **Step 3 — Implement strict intent parser:** use the existing structured AI request builder/model/timeout/usage helper; allow exactly the five ReadIntent actions and bounded input (4,000 chars), names (up to 20) and at most 24 prior short turns. Validate every field server-side. No mutation enum/URL/SQL arguments. Unsupported requests produce an honest read-only explanation, not a fabricated action. Model outage returns retry with preserved draft. Task 11 exercises the actual model with the five approved utterances.
- [ ] **Step 4 — Implement runner/context:** derive identity from access, resolve all requested people before any read, persist pending ambiguity and validate choice against it. Subsequent pronouns use server-owned last resolved set; explicit new targets replace it and are named in reply. Result cards and record links come directly from typed service output; generate short deterministic replies from totals/provenance, not ungrounded prose. A Listen intent returns recap, never autoplay. Recheck permissions before returning any long-running result; return stale-context conflict instead of overwriting a newer thread context.
- [ ] **Step 5 — Run green:** Step 2 + existing employee interpreter/proposal tests; verify model hallucinated IDs cannot change scope and no named request silently substitutes an admin's own workday.
- [ ] **Step 6 — Commit:** `git commit -m "feat(work-os): add scoped read-only admin Otto chat"` with exact files/test registration.

### Task 7: Serve reviewed audio with stale-version and permission protection

**Files:** Create `src/lib/work-os-admin-otto-speech.ts`, routes `admin/otto/recaps/[intervalId]/speech/route.ts` and `admin/otto/transcribe/route.ts`; narrowly extend existing recap-speech cache namespace; test `test/work-os-admin-otto-speech.test.mts`.

**Interfaces:** `handleAdminRecapSpeech(req:Request,intervalId:string,deps?:AdminSpeechDeps):Promise<NextResponse>`; request `{reviewKey:string,voice:string}`; bytes + existing `x-work-os-recap-lines`, new `x-work-os-recap-review-key`, `x-work-os-recap-script-hash`. Stale key returns 409 `{reason:"review_changed",recap:ReviewedRecap}`, never silently plays a new version. `AdminSpeechDeps` supplies authorize, loadReviewed, revalidate, synthesize and atomic quota leases for tests. New cache API `speakReviewedRecap(input:{organizationId:string;intervalId:string;reviewKey:string;scriptHash:string;voice:string;lines:SpeechLine[]}):Promise<RecapSpeechResult>`; leave `speakRecap` employee signature intact.

- [ ] **Step 1 — Write failing tests:** `unreviewed_and_foreign_recap_never_synthesized`, `amended_words_and_labels_match_prompter`, `same_generation_revision_new_review_cache_miss`, `correction_during_synthesis_returns_conflict`, `role_revoked_during_cache_or_synthesis_denies_audio`, `arbitrary_client_text_rejected`, `voice_disabled_keeps_text_available`, `quota_is_shared_across_processes`. Assert no provider URL/key in response.
- [ ] **Step 2 — Run red:** `node --import tsx --test test/work-os-admin-otto-speech.test.mts test/work-os-recap-speech.test.mts`.
- [ ] **Step 3 — Implement speech wrapper:** authorize admin+voice, load current reviewed version, compare key, validate current script hash, then cache/synthesize only canonical stored lines. Reauthorize and reload version before serving either cached or newly generated bytes. Cache namespace includes organization/review key/script/voice; bound to 32 successful clips and dedupe in-flight identical synthesis. 6,000-character limit, 60-second synthesis and bounded 15-second clip-download timeout; no generic arbitrary-text speech endpoint. Do not warm clips on inbox polls.
  Add the two new reviewed-audio headers to Work OS's existing desktop CORS exposed-header list in `src/proxy.ts` without changing matcher/body-buffering rules; test both ordinary response and preflight from the packaged desktop origin. On Agent OS port only this allow-list change, never replace its proxy with Work OS's variant.
- [ ] **Step 4 — Implement shared quota lease and transcription adapter:** add ephemeral per-member speech lease/rate records in migration 0063; max 2 active synthesis leases, each 90 seconds, max 10 synthesis starts per rolling minute; cached hits do not consume starts. Return 429 + Retry-After. Admin transcription uses existing upload/read/transcribe helpers and current size/duration limits with admin+voice authorization, no person requirement, no audio retention, and no changes to employee route requirements. Actor flags, not target employee voice preferences, gate playback.
  Name the records `work_admin_otto_speech_leases(id,organization_id,membership_id,expires_at,released_at)` and `work_admin_otto_speech_starts(id,organization_id,membership_id,started_at)`; serialize quota admission per membership and prune starts older than the rolling minute. Export `claimAdminSpeechSlot(access:WorkOsAccess):Promise<{token:string;release():Promise<void>}>`, release in finally and recover by expiry after process failure. Use DB-clock time, not client time.
- [ ] **Step 5 — Run green:** Step 2, existing employee voice tests; two simultaneous server clients prove quotas/lease expiry; fixture logs assert original employee cache key doesn't collide with admin audio.
- [ ] **Step 6 — Commit:** `git commit -m "feat(work-os): add reviewed admin recap narration"` with exact files/test registration.

### Task 8: Add separate admin companion context and cross-window ownership

**Files:** Create companion `src/adminOtto/{api,mode,queryKeys,delivery}.ts` and tests; modify `App.tsx`, `AvatarApp.tsx`, session types and desktop auth/boot seams only where necessary; modify native event/command ACL files only if required for targeted window coordination.

**Interfaces:** `adminOttoKeys(scope:OttoScope):{context:QueryKey;inbox(cursor?:string):QueryKey;preferences:QueryKey}` with `['work-os','admin','otto',organizationId,userId,...]`; `createOttoModeController(deps):{snapshot():{scope:OttoScope;epoch:number};switchMode(mode):Promise<void>;dispose():void}`; `startAdminRecapDelivery(deps:{scope:OttoScope;deviceId:string;windowId:string;...typed API/event callbacks}):()=>void`. API adapter uses `/admin/otto`, typed payloads, Bearer and no disk persistence. Keep all concrete callback signatures in module-exported dependency types and tests; no anonymous bus carrying arbitrary team records.

- [ ] **Step 1 — Write failing tests:** `unmapped_admin_boot_does_not_fetch_me_day_or_onboarding`, `mode_switch_aborts_and_clears_old_results`, `admin_keys_never_persist`, `two_windows_share_context_epoch`, `hidden_main_polls_every_60000`, `sleep_reconnect_drains_pages_once`, `cross_account_stale_response_ignored`. Fake timers must assert poll count, cancellation and no hidden-window pause inherited from Overview.
- [ ] **Step 2 — Run red:** from companion run `node_modules/.bin/vitest run src/adminOtto/mode.test.ts src/adminOtto/delivery.test.ts`; expect missing controllers/adapter.
- [ ] **Step 3 — Implement mode and boot integration:** main window reads authoritative session/context before choosing personal bootstrap; unmapped admin skips `/me/day`/onboarding. Main and avatar exchange only scope+epoch and record IDs using `work-os://otto-context-changed` and `work-os://admin-otto-changed`; token and team result bodies never broadcast. A mode switch cancels speech/mic/network and removes previous result state, but preserves pending personal reminders in their own state. Main New chat routes to shared admin thread. Refresh/admin queries remain in-memory only.
- [ ] **Step 4 — Implement transport/delivery loop:** avatar is normal process-local notification owner, with main fallback when avatar unavailable; server Task 4 leases arbitrate across devices. Poll at 60 seconds plus focus/reconnect and drain catch-up without overlapping requests; back off failed/offline attempts to 60/120/240/300 seconds, reset on success. Coalesce a drain into one counted arrival without auto-opening; hidden-window OS notification uses generic count/title, not recap text. Release claims on shutdown if possible; expiry is recovery when close cannot run. Acknowledge after successful present; denied OS permission leaves in-app inbox available.
  While personal mode is selected, retain team inbox/unread state but do not replace its employee prompt with a team bubble or consume the pending team's presentation acknowledgement; present the grouped arrival when Administration mode returns.
- [ ] **Step 5 — Run green:** Step 2 plus companion cache/session/boot tests; native ACL and root companion guard tests if new commands/events are introduced. Assert scope switch stops playback, while plain minimize/expand in the same scope does not.
- [ ] **Step 6 — Commit:** `git commit -m "feat(companion): isolate admin Otto context and delivery"` with exact files/tests.

### Task 9: Reuse chat, recap and audio surfaces for admins

**Files:** Create `src/adminOtto/{AdminOttoChat,AdminRecapInbox,AdminRecapView}.tsx` and render/controller tests; integrate `App.tsx`, `AvatarApp.tsx`, `admin/AdminWorkspace.tsx`, current shared chat/recap/player modules and fixture boot. Create scoped `src/adminOtto/adminOtto.css` only for genuinely new layout, not copies of shared chat chrome.

**Interfaces:** `AdminOttoChat(props:{scope:OttoScope;conversationId:string|null;onOpenRecord:(url:string)=>void;onListen:(recap:ReviewedRecap)=>void}):ReactElement`; `AdminRecapInbox(props:{scope:OttoScope;onOpenRecap:(recap:ReviewedRecap)=>void;onListen:(recap:ReviewedRecap)=>void}):ReactElement`; `AdminRecapView(props:{recap:ReviewedRecap;onListen:(recap:ReviewedRecap)=>void;onOpenRecord:(url:string)=>void}):ReactElement`. Components call Task 8's typed adapter, never employee proposal/decision functions. Navigation accepts server-generated same-app record URLs from the read catalog only, not arbitrary model URLs. Add an admin recap focus target rather than a fake EOD report ID. Playback client extends the existing player input/result with optional `reviewKey`, uses admin speech only in admin mode, retains employee path unchanged.

- [ ] **Step 1 — Write failing tests:** `chat_and_recaps_are_admin_peer_tabs`, `single_arrival_offers_listen_and_view`, `multiple_arrivals_offer_counted_inbox`, `admin_view_has_no_employee_confirm_controls`, `loading_slow_cancel_retry_match_existing_player`, `stale_key_refresh_requires_explicit_listen`, `starting_mic_stops_audio_and_vice_versa`, `new_arrival_does_not_steal_focus_or_scroll`. Also assert employee personal recap flow renders unchanged.
- [ ] **Step 2 — Run red:** companion `node_modules/.bin/vitest run src/adminOtto/AdminOttoChat.render.test.ts src/adminOtto/AdminRecapInbox.render.test.ts src/adminOtto/AdminRecapView.render.test.ts`.
- [ ] **Step 3 — Implement shared read-only surfaces:** admin header and Chat/Recaps tabs use existing peer-tab keyboard contract; inbox appends 12 behind explicit Load more and server total; refreshing retains records. Recap labels Confirmed by employee/Corrected by employee, original/correction sections match Task 2 speech lines. Task results include names, inherited parent details and true page totals, with exact record links. No timer/employee shift control in admin presentation; no empty placeholder mistaken for failure.
- [ ] **Step 4 — Integrate single audio owner across windows:** create `audioOwner.ts` with `requestOttoAudio(scope:OttoScope,epoch:number,kind:"speech"|"recording"):Promise<{token:string;release():void}>`; the persistent main window is the single broker, including while hidden. Tauri request/revoke/grant events carry scope+epoch+window ID+request token only. Broker revokes the old owner, waits for its stopped acknowledgement, then grants exactly one queued request; stale acknowledgements are ignored. A 2-second stop/broker timeout fails the new request rather than granting overlapping audio; window-destroyed releases ownership. Test simultaneous starts, not merely sequential start/stop. Use current audio element/player, selected listener voice, bounded prompter and cancellation; adapt review key separately from numeric generation revision. Never mark listened until actual audio ends; Stop/cancel is not listened. Scope/session changes release clips and prevent late provider response playback.
- [ ] **Step 5 — Run green and rendered QA:** Step 2/full companion suite; token-free admin fixtures at 1440/1024/720/390, both themes, 200% zoom, text+mascot sizes, keyboard/Escape/focus return, empty/dense/offline/permission/slow/stale/error cases and reduced motion. Inspect screenshots and exercise controls; browser stub proves rendering, not live audio.
- [ ] **Step 6 — Commit:** `git commit -m "feat(companion): add admin recap inbox and read-only chat"` with exact files/tests.

### Task 10: Add personal follow settings without changing workspace permissions

**Files:** Create `src/adminOtto/AdminOttoSettings.tsx` and tests; integrate `PersonalSettings.tsx`, `admin/SettingsPage.tsx` and App settings slot; extend fixture roster/preferences routes. Keep settings and device voice preferences distinct.

**Interfaces:** `AdminOttoSettings({scope:OttoScope}):ReactElement`; typed Task 8 GET/PUT preferences adapter, directory pagination and query invalidation. The group owns unsaved draft, only saves on Save; expectedRevision prevents overwriting another device's newer choices.

- [ ] **Step 1 — Write failing tests:** `all_is_default_for_unmapped_admin`, `selected_none_says_no_alerts`, `failed_directory_not_empty`, `inactive_saved_choice_shown_but_disabled`, `save_error_preserves_draft`, `other_device_revision_conflict_requires_reload`, `follow_filter_does_not_limit_named_queries`.
- [ ] **Step 2 — Run red:** companion `node_modules/.bin/vitest run src/adminOtto/AdminOttoSettings.render.test.ts`.
- [ ] **Step 3 — Implement group:** two-column shared Setting anatomy, All/Selected radio choice, labelled searchable checklist and Save; clearly state choices affect recap alerts, not access. Show inactive saved choices and field-level failure/retry. Successful save re-fetches server state, invalidates followed inbox and signals other window by IDs/context, not shared global settings. Selected-none remains stable after restart and on another device. Group is present in admin personal settings even with no mapped employee day.
- [ ] **Step 4 — Run green and screenshot settings:** Step 2/full companion, narrow/keyboard/overlay states; exercise two admin accounts independently. Update current guide steps/film only if the added group changes the guide's described steps; use the existing offline-film tooling, not live account footage.
- [ ] **Step 5 — Commit:** `git commit -m "feat(companion): add per-admin employee follow settings"` with exact files/tests.

### Task 11: Verify the complete path, converge deliberately, then release

**Files:** Create `scripts/verify-admin-otto.mts`, disposable fixture setup/cleanup helpers and reusable TestSprite plans; modify `design.md` with implemented contracts, changelog and synchronized release metadata only after verified integration. No bulk tree copy to Agent OS.

**Interfaces:** verification script has explicit `--apply` for fixture writes, `--cleanup`, `--organization-id`, and fixture identifier inputs; dry run is default. It reads credentials from existing private/VPS config only, redacts logs, refuses production users/non-fixture orgs and verifies resolved database host before any write. Exit success means its assertions ran, not merely a backend harness accepted Python text.

- [ ] **Step 1 — Write acceptance assertions first:** disposable employee + two admins (one unmapped), same-name foreign-org employee, All vs Selected-none. Confirm then amend a real fixture recap, assert one reviewed event per meaningful version, correct personalized feed, withheld inferred recaps, name query exact task records, and old cached audio key denied after correction. Include >100 arrivals, two-device lease contention, revoke/restore access and deactivate/reactivate employee without suppressed-event replay.
- [ ] **Step 2 — Verify red against pre-feature/stub fixture:** assert missing admin route or feature state causes a real failed assertion; no destructive writes to establish red. Register reusable TestSprite frontend/backend scenarios on existing projects without running setup or changing shared credentials silently.
- [ ] **Step 3 — Run complete local checks:** root `npm run work-os:typecheck`, `npm run work-os:test`; companion `node_modules/.bin/tsc --noEmit`, `node_modules/.bin/vitest run`, `npm run build`. Root `npm run build` in the worktree/staging tree only, never the running service's `.next`. Run actual DB fixture integration and direct assertions in addition to TestSprite backend validation. Record baseline vs introduced failures.
- [ ] **Step 4 — One batch CodeRabbit review:** `coderabbit review --agent --base-commit <implementation-batch-base>`; inspect/fix valid scope/correctness/delivery findings. If CLI/quota/auth unavailable, record exact blocker and leave the review/release gate pending rather than claiming reviewed. Rerun only after material surface changes.
- [ ] **Step 5 — Stage deployment safely:** compare every changed shared path with latest `agentos/main`, preserve its shell/unique files and carefully reconcile the existing person-auto-mapping divergence so pure admins don't gain fake employee records. Apply only additive migration 0063 (or its collision-safe replacement) against verified intended host, then verified atomic VPS redeploy. No unrestricted engine handoff. Record both content commit identities and live build identity; a checked-out SHA alone does not identify the running compiled bundle.
- [ ] **Step 6 — Run live controlled acceptance:** use fixture script with explicit authorization; TestSprite existing Work OS Companion/API projects; two actual admin sessions receive only reviewed followed events. Exercise actual model name resolution, authorized speech bytes, playable audio and correction-after-cache. Report generation latency separately. Verify native Windows and macOS audible playback, CORS/preflight, background/hidden-main delivery, scope switch, reconnect and single sound owner. Missing native environment/provider/fixture permissions remain explicit external blockers.
- [ ] **Step 7 — Release only after acceptance:** update implemented `design.md` contract and plain changelog bullets, synchronize package.json/package-lock root versions, Tauri conf/Cargo.toml and companion-only Cargo.lock version. Rebase latest main, push verified integration, release via existing workflow and verify published installers/updater signatures/assets. Do not select a version number from this planning baseline; main is shared and moves.
- [ ] **Step 8 — Cleanup and handoff:** remove only disposable fixture data/resources created for this test, verify cleanup, finish ledger subtasks as actual outcomes land, stop owned servers, remove merged worktrees. Handoff actual tested flows, provider/native gaps and any external dependency; do not say a subprocess exit proves playback.

## Self-review (planning evidence, not feature acceptance)

- [x] Spec coverage mapped: user decisions → Tasks 2/3/5/7/9/10; explicit context/unmapped access → 1/8; durable events/epochs/delivery → 2–4; history/limits/timezones → 5/6; no employee impersonation → 1/6/9; UI/audio/keyboard/partial states → 7–10; final live/convergence/release evidence → 11.
- [x] Step scan: every task has a named failing-test step, red command, concrete implementation boundary, green evidence and scoped commit; release task separates verification from external writes.
- [x] Type consistency: shared contracts own ReadIntent/Resolution/ReviewedRecap/Page/ChatResult; generation revision and reviewed key are deliberately different; team sentinel is null, never an empty people set.
- [x] Review Focus cases have owning-task tests, including actual two-connection DB races and correction while audio is pending.
- [x] Scope/proportion: one dependent feature; no product code, new SDK, generic agent server, write-capable admin tools or web-chat redesign included.

Plan status: ready for user review and execution-method confirmation. No product
code, migration execution, TTS request, native run or deployment performed while
writing this plan. Availability of the production provider, disposable live-test
permissions, native devices and CodeRabbit must be checked during execution.
