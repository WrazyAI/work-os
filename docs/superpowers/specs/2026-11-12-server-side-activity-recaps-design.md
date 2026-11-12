# Work OS — Server-side activity recaps

Ledger: `4fffb588-e129-4cf4-aa28-c3be9445889d`

## Intent

Recaps must not depend on the companion window being open. The server already
pulls and analyses Worktivity frames on a schedule, but only the client's
`ensure` call creates an Activity Interval Review. Closing the app therefore
stops recap generation, and reopening produces at most one catch-up recap for
the whole gap.

Move generation to a server schedule. Every due interval with usable evidence
becomes a recap whether or not a window is open. At launch, the newest ready,
unreviewed recap appears in the floating mascot and the app notification
surface; older recaps wait in the Recent activity queue. Intervals with no
usable activity never enter that queue.

The user confirmed:

- The newest recap must pop up on every launch while it is still unapproved.
- Once the newest recap is approved, no older recap auto-surfaces on launch;
  older unapproved recaps stay in the recaps queue.
- Intervals with no usable screenshots (breaks, idle time, provider gaps) are
  left out of the queue entirely.
- After approving a recap, once Otto's success beat has played, a bubble reading
  `You have unapproved recaps` with a `View recaps` action should appear when
  older unapproved recaps remain.

## Server generation

Add one bounded scheduler function and one cron-only route:

- `POST /api/work-os/evidence/activity-intervals/run-scheduled`, authenticated
  by `CRON_SECRET`, under `src/app/api/work-os/evidence/`.
- A new Agent OS timer runs it every five minutes, continuously. The
  active-session gate handles employee timezones, overnight shifts, and days
  with no work, so there is no server-time window to get wrong.
- The scheduler loads active sessions (`clocked_in` / `active`, clocked in
  within the last 24 hours), ordered by their next check-in deadline, then
  applies the same gates the employee path already uses: organization
  screenshot-summaries flag, activity-intervals flag, current tracking and
  screenshot consent, and a Worktivity mapping.
- For each eligible employee it asks the authoritative workday whether a prompt
  is due, calls the existing `ensureActivityInterval`, and then advances the
  prompt slot with the existing `deliverWorkdayPrompt` CAS. It never writes
  `work_check_ins` and never advances `last_substantive_update_at`.
- A `ready` result advances the prompt and counts as generated. An
  `unavailable` result (including `no_usable_frames`) advances the prompt and
  counts as skipped; the row remains for admin/recovery but is hidden from the
  employee queue. A `failed` synthesis does not advance, and the slot is not
  retried again for fifteen minutes (using the failed row's `updated_at`), so
  a provider outage cannot spend a model call every five minutes. Each employee
  is bounded to four slots per run and the run stops that employee at the first
  failure; one run attempts a failed slot once.
- The plan-hold recap may write the suggested goal through the existing path.
  If the day still has no goal after a successful recap, the scheduler does not
  re-run the goal suggestion on every tick; it stops that employee for the run
  and retries the hold at most every fifteen minutes. If the recap itself
  failed, the failure backoff governs the retry instead.
- A long server outage still produces at most one bounded catch-up recap
  (existing two-hour cap), then anchors the next prompt to the delivery time.
- One run processes at most 24 active employees by their earliest next
  deadline, so a larger roster advances oldest-first across runs instead of
  starving the same people. Overlapping HTTP runs coalesce through one
  in-process single-flight (the deployment is one web service); slot
  uniqueness and prompt-delivery CAS remain the data-level guard.
- The client `ensure` path remains as a fast path while the app is open; both
  paths are idempotent per prompt slot.

## Employee queue

`listActivityIntervals` returns only `preparing` and `ready` intervals. Rows
with `unavailable` or `failed` generation stay in the database for recovery,
admin review, and diagnostics, but they are omitted from the employee stream,
its `total`, and its cursors. The Recent activity panel therefore contains only
real recaps or one in-progress skeleton; a break or idle interval leaves no
trace.

Admin surfaces already read `generation_status = 'ready'` and remain unchanged.

## Launch surfacing

Add `GET /api/work-os/me/activity-intervals/latest`, owner-scoped:

- the newest `ready` interval regardless of review state, as the full card;
- the count of ready, `inferred` intervals in the same 30-day employee window.

The floating companion polls this endpoint on the existing review-notification
cadence (60 seconds) and immediately at launch:

- If the newest ready interval is `inferred`, put it in the existing collapsed
  recap bubble and fire one system notification. The chat window never opens
  itself.
- If the newest ready interval is already confirmed or amended, surface
  nothing. Older unapproved recaps stay in the queue.
- While the app stays open, surface a newly arrived newer ready recap once.
  A per-app-session high-water mark prevents an older recap from replacing a
  recap the employee just approved.
- On every new launch, the newest unapproved recap is surfaced again. This is
  a deliberate exception to the once-per-item notification registry in
  `design.md` §8.12, confirmed by the user.

The main window's recap flyout uses the same rule: only the newest ready recap,
only while it is `inferred`, announced again on a later launch, and no cascade
to older recaps after approval. The bell keeps its one recap row — the newest
ready, inferred recap — as it does today; older unapproved recaps remain in the
Recent activity queue rather than becoming extra bell rows. The floating window
owns the system toast; the main window uses the in-app flyout, so one recap
never fires two system notifications.

## Post-approval unapproved-recaps bubble

After a successful recap decision made in the floating companion, when Otto's
existing success beat has finished (the beat owned by `nextStepsCelebration`),
if the latest endpoint reports at least one remaining ready `inferred` recap,
show one compact mascot bubble:

> You have unapproved recaps
>
> `View recaps`

`View recaps` expands the floating companion on its Tasks tab, where the Recent
activity queue lives, and dismisses the bubble. The bubble waits while a recap
card or next-steps moment owns the bubble, dismisses on action, and never
appears when the queue's pending count is zero. It is keyboard reachable,
carries a visible focus ring, and reduced motion only removes its entrance.

The mascot bubble fires only for decisions completed in the floating companion,
where the success beat actually plays. If the next-steps moment is dismissed
with undecided items, produces no beat, or its generation fails, no mascot
bubble is forced for that decision; the next launch still surfaces the newest
unapproved recap normally.

Approving from the main companion window is answered in that window instead:
after the decision's success response, if another ready `inferred` recap
remains, one in-app flyout reads `You have unapproved recaps` with a
`View recaps` action that opens the dock's Focus tab where the stream lives.
This is the same in-app notification surface used by the rest of the main
window; it does not make the floating mascot perform a success beat it did not
show. The web workspace keeps its inline Recent activity queue and needs no
extra toast: the older recaps are already visible directly beneath the one just
approved.

## Non-goals

- No change to recap prompt, synthesis model, evidence selection, or approval
  wording.
- No new attendance mutation and no change to the check-in cadence defaults.
- No admin UI redesign and no companion version bump or release dispatch.
- No web auto-opening of chats; the web keeps its bell, flyout, and Recent
  activity stream.

## Constraints and builder calls

- Reuse `ensureActivityInterval`, `deliverWorkdayPrompt`,
  `activityIntervalFullView`, and the existing Work OS AI policy. Do not add a
  second model client or a second recap engine.
- The scheduled access must carry the real organization feature flags; the
  existing screenshot scheduler's empty flag object is not valid for `ensure`.
- Keep the server scheduler bounded and idempotent across overlapping runs.
  Existing slot uniqueness and prompt-delivery CAS remain the only claims.
- Add a narrow additive index only if the active-session query proves slow; do
  not add a table or migration for scheduling state.
- Every interval row created by the scheduler keeps the existing audit actions.
  System-scheduled audits use `actor_user_id = null` instead of attributing the
  AI generation to the organization owner.
- Add the timer service and timer to Agent OS `deploy/systemd`; Work OS deploys
  through that checkout. Install and verify the timer on the VPS after deploy.
- This is an employee-facing companion outcome: append one record to
  `desktop/work-os-companion/release-queue.json` and one `## Unreleased` line.
  Do not change app versions or dispatch a release.

## Acceptance

Focused tests first, watched failing, then green:

- scheduler due-slot advancement, skip-empty behavior, failed-retry hold,
  plan-hold stop, catch-up bound, and no check-in/substantive-update writes;
- employee list excludes `unavailable` and `failed` rows and keeps pagination
  totals contiguous;
- latest endpoint returns the newest ready recap and the correct pending count,
  scoped to the employee and organization;
- launch helper surfaces only the newest inferred recap, re-surfaces it on a
  new launch, and does not cascade after approval;
- post-approval mascot bubble appears only with a remaining pending count and
  opens the Tasks tab; the main-window flyout appears only after a main-window
  approval with older pending recaps and opens the Focus tab.

Then `work-os:typecheck`, the full `work-os:test`, production build, changed-file
lint, and one CodeRabbit pass. Render the floating companion at wide and narrow
sizes with the recap bubble, no pending recap, the post-approval bubble, keyboard
focus, reduced motion, and a no-activity queue; render the main-window
post-approval flyout; confirm no horizontal overflow or covered controls.

Live acceptance: deploy, install the Agent OS timer, confirm it runs and a recap
is generated with the companion closed, reopen and see only the newest recap in
the mascot and one notification, confirm older recaps are in the queue, and
confirm a break interval leaves no queue row.
