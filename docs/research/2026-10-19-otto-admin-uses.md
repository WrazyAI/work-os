# Floating Otto for administrators: source-grounded opportunities

Date: 2026-10-19. Research only; no product changes or deployment. Source tracing plus read-only live-service and aggregate database checks; no authenticated companion interaction.

Source baseline: Work OS `35d9af1d68df2c59baf58def7f6e4ea3d01afc92` on `codex/otto-admin-research`. Cross-repository comparison uses `agentos/main` at `230c045e784d9bb8d29672870ac2287d97b9f231`; the coordinator independently verified that revision in the deployment checkout, not the exact running compiled bundle. Nifty parent: `wk89zhZbJX`.

## Research checklist

- [x] Read all of `AGENTS.md` and `design.md` before interface inspection.
- [x] Trace floating and in-app chat, prompts, voice, schemas, and execution.
- [x] Distinguish employee, manager, admin, and unmapped-admin access.
- [x] Trace admin task, report, evidence, recap, insight, and health sources.
- [x] Compare relevant Agent OS source without convergence or product edits.
- [x] Rank uses and identify required permissions, provenance, and confirmations.
- [x] Coordinator added independently collected live-service and aggregate data evidence.

## Bottom line

**The strongest admin Otto is a small decision inbox and evidence-backed query shortcut, not an autonomous team manager.** Start with “What needs my decision?” and “Prepare this EOD review.” Add grounded teammate questions next; task delegation should follow only after explicitly connecting admin permissions and fixing transport gaps.

**Today, floating Otto does not become an organization assistant just because its user is an admin.** Both chat surfaces send to `/api/work-os/me/interpret`, which loads the signed-in person's tasks and optional personal day/memory context. Its output is a structured update interpretation, not a general tool-calling loop with admin API access. The independent administration UI has the richer organizational reads, but chat does not call them. Evidence: `desktop/work-os-companion/src/AvatarApp.tsx:1245-1289`; `desktop/work-os-companion/src/App.tsx:3254-3286`; `src/app/api/work-os/me/interpret/route.ts:18-52`; `src/lib/aiInterpret.ts:443-489`; `desktop/work-os-companion/src/admin/data.ts:131-153`.

All six ranked uses below are **proposed admin extensions**, not claims that they currently work through Otto. “Available” below means code exists at the cited baseline, not that a provider, feature flag, account mapping, or production deployment was verified.

## 1. What an admin actually gets through Otto now

### Floating window versus in-app launcher

- **Floating:** `AvatarApp` reads its day through `fetchDay`, whose transport is `/api/work-os/me/day`; it derives the person's shift, prompt, own task options, plan, report-submission signal, and voice availability from that response. No admin-overview query appears on this path. Sources: `desktop/work-os-companion/src/AvatarApp.tsx:343-359`; `desktop/work-os-companion/src/AvatarApp.tsx:445-500`; `desktop/work-os-companion/src/workOsQueries.ts:61-71`.
- **In-app desktop chat:** the launcher belongs to `renderWorkspace`; its dock is visible on My Day and current-day Tasks. The separate admin render mounts `AdminWorkspace` plus global overlays, not that composer; the admin sidebar's New chat callback is a no-op. Thus there is no wired admin-chat launcher in that desktop shell. Sources: `desktop/work-os-companion/src/App.tsx:3831-3859`; `desktop/work-os-companion/src/App.tsx:4233-4234`; `desktop/work-os-companion/src/admin/AdminWorkspace.tsx:108-121`.
- **Do not equate the desktop in-app chat with every web page.** The web administration frame mounts its section children, status, My Day link, sync, and refresh controls; it does not mount the desktop conversation launcher. Sources: `src/modules/work-os/admin/AdminFrame.tsx:17-20`; `src/modules/work-os/admin/AdminShell.tsx:68-107`; `src/modules/work-os/admin/AdminShell.tsx:134-153`.
- The source picker is not retrieval. Its `@` choices insert ordinary text and explicitly fetch/attach nothing; slash commands mostly preface text or invoke supplied navigation. An “Evidence” or “EOD review” menu label must not be treated as proof that chat receives the report/evidence record. Source: `desktop/work-os-companion/src/chat/core.ts:42-84`.

### Chat context and operation scope

The interpretation route requires `employee_companion` and a person mapping, but does **not** restrict the caller to the employee role. A mapped admin or manager can therefore reach the same person-scoped API when the feature is enabled; this is not team scope. The fetched task context is the person's tasks (up to 500 loaded, then ranked/capped to 300) reduced to ID, title, completion and status-column ID. Sources: `src/app/api/work-os/me/interpret/route.ts:18-52`; `src/lib/aiInterpret.ts:506-530`.

When Work Memory is enabled, the route supplies that person's live-day snapshot, eight recalled items and eight recent conversation turns; the snapshot contains own focus, selected/completed/deferred work, four substantive updates and session state. It does not retrieve the organization's review queue. Optional Loom analysis and blueprint descriptors are separate enrichment, not general integration access. Sources: `src/app/api/work-os/me/interpret/route.ts:42-92`; `src/lib/work-memory-today.ts:29-54`; `src/lib/work-memory-today.ts:58-94`; `src/lib/work-conversations.ts:128-152`.

The schema/catalog includes progress, blocker, completion/reopen, task creation/edit/archive/delete, subtasks, pending/overdue display, navigation, multi-task operations, reassignment and template import. Navigation is limited to employee destinations (`day`, `tasks`, `review`, `insights`, `evidence`, `settings`). The model is instructed to produce one or two short sentences and reviewable operations, not a long organizational analysis. Sources: `src/lib/aiInterpret.ts:82-86`; `src/lib/aiInterpret.ts:147-157`; `src/lib/aiInterpret.ts:405-431`.

Actual display operations immediately fetch **`/me/tasks`**, while mutations are persisted as proposals for later approval. Task references are allow-listed by the interpreter and then resolved against assignment or configured legacy-ledger attribution; proposal acceptance is organization-scoped and owner-only, even for admins. The old direct interpretation-apply route returns 410. Sources: `desktop/work-os-companion/src/AvatarApp.tsx:1263-1285`; `src/lib/aiInterpret.ts:257-266`; `src/lib/work-os-proposals.ts:678-709`; `src/lib/work-os-proposals.ts:837-853`; `src/lib/work-os-proposals.ts:1058-1077`; `src/app/api/work-os/me/interpret/apply/route.ts:1-7`.

**Important caveat: schema presence is not working end-to-end delegation.**

- The model receives no teammate name-to-person-ID directory on the interpretation path, even though reassignment asks for `assigneePersonId`. Sources: `src/app/api/work-os/me/interpret/route.ts:29-92`; `src/lib/aiInterpret.ts:328-347`; `src/lib/aiInterpret.ts:418-419`.
- Client normalization retains batch entries in camelCase (`taskId`, `assigneePersonId`, `dueDate`, etc.), and both chat senders pass `op.tasks` unchanged. The proposal parser expects snake_case (`task_id`, `assignee_person_id`, `due_date`). This is a static contract mismatch: named existing-task batches can be dropped/rejected and fields can be lost. Sources: `desktop/work-os-companion/src/interpretation.ts:275-339`; `desktop/work-os-companion/src/AvatarApp.tsx:1263-1266`; `desktop/work-os-companion/src/App.tsx:3263-3268`; `src/lib/work-os-proposals.ts:90-105`; `src/lib/work-os-proposals.ts:123-150`; `src/lib/work-os-proposals.ts:175-178`.
- `planImport` survives normalization, but the same senders omit it and the server requires top-level `blueprint_id`. Template import is advertised, not demonstrated functional through these callers. Sources: `desktop/work-os-companion/src/interpretation.ts:344-353`; `desktop/work-os-companion/src/interpretation.ts:386-392`; `desktop/work-os-companion/src/AvatarApp.tsx:1263-1266`; `desktop/work-os-companion/src/App.tsx:3263-3268`; `src/lib/work-os-proposals.ts:175-191`.
- The server has an assignee validator using task-creation options, but its explanatory “self unless administrator” text is broader than the actual options filter: admins get all active people; non-admins get active people excluding other mapped admins. Do not derive policy from comments/error text alone. Sources: `src/lib/work-os-proposals.ts:797-804`; `src/lib/work-os-employee-tasks.ts:25-41`; `src/lib/work-os-task-assignees.ts:11-22`.

These are research observations, not fixes or runtime-tested failures.

### Role gating and unmapped admins

| Caller | Current source behavior |
| --- | --- |
| Mapped admin | Admin membership permits administration; employee companion endpoints additionally require relevant flags and the person mapping. Their Otto day remains their own. `src/lib/work-os-api.ts:203-233`; `src/app/api/work-os/me/day/route.ts:11-16`; `src/app/api/work-os/me/day/route.ts:32-49`. |
| Unmapped admin, this Work OS baseline | Admin session/overview routes do not require a person, but `/me/day`, interpretation and desktop authorization do. `requirePerson` returns 409 for a missing mapping (after feature checks); there is no auto-person creation here. `src/app/api/work-os/session/route.ts:9-20`; `src/app/api/work-os/admin/overview/route.ts:8-13`; `src/lib/work-os-api.ts:214-233`; `src/app/api/work-os/desktop/authorize/route.ts:13-15`. |
| Manager | Shared person-access helper permits self plus people on teams where their mapped person is a manager; an unmapped manager gets no people. Reports, person detail, insights and interval reads support manager/admin, but overview and organization task-list routes are admin-only. `src/lib/work-os-api.ts:242-265`; `src/app/api/work-os/reports/route.ts:30-41`; `src/app/api/work-os/admin/people/[personId]/route.ts:14-24`; `src/app/api/work-os/admin/insights/route.ts:9-30`; `src/app/api/work-os/admin/activity-intervals/route.ts:9-32`; `src/app/api/work-os/admin/overview/route.ts:8-13`; `src/app/api/work-os/tasks/route.ts:10-14`. |

The web subtree is admin-only; web routing sends admins to administration and managers to the review console. Mapped admins can also use employee pages, whereas managers are not included in `canUseEmployeeWorkspace`. The desktop admin shell only exposes the personal-workday switch and own-notifications bell when `session.personId` exists. Sources: `src/app/work-os/admin/layout.tsx:6-12`; `src/app/work-os/page.tsx:28-50`; `src/lib/work-os-page-access.ts:26-29`; `desktop/work-os-companion/src/admin/AdminWorkspace.tsx:140-147`.

**Security boundary to retain:** desktop bearer sessions are looked up by hashed token and checked for expiry/revocation; desktop organization is fixed by the session, and a conflicting organization header is rejected. Browser access resolves an authoritative profile and active membership; flags, role and person requirements are server checks. Sources: `src/lib/work-os-api.ts:94-104`; `src/lib/work-os-api.ts:133-149`; `src/lib/work-os-api.ts:174-233`.

### Prompts, notifications, voice and recaps

- Floating scheduling is for the current person's hourly/check-in, clock-in and EOD nudges, deduped by keys; a due check-in can ensure a recap before claiming delivery. It is not an org-wide admin alert scheduler. Sources: `desktop/work-os-companion/src/avatarLogic.ts:327-386`; `desktop/work-os-companion/src/AvatarApp.tsx:716-770`.
- The desktop administration bell uses the signed-in admin's **own** memory, recap, overdue-task and outstanding-EOD data and opens employee surfaces for those destinations; it is not the team-review queue. Sources: `desktop/work-os-companion/src/App.tsx:3803-3829`; `desktop/work-os-companion/src/admin/AdminWorkspace.tsx:47-54`.
- Voice is explicit recording/transcription, not ambient listening or a talking autonomous agent. The floating transcript is appended to the editable draft; server transcription requires a mapped person, `voice_input`, and configured service, forwards audio without storage, and returns text. Thus an admin-only/unmapped voice assistant would need its own appropriate access path. Sources: `desktop/work-os-companion/src/chat/voiceInput.ts:5-25`; `desktop/work-os-companion/src/AvatarApp.tsx:237-244`; `desktop/work-os-companion/src/AvatarApp.tsx:465-466`; `src/app/api/work-os/voice/transcribe/route.ts:29-46`; `src/app/api/work-os/voice/transcribe/route.ts:56-76`.
- Recap decisions preserve the original inference and queue a bounded next-step pass after response; that pass proposes completion/new tasks/subtasks from approved recaps, with target allow-lists, explicit decisions and at most three suggestions. It is an employee recap workflow, not permission for an admin to impersonate a teammate's confirmation. Sources: `src/app/api/work-os/me/activity-intervals/[intervalId]/decision/route.ts:9-36`; `src/lib/work-os-next-steps.ts:7-41`; `src/lib/work-os-next-steps.ts:97-122`.

## 2. Admin infrastructure exists — but is not connected to chat

The administration UI already calls the following reads and actions through its own data module; none are added to the interpretation route's context by virtue of admin role. Contrast `desktop/work-os-companion/src/admin/data.ts:131-176` with the complete interpretation assembly at `src/app/api/work-os/me/interpret/route.ts:29-104`.

| Data / action | What the source actually supplies |
| --- | --- |
| Decision overview | Person attendance + freshness, update/evidence/outcome counts, outstanding EODs, pending-review count and oldest submission, overdue work, disputed evidence, recent activity, source freshness and readiness. Admin route; org-scoped underlying reads. `src/app/api/work-os/admin/overview/route.ts:8-13`; `src/lib/work-os-admin-overview.ts:14-103`; `src/lib/work-os-admin-overview.ts:198-248`; `src/lib/work-os-admin-overview.ts:596-655`. |
| Person detail | Org/person scoped schedule, exceptions, recent sessions/reports, 12 updates, six intervals and seven-day evidence summary; manager/admin with person-access check. `src/app/api/work-os/admin/people/[personId]/route.ts:9-65`; `src/app/api/work-os/admin/people/[personId]/route.ts:76-96`. |
| Task record and delegation | Admin list supports person/project/date/completion/offset filters and exact summary counts. Admin create accepts owner(s), due/start, description, priority, expected outcome, definition of done, project and parent; responds `work_os_confirmed` / `local`, not Nifty-confirmed. Active assignee membership and project organization are checked. `src/app/api/work-os/tasks/route.ts:10-55`; `src/app/api/work-os/tasks/route.ts:62-86`; `src/lib/work-os-local-tasks.ts:123-148`; `src/lib/work-os-local-tasks.ts:161-201`. |
| EOD review | Manager/admin report list with person/status/date filters, org scope and bounded rows; review checks report's person scope. Pending-only review prohibits reviewing one's own report, retains a manager-edit version when supplied, and audits. `src/app/api/work-os/reports/route.ts:30-69`; `src/app/api/work-os/reports/[reportId]/review/route.ts:9-28`; `src/lib/work-os-eod.ts:556-586`. |
| Evidence and recaps | Evidence reads filter by authorized people, task, date/range, source and correction state. Admin recap read supplies provenance, frame summaries/retention, not raw image bytes or storage paths. These are separate records, not task-completion proof. `src/app/api/work-os/evidence/route.ts:13-58`; `src/lib/work-os-activity-intervals.ts:1149-1193`; `src/lib/work-os-next-steps.ts:99-108`. |
| Deterministic insight brief | 7/30/90-day facts and equal-earlier-period windows; written notes include recorded outcomes, substantive updates, submitted EODs, overdue pressure and unresolved-time correction attention; observed activity explicitly is not a score. Manager scope intentionally lacks a team-wide overdue count where array-overlap filtering is unavailable. `src/lib/work-os-admin-insights.ts:10-12`; `src/lib/work-os-admin-insights.ts:59-68`; `src/lib/work-os-admin-insights.ts:93-149`; `src/lib/work-os-admin-insights.ts:161-204`. |
| Connection/configuration health | Admin schema/Nifty status, readiness inputs, source-account mappings and source freshness. Readiness uses config/credential presence and expiry plus provider-specific readiness checks; it is not a universal successful live provider probe. `src/app/api/work-os/status/route.ts:9-16`; `src/app/api/work-os/readiness/route.ts:8-12`; `src/lib/work-os-readiness-report.ts:14-40`; `src/lib/work-os-readiness-report.ts:62-86`; `src/app/api/work-os/integrations/connections/route.ts:9-24`; `src/lib/work-os-admin-overview.ts:596-604`. |

**Bounded data is not a complete dossier.** Overview reads cap observations, updates, recaps, evidence and reports; its outstanding-EOD lookback is seven days, recent activity is trimmed to 24, and disputed-evidence count is derived from the day's loaded evidence. Exact head counts are used for selected totals, not every displayed measure. Queries need explicit coverage/truncation labels before a chat answer says “all,” “none,” or “everyone.” Sources: `src/lib/work-os-admin-overview.ts:105-106`; `src/lib/work-os-admin-overview.ts:207-248`; `src/lib/work-os-admin-overview.ts:549-572`; `src/lib/work-os-admin-overview.ts:655-655`.

## 3. Ranked concrete uses

### 1 — “What needs my decision?”: a 30-second decision brief

**Example:** “Give me today's three things that need my attention, with links.” Answer with the oldest EOD waiting for review, overdue task pressure, a disputed item or configuration blocker, the relevant person/record and the action destination. This avoids opening several admin sections while the admin is doing other work; it should not reproduce every dashboard metric.

**Existing foundation:** the overview already constructs attention codes, counts, severity and destination hrefs for pending reviews, outstanding EODs, overdue work, disputes and readiness blockers. The UI already renders these as actionable rows. Sources: `src/lib/work-os-admin-overview.ts:606-655`; `desktop/work-os-companion/src/admin/OverviewPage.tsx:161-182`.

**Missing wiring / boundary:** add a separate admin read tool and admin destinations; current interpretation neither loads overview nor permits admin navigation pages. Prefer deterministic ordering before optional summarization. Include snapshot time, period and evidence links; qualify capped dispute/activity lists and stale attendance. No write approval needed for a read, but organization/role checks are mandatory. Current scope/limits: `src/app/api/work-os/admin/overview/route.ts:8-13`; `src/lib/aiInterpret.ts:156-156`; `src/lib/work-os-admin-overview.ts:108-113`; `src/lib/work-os-admin-overview.ts:549-572`.

**Priority:** highest. Useful immediately with narrow, already-computed facts and no new autonomy.

### 2 — “Prepare this EOD review”: an evidence-organized review packet

**Example:** “Prepare Maria's submitted EOD for Oct 18: what she reported, recorded task outcomes, activity context, disputes, and questions I should ask.” Show separately: employee submission; task state/outcome evidence; AI-inferred versus confirmed/amended recap context; missing evidence; draft reviewer questions/notes. Open the report for the actual decision.

**Existing foundation:** bounded report/evidence/interval reads already feed the admin review page; the review mutation and manager-edit audit/version behavior already exist. Sources: `desktop/work-os-companion/src/admin/data.ts:140-143`; `desktop/work-os-companion/src/admin/data.ts:159-161`; `src/app/api/work-os/reports/route.ts:30-69`; `src/lib/work-os-eod.ts:556-586`; `src/lib/work-os-activity-intervals.ts:1188-1193`.

**Missing wiring / boundary:** a read-only, record-cited review-preparation tool, then optional explicit “save notes” / “approve” / “reject” action cards. Never turn “prepare” into the existing draft-report POST or a submitted/approved state. The report-draft API writes a report and returns 201; reviewing requires a pending report and another reviewer for the admin's own report. Sources: `src/app/api/work-os/reports/eod/route.ts:8-24`; `src/lib/work-os-eod.ts:564-585`.

Preserve raw screenshot restrictions: a reason, authorized person, retained availability, and own-image or flagged/disputed-review rule, with audit. Start with summaries, not background screenshot browsing. Source: `src/lib/work-os-screenshots.ts:1055-1085`.

**Priority:** high. Human decision preparation is more defensible than automatic “performance assessment.”

### 3 — “What do we actually know about this teammate/work?”: grounded team Q&A

**Examples:** “What has Alex actually reported since yesterday?” “Which recorded tasks are still open for Sam?” “What changed over the last seven days?” Return dated updates, task rows and recap labels, state what isn't established, and link source records.

**Existing foundation:** person detail joins recent employee-authored updates and recaps; task list supports a person filter; insights supplies deterministic current/prior-period facts; manager-compatible endpoints already use accessible-person checks. Sources: `src/app/api/work-os/admin/people/[personId]/route.ts:14-65`; `src/app/api/work-os/tasks/route.ts:15-31`; `src/app/api/work-os/admin/insights/route.ts:9-30`; `src/lib/work-os-admin-insights.ts:59-68`.

**Missing wiring / boundary:** server-side teammate resolution and a bounded retrieval/query tool, not a giant team dump into the employee prompt. Restrict managers to managed people and do not offer the admin-only task-list/overview API as a manager tool. Require date, coverage and source class in answers; “no update in the returned window” is not “did no work.” Avoid silently searching employees' personal memory/conversations: the current context is person-scoped and personal conversation history is stored under organization + person + day. Sources: `src/lib/work-os-api.ts:242-265`; `src/app/api/work-os/tasks/route.ts:10-14`; `src/lib/work-conversations.ts:17-39`; `src/lib/work-memory-today.ts:58-94`.

**Priority:** high, after review/brief tools define citation and scope behavior. “Why” answers must distinguish a recorded blocker/explanation from inference.

### 4 — “Turn this decision into assigned work”: delegation plus a follow-up list

**Example:** “Draft a task for Alex to resolve the integration mapping gap by Friday, with these acceptance criteria.” Preview title, resolved teammate, due date, description, parent/project and definition of done; admin explicitly confirms. Later: “Show the open delegated tasks due tomorrow” returns recorded task state and relevant updates, not an invented employee acknowledgement.

**Existing foundation:** admin task creation accepts assignees, dates and expected-outcome/definition-of-done fields and validates organization membership/project. Creation is a local Work OS task with an explicit receipt, not proof that Nifty was updated or anyone was messaged. Sources: `src/app/api/work-os/tasks/route.ts:62-86`; `src/lib/work-os-local-tasks.ts:123-148`; `src/lib/work-os-local-tasks.ts:161-201`.

**Missing wiring / boundary:** use an explicit admin mutation contract and confirmation card with actor/target separation, idempotency and authoritative readback; do not remove owner/assignment guards from the employee proposal pipeline to make it work. Fix and exercise batch/import transport before claiming reuse. Current employee proposals are target-assignment scoped, owner-reviewed and staleness-checked for most editing operations. Sources: `src/lib/work-os-proposals.ts:678-709`; `src/lib/work-os-proposals.ts:1058-1077`; `src/lib/work-os-proposals.ts:1150-1185`. No confirmed recipient-notification or autonomous chase path was found in the traced chat catalog/scheduler (`src/lib/aiInterpret.ts:82-86`; `desktop/work-os-companion/src/avatarLogic.ts:383-386`), so follow-up initially means a readback queue, not sending messages.

**Priority:** medium. Concrete operational value, but greater authority and correctness risk than read tools.

### 5 — “Only interrupt me for an actionable change”: low-noise admin alerts

**Examples:** one new submitted report awaiting decision; a newly disputed evidence item; a new blocking configuration issue. A compact Otto bubble can give count + cause + “Open review/settings,” rather than every employee update or frame analysis.

**Existing foundation:** overview attention rows and recent-activity kinds provide candidate signals; the desktop has deduped per-person nudge delivery and in-app persistent stale-overview notices. These are building blocks, not an implemented admin alert feed. Sources: `src/lib/work-os-admin-overview.ts:40-56`; `src/lib/work-os-admin-overview.ts:606-655`; `desktop/work-os-companion/src/AvatarApp.tsx:716-770`; `desktop/work-os-companion/src/admin/OverviewPage.tsx:65-76`.

**Missing wiring / boundary:** a separate organization-scoped event/condition subscription or polling contract, durable per-admin seen/resolved state, thresholds, digest/quiet-hour settings and dedupe across windows. Don't repurpose employee check-in cadence. Distinguish a new condition from the same outstanding count and default to no sensitive detail in OS toasts. Existing admin bell is personal, and Overview's normal 60-second polling stops in background; neither proves always-on team alerting. Sources: `desktop/work-os-companion/src/App.tsx:3803-3829`; `desktop/work-os-companion/src/admin/OverviewPage.tsx:52-63`.

**Priority:** medium, after useful read/decision destinations exist. Start with opted-in review/configuration events, not “someone is inactive.”

### 6 — “Is the record healthy?”: connection and evidence-coverage triage

**Example:** “Why might today's team record be incomplete?” Distinguish missing person/source mapping, disabled feature, schema/configuration blocker, stale last-received data and a genuinely observed provider error. Link Settings or Evidence rather than offering magical repair.

**Existing foundation:** source freshness, readiness inputs, admin status and mapped provider accounts already exist, with org-scoped reads. Sources: `src/lib/work-os-admin-overview.ts:596-604`; `src/lib/work-os-readiness-report.ts:14-40`; `src/lib/work-os-readiness-report.ts:62-86`; `src/app/api/work-os/status/route.ts:9-16`; `src/app/api/work-os/integrations/connections/route.ts:9-24`.

**Missing wiring / boundary:** an allow-listed, secret-free health projection as a read tool. Configuration presence isn't a verified connection, and no recent GitHub event doesn't prove failure. Credential rotation, account remapping, repo changes, sync/backfill and migrations must stay separate, explicit admin actions; mapping/backfill actually writes attribution and audit. Source: `src/app/api/work-os/integrations/connections/route.ts:67-123`. Do not pass raw connection configs or broad evidence responses directly to a model: connection GET selects `*`, and the evidence embed currently selects `storage_path`; sanitize the tool projection rather than assuming UI-safe means model-safe. Sources: `src/app/api/work-os/integrations/connections/route.ts:18-24`; `src/app/api/work-os/evidence/route.ts:10-11`.

**Priority:** lower, useful for incomplete-data diagnosis; not a standalone reason to create an admin agent or make repair autonomous.

## 4. Uses to reject or defer

- **Productivity ranking, attendance policing, or automatic task completion from screenshots.** The design explicitly separates observed activity from effort, productivity, completion and quality; insight notes likewise label observed context as not a score. Sources: `design.md:1247-1266`; `src/lib/work-os-admin-insights.ts:125-147`.
- **Automatically approve/reject EODs or impersonate employee recap confirmations.** Existing report review is a bounded human decision with a self-review prohibition; next-step proposals depend on reviewed recaps and remain proposed. Sources: `src/lib/work-os-eod.ts:564-585`; `src/app/api/work-os/me/activity-intervals/[intervalId]/decision/route.ts:9-35`; `src/lib/work-os-next-steps.ts:7-26`.
- **“Message everyone,” automatic follow-up conversations, or broad Slack/email/calendar/CRM automation.** The traced interpreter's operation catalog and floating nudge catalog do not expose these capabilities; provider connections are not a messaging tool. Sources: `src/lib/aiInterpret.ts:82-86`; `src/lib/aiInterpret.ts:147-157`; `desktop/work-os-companion/src/avatarLogic.ts:383-386`. New communication authorization/integration work would be required; none is assumed here.
- **An all-seeing company brain or universal desktop operator.** Current chat context is person/day-scoped and constrained to structured work operations; existing task/evidence/health APIs justify narrow tools, not claims of arbitrary app control. Sources: `src/app/api/work-os/me/interpret/route.ts:42-52`; `src/lib/aiInterpret.ts:405-431`; `src/lib/aiInterpret.ts:458-470`.

## 5. Required extension contract (recommendations, not current behavior)

1. **Separate “My day” from “Administration.”** Retain floating/launcher anatomy, but make scope explicit; an admin assistant should authenticate an admin membership without inventing an employee person/shift simply to satisfy `/me`. Its chat/history/cache must be keyed to actor + organization + mode, not mixed into the personal workday transcript. Current history is personal and day-keyed (`src/lib/work-conversations.ts:17-39`), and unmapped admin `/me` access is rejected (`src/lib/work-os-api.ts:220-233`).
2. **Read-only tools first.** Reuse server-owned overview, report/person/recap and deterministic insights services; never trust client/model-supplied organization/person IDs. Re-check role and person scope on each call, including after a UI workspace switch. Existing role/person boundaries: `src/lib/work-os-api.ts:192-233`; `src/lib/work-os-api.ts:242-283`.
3. **Ground every substantive answer.** Supply record ID/link, person, source class, local date/timezone, freshness and review status. Show coverage/truncation and “not established.” Keep employee text, task state, provider events, screenshot inference and reviewer decisions separate. Preserve GitHub `performed` versus `triggered`; interval output already validates recorded activity against an allow-list. Sources: `src/lib/work-os-activity-intervals.ts:268-285`; `src/lib/work-os-activity-intervals.ts:1149-1193`; `design.md:1354-1378`.
4. **Mutations need explicit confirmation and real receipts.** “Draft” and “prepare” cannot imply sending, submitting, approving or completing. Preview actor, target, before/after and effects; retain original employee submission/version, server permissions, audit, idempotency, conflict checks and recoverable uncertain outcomes. Useful existing patterns: `src/lib/work-os-proposals.ts:1058-1112`; `src/lib/work-os-proposals.ts:1150-1212`; `src/lib/work-os-eod.ts:556-586`. The new admin-local-task API will need a verified idempotent tool wrapper rather than assuming employee proposal semantics apply.
5. **Least-data access and no background surveillance.** No broad raw-screenshot access; no credentials, raw storage paths or entire integration config in model context; no employee-private memory as a team knowledge base without a distinct policy. Use the audited screenshot boundary and safe structured projections. Current raw-image gate: `src/lib/work-os-screenshots.ts:1055-1085`; current personal context: `src/app/api/work-os/me/interpret/route.ts:42-52`.
6. **Voice is just another draft entry method.** Keep explicit capture → transcribe → review → send; admin voice requires resolving its existing person requirement, not bypassing server checks or automatically executing a transcript. Sources: `src/app/api/work-os/voice/transcribe/route.ts:36-46`; `desktop/work-os-companion/src/AvatarApp.tsx:237-244`.

## 6. Agent OS comparison and verification limits

Read-only `git show` / `git diff --stat` checks found **byte-identical** source between this baseline and the cached Agent OS ref for `AvatarApp.tsx`, `aiInterpret.ts`, `/me/interpret/route.ts`, the examined admin-route directory, `work-os-admin-overview.ts` and `work-os-admin-insights.ts`. The scoped diff also found differences in `App.tsx`, `work-os-api.ts`, `work-os-proposals.ts` and desktop admin CSS. This is selective source comparison, not repository convergence or deployment verification.

### Existing Agent OS execution/notes infrastructure is a different authority

The cached Agent OS source does have host-agent chat and execution infrastructure; that must not be advertised as current floating-Otto access. At **the Agent OS ref named above**:

- Its Claude chat route spawns the host runner with `--dangerously-skip-permissions`; that is a materially different execution contract from Otto's persisted, human-reviewed work proposals. Source: `agentos/main:src/app/api/claude/chat/route.ts:81-101`. The local runner also directly spawns configured CLI binaries with host environment/cwd: `src/lib/runner.ts:101-121`.
- Agent-task delegation/retry/cancel is on a different API, authenticates an app user, and uses profile-level admin/ownership checks rather than the Work OS team/person helper. Source: `agentos/main:src/app/api/agent-tasks/action/route.ts:9-48`.
- Notes tools use a separate agent bearer token, require a running Hermes turn, and restrict note search/read to attached chat note scopes; writes record tool-call idempotency and invoke note RPCs. This is not a general organization knowledge source already attached to Otto. Source: `agentos/main:src/app/api/agent-tools/notes/route.ts:8-44`; `agentos/main:src/app/api/agent-tools/notes/route.ts:61-104`.

The traced Otto sender still calls only its Work OS interpretation/proposal/display paths (`desktop/work-os-companion/src/AvatarApp.tsx:1249-1285`), not those host APIs. Recommendation: don't solve admin use cases by silently routing Otto into unrestricted CLI execution or attaching every note. Any future host-agent handoff needs a separate, explicit capability, target/resource scope, approval and audit contract. This research did not audit all legacy platform routes or certify their security.

**Material exception:** cached Agent OS has `ensureAdminPersonRecord`, which finds/creates an admin person and links the membership on access resolution. At `agentos/main` (`230c045e…`), see `src/lib/work-os-api.ts:84-161` and `src/lib/work-os-api.ts:292-307` (these line references apply to that ref, not this worktree). Work OS here instead checks `membership.person_id` and returns it unchanged (`src/lib/work-os-api.ts:220-233`). Consequently:

- Don't claim unmapped admins are blocked on the live service without checking its actual identity and resolver behavior.
- Don't call Agent OS's access-dependent GET probes strictly side-effect-free for an unmapped admin: the resolver itself may write the person mapping.
- Auto-mapping still does not add team context/admin tools to chat; the interpretation route and floating caller remain the same person-scoped code at the compared ref.

Source verification performed: complete instruction/design reads; direct source tracing of callers, schema, prompt assembly, auth, queries and mutation guards; selective cross-ref content comparison. The coordinator additionally inspected live services and performed read-only aggregate database queries, described below. **Not performed:** browser interaction, model requests, authenticated companion/API flows, TestSprite, builds, mutation tests or new provider requests. Batch/import transport observations remain static findings until exercised by an authorized implementation/verification task.

Remaining work is optional product development, not a missing prerequisite for this research: connect explicit admin-scoped tools and verify any chosen workflow end-to-end. No credentials or provider fixes are requested or assumed; no admin assistant feature is claimed implemented.

## 7. Live infrastructure verification — Oct 19, 2026

The coordinator performed read-only service checks and aggregate database queries inside an explicit `BEGIN READ ONLY` transaction. No product data, feature flags, integration configuration, or services were changed. Credentials stayed on the deployment host and were neither printed nor copied.

- The production web service, tunnel, local agent runner, and Hermes gateway reported running. The public application returned HTTP 200; an unauthenticated admin status request redirected (HTTP 307). This verifies reachability and an authentication boundary, not an authenticated admin interaction.
- Attendance reconciliation and screenshot scheduling/retention timers exist; their last service results reported success. A successful timer exit is not itself proof of every user's evidence flow.
- Database reads found recent Nifty sync state without recorded organization sync errors, recent Worktivity attendance observations, and recent ingested GitHub and Worktivity evidence. These are actual stored records, stronger evidence than merely finding credentials configured.
- Reports awaiting review, open tasks, confirmed/inferred recaps, and reviewed/unreviewed memory items exist. Some recent recap generations are `unavailable`; the data cannot support a claim of complete evidence coverage.
- The inspected database contains multiple organizations. Aggregate availability is not proof that every source is enabled, mapped, authorized, or populated in the administrator's own organization. Every proposed answer must scope to the caller's organization and expose coverage/freshness.
- Voice and memory organization flags were enabled in the inspected organization records. Per-member overrides and device/provider behavior were not exercised; flag state alone is not end-to-end proof.
- The deployed Agent OS checkout reported revision `230c045e7`; the Work OS source review used `35d9af1d`. Checkout revision is not asserted to identify the exact running compiled bundle.
- Broader platform source contains durable agent jobs, owned Hermes sessions, and note-scoped agent tools. The runner/gateway service states confirm infrastructure is running, not that floating Otto can dispatch these jobs or access those notes. No agent job was started and no messaging delivery was tested.

No companion installation, authenticated floating-admin chat, screenshot preview, transcription, external message delivery, or state-changing workflow was exercised. This is capability research and a feasibility recommendation, not a deployed feature or end-to-end acceptance result. Live infrastructure identifiers, private host paths, individual records, tokens, and operational counts are deliberately omitted from this repo note.
