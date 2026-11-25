# Employee EOD review

**Use when:** Changing employee EOD availability, drafts, deletion, report content, or wrap-up prompts.

**Owns:** Employee EOD gates, the brief/full-record document, and scheduled wrap-up priority.

**Requires:** [Shared foundations](../foundations.md) (read each once per task).

**Read next only if:**

- Changing input/review/submission UI: [Workflow dialogs and submission confirmations](../patterns/workflow-dialogs.md).
- Changing flexible-work availability: [Profile, connected accounts, and work arrangements](profile-and-schedule.md).
- Changing activity context: [Activity interval reviews](recaps.md).
- Changing administration EOD review: [Administration EOD review](../admin/eod-review.md).
- Changing the manager Team review console: [Manager role routing](web-workspace.md#manager-team-review).

**Implementation starting points:** [EmployeeEodComposer.tsx](../../../src/modules/work-os/employee/EmployeeEodComposer.tsx), [eod-structured-view.tsx](../../../src/modules/work-os/eod-structured-view.tsx), [work-os-eod-structured.ts](../../../src/lib/work-os-eod-structured.ts), [work-os-eod-schedule.ts](../../../src/lib/work-os-eod-schedule.ts), [EodReportDocument.tsx](../../../desktop/work-os-companion/src/EodReportDocument.tsx), [EmployeeReview.tsx](../../../src/modules/work-os/employee/EmployeeReview.tsx), [work-os-eod-shift-gate.ts](../../../src/lib/work-os-eod-shift-gate.ts).

## The structured web composer

The employee's web EOD is a structured composition, not a markdown editor.
The deterministic report remains the day's full record; the composer owns the
three short sections the employee signs their name to.

- **Prepared before the employee arrives.** A bounded scheduler calls
  `POST /api/work-os/eod/run-scheduled` (the `work-os-eod.timer` unit) and
  prepares each due day with the same shift gate the employee surface uses.
  It stores server-owned suggestions and an evidence snapshot. Opening the
  page before the scheduler ran asks the same server-side preparation once; the
  employee never presses a "Draft EOD" button.
- **Suggestions are the analysis, not a filled report.** Up to five lines per
  field come from the day's completed work, the employee-reviewed activity
  recaps, and the carried plan. They render as a horizontally scrollable pill
  rail (two visible at a time on desktop). Clicking a pill adds one reviewable
  line; the employee can type their own. The structured draft starts with empty
  fields.
- **Summary last.** Once Completed, In progress and Next each have a line, the
  employee can write the summary. The model streams a short paragraph from the
  employee's own lines, grounded in the recorded facts. The server stores the
  composition signature with the summary; any later edit makes it stale, and
  submission is refused until it is regenerated. A provider outage produces an
  explicitly labelled assembled fallback rather than blocking the day.
- **Evidence is fixed.** The evidence snapshot is grouped by source and shown
  as a read-only accordion. The employee cannot edit or remove a source here.
  GitHub and Loom records keep their reviewable links. Raw screenshot evidence
  remains in its existing gallery below the report.
- **Optional Loom.** The composer accepts one optional Loom share link. It is
  employee-provided, not system-recorded evidence, and it does not change the
  recorded evidence count. This pass stores and displays the link only; it is
  not analyzed by Otto.
- **One richer report everywhere.** The employee's submitted view and the
  admin review render the same `EodStructuredView` (summary, three sections,
  Loom, source-grouped evidence). Historical reports without a structured
  payload fall back to the parsed markdown. The admin also keeps the deep raw
  evidence and activity-context panels.
- **The full record still belongs to the server.** Submission composes the
  employee's words into the deterministic document's brief and keeps the
  `## Full record` appendix. Memory, versions and the companion's document read
  that markdown; the structured payload is the source for the web composer and
  the admin brief.

## EOD drafts before clock-out, and deleting a draft

An end-of-day report describes the day. For a scheduled arrangement, today's
report opens in the final ten minutes before the scheduled clock-out and stays
open after it, even while the shift is running. Flexible arrangements follow
their explicit availability rule below; they have no scheduled end to wait for.

- **The gate.** For scheduled arrangements, a shift is open while the mirrored
  session is still running or a fresh Worktivity observation says the employee
  is active or paused. One
  predicate (`shiftStillOpen`) decides this for the server, the web workspace,
  and the companion; a second (`eodDraftBlocked`) adds the ten-minute window.
  Today is blocked only before that window. An earlier day — whose shift already
  ended — stays draftable so a backlog is never stranded. The window is anchored
  to the day's scheduled end (`scheduled_ends_at` on the mirrored session, with
  the day's schedule as a fallback). For a scheduled arrangement, a day
  without a resolved scheduled clock-out has no early window and stays blocked
  until the shift closes. For a flexible arrangement, today's EOD opens once
  work has started or the day has closed, with no scheduled end required; see
  [work arrangements](profile-and-schedule.md#work-arrangements-and-fixed-day-flexible-hours).

  **Implementation follow-up:** The [server gate](../../../src/lib/work-os-eod-shift-gate.ts)
  branches for flexible work, while the EOD UI gates in
  [App](../../../desktop/work-os-companion/src/App.tsx) and
  [EmployeeReview](../../../src/modules/work-os/employee/EmployeeReview.tsx)
  call the scheduled helper. Verify flexible availability in both clients when
  changing this gate. This possible existing discrepancy has not been runtime
  verified or fixed by the documentation refactor.

- **The server refuses it too.** For scheduled arrangements, creating a
  report and asking the assistant for a fresh narrative both answer `409` with the reason `shift_open` before
  the window. Refining a draft that already exists stays available: that day is
  already recorded.
- **The prompt.** For scheduled arrangements, before the window the surface
  names the ten-minute opening and offers clock-out for employees who are
  finishing early. The clock-out is inline text, underlined, and behaves like
  the action it names: in the
  companion it returns to the dashboard, where the Clock out button closes the
  shift; on the web it returns to Today, which names the Windows Companion as
  the surface that closes a shift. The prompt replaces the draft action rather
  than sitting beside it; once the window opens, the draft action replaces the
  prompt without a refresh.
- **Deleting a draft.** The companion composer and the legacy web editor carry
  one destructive action beside their draft-building controls: `Delete draft`,
  in red, with a trash glyph. The structured web composer does not expose
  deletion. It is offered only for an unsubmitted draft, it asks for confirmation
  in the shared removal dialog, and it is refused by the server for a report
  that is already with a manager. A deletion is written to the audit log; the
  report's versions go with it.

## The EOD document: a brief, then the full record

The draft is deterministic. The same recorded facts always produce the same
document; no model decides what the day contained. The web composer is the one
place a model writes: its summary is constrained to the employee's own three
sections and is stored with the signature of the composition it was written
for. It never chooses what the day contained, and the full record appendix
below it stays deterministic. The older `Refine draft` and Loom-analysis paths
remain for the companion and legacy clients, not the web composer.

- **The brief** is the first reading depth: `Summary`, `Completed today` (at
  most eight ranked work deliverables), `In progress` (at most three confirmed
  or amended recap headlines), `Blocked`, `Next`, `Plan check` only when the
  stored plan disagrees with the task record, and `Evidence` with the day's
  counts. Empty optional sections are omitted.
- **The full record** is the second depth: every work completion, explicit
  carry or defer, routine run, other task (personal, test, administrative),
  activity recap with its provenance and full detail, hourly rollup, output
  evidence, and Loom recording. It is a disclosure, never a second page.
- **Ranking** is deterministic: plan-linked outcomes and tasks first, then
  output evidence, project context, exact and in-shift completions. Repeated
  titles collapse to one row with `×N`; the appendix keeps the count.
- **Completion times** appear only for exact provider or employee instants.
  A provider-observed sync time never becomes a work time.
- **Personal, test, and administrative tasks** stay out of the brief and are
  listed under `Other tasks` in the full record. A task's project or a
  conservative title fallback classifies it; the report never guesses silently.
- **Activity context** contributes confirmed or amended recap headlines to `In
  progress` unless a completed task already carries that work. Inferred recaps,
  full detail, and hourly rollups stay in the full record. Activity context is
  never completion, and the closing disclaimer says so.
- **GitHub** is reported as unique pull requests and exact commit, workflow,
  and deployment counts, labelled provider-recorded. It never becomes task
  completion.
- **The server owns the document.** Both the web workspace and the companion
  render the same markdown through the shared parser; the employee may edit the
  source, but the submitted report keeps the same headings and the same
  brief/appendix split.
- **The page reads as a day edition.** A dateline carries the role, session,
  and goal; the summary is the lead at reading size; completed work groups by
  project so the project is stated once for a run of rows; the full record is
  a disclosure beneath the brief. The document has one measure and one action
  (`Submit EOD`), not a second dashboard.

## Wrap-up prompts and recap context

For scheduled arrangements, the EOD alert opens ten minutes before the shift
end and outranks a ready recap in the compact bubble: the mandatory wrap-up
never hides behind an undecided recap, which stays reachable in the chat and the notifications
panel. It stays live through clock-out — the mascot keeps its wrap-up state
instead of resting — until the report is submitted or one hour past the
scheduled end, when the mascot rests again and the day stays in the outstanding
EOD list. While the session is still open the alert never takes the composer:
the employee can keep sending updates and editing a recap through the lead
window, and clock-out hands the composer's moment to the EOD page; the final
ten-minute window opens the EOD draft without taking that composer away. A day
without a scheduled end follows the server's EOD signal alone.

The EOD uses a confirmed, amended, or inferred recap as activity context for
the hours it covers, labeled with its provenance, and falls back to the hourly
rollups elsewhere. A confirmed recap is still activity context: it never proves
task completion. Recap text outlives raw images under the report-retention
policy, and raw preview access keeps its existing own-frame or flagged/dispute
rule and audit.
