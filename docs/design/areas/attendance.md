# Attendance and provider freshness

**Use when:** Changing clock actions, activity-driven clock-in/out, polling, or attendance presentation.

**Owns:** Worktivity authority, pending actions, platform differences, and freshness.

**Requires:** [Shared foundations](../foundations.md) (read each once per task).

**Read next only if:**

- Changing command-surface layout: [My Day and Today dashboard](dashboard.md).
- Changing scheduled or flexible workday behavior: [Profile, connected accounts, and work arrangements](profile-and-schedule.md).
- Changing end-of-day gates: [Employee EOD review](eod-review.md).

**Implementation starting points:** [attendanceWatch.ts](../../../desktop/work-os-companion/src/attendanceWatch.ts), [planningGate.ts](../../../desktop/work-os-companion/src/planningGate.ts).

## Worktivity attendance controls

The Windows Companion is the only Work OS surface that can initiate attendance
changes. Clock in, clock out, pause, and resume follow this sequence:

1. Read fresh Worktivity status and check whether the requested state is already
   reached or whether the action is allowed.
2. Preserve required late-start, exception-start, and extended-shift
   confirmations. Explain when Worktivity is unavailable, unconfigured, or
   cannot be controlled.
3. Open Worktivity when it is closed. If it is already running without a
   controllable page, restart it through the approved graceful-close and
   bounded force-close path, and show that Worktivity is being restarted.
4. Make one desktop action through Worktivity's own interface, then read fresh
   provider status. Do not queue attendance actions offline or repeat a click
   after an ambiguous result.
5. Show a pending state with a read-only status retry when Worktivity has not
   confirmed the result. Disable the other attendance controls while pending.
   A provider-confirmed result is the receipt; a click or successful process
   launch is not.

Worktivity owns attendance state and timestamps. Work OS mirrors fresh provider
state into its session ledger while retaining its work planning and review
state. Provider state wins a conflicting session state. If the provider reports
clock-out without an exact time, use the first fresh off-shift observation as
the boundary and label the time as inferred in both the attendance observation
and its audit event. Keep closed sessions as history. Web surfaces may display
provider status and freshness but must not initiate attendance mutations.

## Attendance freshness: activity-driven clock-in and clock-out

Worktivity owns attendance: activity alone can start or close a workday. Work OS
must reflect a provider-observed transition without waiting for a manual
refresh.

- Clients poll `POST /api/work-os/attendance/observe` every **30 seconds while
  a transition is expected** — from two minutes before a startable shift with
  no mirrored session, and while an active session runs past its scheduled end
  or the provider has already observed the close — and every **60 seconds once
  the state is steady**. The five-minute background reconciliation remains for
  devices with no window open.
- The endpoint converges the active session from fresh provider activity (the
  same path a full day refresh takes) and returns whether the tracked
  attendance-and-session signature actually moved. Only a real transition
  refreshes the workspace; the main window relays it so the floating companion
  and every workspace view converge together.
- While an activity-driven transition is expected, the dashboard shows one
  quiet line (`Checking your activity…`) beside the state copy. Activity polling
  alone leaves the manual Clock in, Pause/Resume, and Clock out controls
  available. Manual actions keep their existing Worktivity confirmation flow:
  while an action is unconfirmed, its pending-action lock takes precedence,
  disables the other attendance controls, and offers a read-only status retry.
- Provider reads are cached for 25 seconds and single-flight per employee, so
  two windows polling together never stampede the provider. The cache belongs to
  the background cadence, never to an explicit request: a page load, the refresh
  control, the day's attendance sync, and the companion's first check after
  launch all ask Worktivity immediately (`?refresh=1`), so a clock-out made in
  Worktivity lands on that refresh instead of the next poll.
- A transition observed in Worktivity alone is only as fresh as the last
  provider read. The desktop webview may reach the API cross-origin, so the
  preflight allow-list names every header the companion sends — including the
  desktop control marker and the machine cadence overrides. A missing header
  fails the preflight and surfaces as `Failed to fetch` before any route runs.
