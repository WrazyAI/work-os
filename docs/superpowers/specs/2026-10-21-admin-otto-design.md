# Admin Otto: reviewed recaps and employee queries

Date: Oct 21, 2026. Status: approved by the user on Oct 21, 2026; implementation not started.
Source baseline: Work OS `a1b2d86f`; compared Agent OS ref `04870874`.
Ledger: `wYzO1UbYPZ` — Design admin Otto recaps and employee queries.

## Intent

Extend the existing floating companion for an administrator's daily work. The
administrator should hear employees' reviewed activity recaps and ask for their
work records without navigating several sections or looking up employee IDs.
Keep the familiar mascot, chat cards, and read-aloud experience. This is not a
second general-purpose agent, a new management dashboard, or an autonomous
manager. Reuse existing services behind explicit admin-authorized tools.

## Decisions made by the user

1. Notify admins **only after the employee confirms or corrects a recap**.
   Generating a recap or reaching the end of an hour is not a notification event.
2. Playback means **audio narration of that reviewed recap**, using the same
   experience employees use, not a video or screenshot replay.
3. Each admin follows **all employees by default**. Their own settings let them
   choose employees to follow. This is a per-admin preference.
4. Admins can ask for unfinished tasks across employees and records for a named
   employee. Otto resolves the employee's internal ID from the directory; the
   admin does not have to know or supply it.
5. Extend/reuse employee functionality and the existing APIs/tools instead of
   inventing unrelated admin uses.

## Builder choices included in the approved design

- First delivery targets the installed Windows/macOS companion: floating Otto,
  its admin-mode chat, a reviewed-recap inbox, and personal settings inside the
  administration workspace. No new web chat or external MCP server is required.
  Backend services are reusable by the web later; this does not promise web UI
  parity as part of the first delivery.
- Employee records are read-only in admin chat for this delivery. No assigning,
  editing, completion, report approval, employee confirmation, or messaging on
  behalf of an employee. Existing administration controls are unchanged.
- Audio starts only on Listen, never on arrival. New arrivals group into one
  quiet alert, never open the whole chat or interrupt an ongoing read.
- Notify from feature activation onward, not for the entire old recap backlog.
  The inbox retains the last 30 days of reviewed-event arrivals, paged by 12.
  Explicit history queries can retrieve older retained reviewed records.
- A real later correction creates one new review version and may notify again;
  retries or repeated confirmation of unchanged words do not.
- First-release admin tools read reviewed recaps, task state, employee-authored
  updates, submitted EODs, and the employee's workday/schedule snapshot. They do
  not silently retrieve inferred recaps, employee-private memory, private chats,
  unsubmitted EOD drafts, or unrestricted screenshots.

## Current implementation evidence

These observations are from source, not a new authenticated runtime test:

- Floating `AvatarApp.tsx` and in-app `App.tsx` call
  `/api/work-os/me/interpret`; its context loads the caller's person-scoped tasks
  and optional personal memory. Admin role alone does not supply team tools.
- `src/app/api/work-os/admin/activity-intervals/route.ts` and
  `listAdminActivityIntervals` already expose authorized org/person recap reads,
  but the current list does not provide the durable reviewed-event inbox needed
  here. Reuse projections and scope checks, not its capped list as an alert log.
- `src/lib/work-os-recap-route.ts` handles `/api/work-os/voice/recap` with a mapped
  person and `voice_input`; `getActivityIntervalForPerson` allows only that
  person's interval. Do not weaken this loader for employee callers.
- `src/lib/work-os-recap-speech.ts` already assembles bounded stored recap lines,
  synthesizes using server-only configuration, and caches by interval ID,
  generation revision, and voice. `recapSpeechPlayer.ts` already handles loading,
  long waits, cancellation, and read errors; reuse the current implementation,
  not the older voice design document's unshipped descriptions.
- `decideActivityInterval` in `src/lib/work-os-activity-intervals.ts` writes
  `confirmed`/`amended`, `final_detail`, and `reviewed_at`, but does not increment
  the generation `revision`. An amendment preserves original inference and adds
  employee feedback. Admin narration must not confuse generation revision with
  reviewed text identity or reuse an inferred clip after amendment.
- `src/app/api/work-os/tasks/route.ts` is admin-scoped and supports `personId`;
  `src/lib/work-os-tasks.ts` supplies the task service. Current Work OS local
  task records are authoritative; Nifty is read-only backup context, not a second
  source of live completion truth (see current changelog 0.4.88).
- `AdminWorkspace.tsx` currently has a no-op New chat handler and a personal bell
  conditional on a person mapping. Admin entry, notifications and settings must
  work without requiring a personal workday or synthesizing an employee record.
- The earlier research is in
  `docs/research/2026-10-19-otto-admin-uses.md`. Its live checks are dated and do
  not establish current deployment identity, TTS health, or shipping readiness.

## Product behavior

### One Otto, explicit work context

The current workspace selects My day or Administration mode. Floating Otto
mirrors that mode, names it in its header, and permits an explicit mode switch.
An admin without a personal person mapping starts in Administration; employee
mode is unavailable rather than fabricating a shift/person. Main-window New
chat opens the shared admin conversation instead of doing nothing.

Keep personal and admin conversations, result caches, selected employee and
audio ownership separate by user + organization + mode. Changing mode cancels
in-flight replies and speech and removes the previous mode's visible records.
Personal attendance/check-ins continue unchanged; admin mode never prompts the
admin to confirm an employee's recap or implies a shift belonging to them.
An unresolved personal prompt is not lost on switching, but it must not render
as a team prompt. Team arrival state remains available when returning to admin.

### Reviewed-recap arrival and listening

After the employee decision commits, a followed employee's new reviewed version
becomes eligible for that admin's inbox. One arrival names the employee, interval
and review label: Confirmed by employee / Corrected by employee. The compact
mascot offer is Listen plus View recap. More than one pending arrival uses one
counted offer opening the inbox; it does not cycle through voices or stack bubbles.

Listen opens the same bounded read-aloud treatment with spoken lines visible,
the existing voice choice, preparing/reading/finished states, Stop and Retry.
It reads the stored reviewed view, including the employee's correction, not a
fresh AI retelling. Where original inference is retained alongside a correction,
the view and script identify that distinction; do not narrate superseded claims
as unqualified verified truth. Use the same canonical script projection for
the visible reading text and speech bytes. No per-employee voice or voice clone.

Read-aloud does not show the employee's Looks right/Edit controls. End of audio
means playback finished, not admin approval, employee completion or attendance.
The admin may replay, open the full read-only recap, or ask about that employee.
The detailed view preserves source class, coverage, review status and interval
timezone. Raw screenshot preview keeps the existing reason/scope/audit rules;
admin following does not add screenshot permissions.

Listening and microphone recording remain mutually exclusive. Arrival never
starts narration. Minimize/expand in the same mode preserves the current read;
mode/org/account changes, sign-out, revocation or selecting a different clip
stop it. The main and floating windows coordinate so they never narrate twice.
No audio or team payload is saved in the personal offline cache.

### Employee following in settings

Add a personal Admin Otto group under the account's own settings, separate from
workspace feature configuration. It appears even without a personal workday.
Its label and content follow the shared two-column Settings group contract.

Modes: All employees (default) or Selected employees, with a searchable checklist
and Save. An explicitly empty selection means no employee recap alerts and says
so; do not coerce it to All. All includes newly added active roster employees.
Selected includes only the saved active IDs, so new hires are not silently added.
Show missing/inactive saved choices as no longer active and exclude them from
delivery. A failed directory fetch is an error/retry, never an empty roster.
Retain an inactive saved selection so reactivation resumes following; create a
fresh eligibility watermark on reactivation for both All and Selected. Events
from before that reactivation do not become catch-up alerts.

Settings belong to the authenticated admin membership within the organization,
sync across devices and do not affect another admin. Changing followed people
changes future alert eligibility and the followed inbox; it does not revoke the
admin's authorized on-demand record access. Unfollowing removes still-pending
alerts for that person; following anew starts from that change's watermark and
does not replay their old events. An admin's own employee recap, if present in
the eligible roster, is not double-toasted: personal review prompt and team
reviewed arrival are distinct stages, and each team event has one owner.

### Natural-language employee queries

Examples supported in the first delivery:

- Show Alex's unfinished tasks.
- Show unfinished tasks across the team / for Alex and Maria.
- Read Maria's latest reviewed recap.
- What did David report yesterday?
- Show Alex's workday record for Oct 20.

Resolve names server-side from the active organization roster. Normalize case
and whitespace, prefer a unique full name, and accept a unique partial name.
No match explains that no employee was found. Multiple matches return named
choices and wait; never assume today's lack of duplicates is a uniqueness
constraint. Support explicit IDs internally and for API callers, but validate
them exactly like resolved names. Do not use email/provider IDs as interchangeable
person IDs or let model-provided IDs escape organization checks.

An explicit named request is not restricted to followed employees. "The team"
means the authorized organization roster, not the follow list. A follow-up such
as "their overdue ones" retains the explicitly resolved person set in this
admin conversation; a scope change restates the employee names in the result.
The default unfinished query is all open, non-archived, non-deleted work, not
only today's plan. Show person(s), title, effective due date/status, parent/
subtask relationship and source-record links with exact filtered count and
Load more; never infer task completion from a recap or GitHub event.

Sort before pagination using the admin task record's newest-created default.
Share effective-due and status rules with that record; do not reproduce the
known split between displayed derived dates and a database-only overdue count.
Return 50 task rows per page, page size bounded at 100, with a continuation
cursor and complete filtered total. Multi-person assignment must not duplicate
a task or imply each assignee owns a separate copy.

Date-bound queries state the local day/timezone being used. For multiple people,
"yesterday" is resolved in each employee's configured timezone and shown as
such. No date means open backlog for unfinished tasks, latest reviewed interval
for latest recap, and the employee's current local workday for a workday record.
Other record/history queries default to a stated seven-local-day range, with
explicit bounded date filters for older work (at most 31 local days per request,
with continuation for subsequent windows). Older retained reviewed recaps remain
readable and narratable by explicit request outside the 30-day arrival inbox;
normal record retention and access checks still apply. Results distinguish authored
updates, submitted reports, task state and reviewed activity; source text is
data, never instructions to invoke tools. Missing records do not mean no work.

## Service and data boundaries

### Reuse services, not a broad employee impersonation parameter

Keep existing `/me` endpoint behavior intact. Introduce an admin-only adapter
around shared directory, task, workday, report and reviewed-recap services. A
small typed admin tool catalog resolves people, lists unfinished work, retrieves
work records, lists reviewed recaps and opens a particular reviewed recap.
The tool runner, not model prose, performs reads. Arbitrary SQL, arbitrary URLs,
host CLI execution and generic MCP/server access are out of scope.

An admin speech endpoint accepts an interval ID, reviewed-version key and voice,
never arbitrary speech text or an employee token. It loads the interval inside
the caller's organization, verifies readiness and employee review, and reuses
the script/synthesis/player seams. The employee speech endpoint remains own-only.
Versioned admin tool outputs include safe record IDs/links, employee identity,
source class, as-of time, range/timezone, coverage and pagination, not raw rows,
storage paths, credentials or integration config. Direct buttons and chat invoke
the same service contracts; no second data authority is introduced.

Authorize every directory/read/feed/preferences/speech request with authoritative
active membership, organization, admin role and applicable feature flags.
An internal target ID is not authorization. Admin operation must not require an
employee mapping, including desktop authorization/bootstrap, admin voice output,
or optional existing voice-input entry. Keep employee personal requirements
unchanged; don't bypass authentication or auto-create a person to satisfy them.
Managers are out of scope for the initial admin capability and stay denied;
their existing team-scoped review APIs remain unchanged.

### Durable reviewed versions and inbox

Use additive migrations for a canonical reviewed-version/event record and
per-admin subscription/read state. Exact table/module names are left to the
implementation plan, but these guarantees are not optional:

1. Record a reviewed event atomically with the successful employee decision (or
   a transactional outbox entry), never from model generation or UI clicks.
   Retries dedupe by interval + reviewed content identity. A meaningful text or
   review-state change creates a new monotonic reviewed version; an unchanged
   confirm/retry does not. Concurrent decisions use an optimistic version check.
2. The version identifies the canonical reviewed script, review state, employee
   feedback and source generation revision. Generation `revision` or mutable
   `reviewed_at` alone is insufficient. Original inference remains preserved.
3. Fan-out/materialization and recipient state are idempotent, organization +
   admin + event keyed. Persist followed mode/IDs, effective-since watermarks,
   dismissed/seen/listened state and delivery claims in server storage, not just
   webview local storage. Inbox dismissal/read is personal, not employee approval.
4. Establish an activation watermark when the admin first initializes companion
   Administration mode with this feature available, not at rollout or creation
   of their membership. Reconnecting while still authorized preserves this
   watermark and allows catch-up. After role/membership or feature revocation,
   re-enabling creates a fresh watermark while retaining valid follow choices;
   do not notify about reviews committed during disabled access. Recipient
   eligibility is evaluated against subscription state effective at the review
   event's commit order, not delayed worker time. A newly followed person gets a
   new watermark. Recheck current following/authorization before presentation.
5. Poll one paged inbox feed every 60 seconds while the companion process is
   running, even if its main window is hidden, plus reconnect/focus refresh.
   Pause/back off when offline; catch up with a stable ordered cursor without
   losing same-timestamp events. This is a deliberate new admin feed, not the
   Overview poll or an employee-cadence change. Target normal alert latency is
   within one successful polling interval, not a hard real-time guarantee.
6. Exactly one window/device claims the transient delivery with a bounded server
   lease. Acknowledgement dedupes future delivery; crash after display but before
   acknowledgement can repeat once. Prefer at-least-once recovery over claiming
   impossible exactly-once desktop display. Persistent inbox is authoritative.
7. Group each poll's new events into one alert; order inbox by reviewed-event
   commit sequence newest-first, keeping employee interval times visible. Fresh
   text changes do not reorder the reader's existing scroll. Display server unread
   count; dismissing a bubble doesn't discard other inbox entries. Old versions
   superseded before delivery collapse into the latest reviewed version.
8. A closed app receives no new desktop toast; events remain for reconnect.
   Multiple catch-up events give one counted alert, not a toast storm. Events
   older than the 30-day inbox window, measured by review-event commit time,
   remain outside this initial inbox; state the coverage window rather than
   claiming all historical arrivals are present. A newly confirmed/corrected old
   interval can therefore alert today, showing its actual interval date and time.
9. If an employee becomes inactive, the admin loses role/access, the organization
   changes or recap visibility is revoked, omit the entry and deny future detail/
   audio reads. Listeners release claims on close; no stale cross-account retry.

Do not block employee review or its existing bounded next-step pass on admin
delivery or speech preparation. No admin delivery writes check-ins, attendance,
substantive-update timestamps, employee review state or task state.

### Audio safety and cost

Reuse current `voice_input` capability/readiness and allowed voices, choosing the
admin listener's voice preference rather than the employee's. Key speech caches
by organization + interval + reviewed version + canonical script hash + voice.
Authorize before every cache lookup/serve. After long synthesis, revalidate
permission and version before returning; a new review makes old audio stale.
The client refreshes the reviewed view and explicitly restarts if needed, never
plays words against an old displayed card. Cache hits cannot bypass scope.

Prepare audio on Listen, not for every employee on every poll. Keep current
length guard, bounded provider timeouts and cache size, plus per-admin rate and
concurrency limits in the plan. No provider response URL/key reaches the client;
response audio remains authenticated/no-store. Client memory releases clips and
pending generations on org/account changes. Provider failure leaves the text
readable with retry and never hides an otherwise available recap notification.

## State, accessibility and layout contract

Reuse `design.md` tokens, configured mascot renderer and shared bounded chat /
recap components. Add an admin Recaps peer view in the floating shell alongside
Chat; it owns the 12-row paged reviewed inbox. Unfinished-task results use shared
task-reading cards with person labels and read-only record destinations. Personal
Focus/confirm controls are not repurposed as admin controls.

States to implement: loading; refreshing with prior data retained; no reviewed
recaps; selected-follow empty; filtered no matches; partial coverage; offline
with last-checked time; directory/query failure with retry; no permission;
voice disabled/unconfigured; audio preparing/slow/cancelled/playing/finished/
failed; stale reviewed version. Never label empty because a request failed.

Never steal focus or autoplay when an alert arrives. User-opened panels/dialogs
focus inside, close on Escape and return focus to their trigger; follow checklist
supports keyboard selection and labelled controls. Transcript remains readable
without sound. Loading/slow states use polite live announcements rather than
repeated screen-reader updates. Follow reduced-motion behavior, speech progress
and the existing monitor-clamped mascot growth; touch controls remain at least
40px when stacked. Check 1440, 1024, 720 and 390 layouts, zoom, both themes, text/
mascot size settings and overlay collisions. Update `design.md` only when an
approved reusable pattern is actually implemented, not to present this proposal
as current behavior. A mockup is optional and does not constitute implementation.

## Delivery and acceptance

This is one project with dependent parts: admin access/context and directory
tools; durable review event/preferences/inbox; reviewed audio; companion wiring.
An implementation plan follows approval of this document. Builder may choose
file names, migrations and typed transport schemas, but not relax authorization,
review-only delivery, follow defaults or speech/text identity.

Required evidence before calling the eventual feature shipped:

- Unit/integration: only successful confirm/amend commits publish; retries and
  concurrent revisions dedupe; corrected text invalidates audio; preference
  watermarks and empty selections; multi-admin independence; pagination across
  ties/arrivals; lease/reconnect recovery; no lost events in the retained window.
- Auth/API: employee and manager denied for admin tools; cross-org target IDs,
  forged directory results, expired/revoked desktop sessions and role loss denied;
  admin without person mapping can connect/use admin mode; employee own-only
  routes unchanged; long-running speech rechecks access and version.
- Tasks/records: unique/ambiguous/missing name; multi-person query and duplicates;
  unfinished includes older work, omits deleted/archived/completed; exact total/
  due semantics; timezone boundaries; source links open the exact record.
- Browser and TestSprite: confirm/amend as disposable employee, receive as two
  admins with different follows, Listen/Stop/Retry/read text, settings save and
  reload on another device, unchanged personal flow and correct mode switching;
  hidden main window delivery, grouped catch-up, keyboard/reduced-motion/layouts.
- Live controlled probe: real reviewed recap through event commit, admin feed,
  authorized TTS bytes and audible native Windows/macOS playback. Exercise a
  correction after cached playback. Record provider latency separately from app
  behavior; a stubbed audio response or timer success does not prove listening.
- Relevant companion/root tests, typechecks and builds, one CodeRabbit pass for
  the completed batch, additive migration against the verified database host,
  reviewed per-file Agent OS convergence, atomic deploy and live identity check.
  Preserve portable packaging and native ACL guards; synchronize companion
  version metadata and employee-facing release notes when it actually ships.

## Design verification and remaining dependencies

- [x] Read current blueprint and release history; isolate work from shared edits.
- [x] Trace existing recap audio, employee review, admin reads and task authority.
- [x] Record user decisions separately from proposed builder choices.
- [x] Fresh builder check; specified activation, history-window and reactivation rules.
- [x] User approved the full description on Oct 21, 2026.

Documentation only: no feature, migration, speech request or deployment has been
made. Current TTS provider availability and real native playback have not been
reverified in this design task. Those are implementation acceptance dependencies,
not claims that the existing provider is broken or missing credentials.

Builder-check result: the reviewer identified three lifecycle ambiguities, not
additional user requirements. The author resolved them above as proposed builder
choices: first-use activation with fresh watermarks after disabled access; inbox
age by review commit time with explicit older-history access; and resumed follows
on employee reactivation without retroactive alerts. The user approved these
together with the rest of the design on Oct 21, 2026.
