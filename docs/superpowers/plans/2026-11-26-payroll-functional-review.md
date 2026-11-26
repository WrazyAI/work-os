# Payroll functional review and analysis windows

Ledger: ee2dbe64-d0d2-4685-98e0-9a59cbe40ba6

## Outcome

An admin can open a payroll review and act on every flagged interval, open the
linked evidence frame through the guarded path, start or resume analysis without
waiting for a pay date, choose any bounded analysis window (including a partial
current period), and read the page below the charts as one coherent review
surface on web and in the Companion.

## Confirmed rules

- Payroll remains admin-only. Approvals remain immutable receipts; changed
  evidence still requires an explicit audited reopen.
- Break time is never payable and never a finding decision. Continuous verified
  inactivity of 3+ minutes is auto-excluded unless meeting, training, reading,
  or work evidence covers it. Contradictory evidence stays held.
- Frame access still requires a linked finding, a recorded reason, current
  tracking and screenshot consent, an unexpired summary, and a non-sensitive
  image.
- App usage is context only and never changes payable hours.

## Work

1. **Screenshot person scope (data integrity)**
   - Populate `work_screenshot_summaries.person_id` on every analysis write.
   - Add an additive migration that backfills from `work_evidence_events` and
     enforces the link on insert/update.
   - Regression test: a summary inserted without a person is scoped to its
     evidence event and can be read by the payroll source query.

2. **Run advancement**
   - Add a bounded drain that steps a run until done, failed, cancelled, or the
     time budget is reached, with stall detection.
   - Use it from the cron route, the run POST route, and the start route via
     Next `after()` so starting analysis does not just queue.
   - Poll/advance from the web and Companion while a run is active.
   - Expose cancel for an active run; do not let a failed run freeze the last
     published revision.
   - Regression tests: one drain publishes the revision and both briefs; a
     stalled provider page fails honestly instead of looping forever.

3. **Arbitrary windows**
   - Add `resolvePayrollWindow(from, through, timezone, now)` with week splits,
     a pay-date anchor, date validation, and a bounded length.
   - Store `window_key` on reviews; replace the fixed-period unique/check
     constraints with `(organization, person, window_key)` and period sanity
     checks. Keep `pay_date` as the pay-date anchor.
   - Runs and reads must use the stored `period_start`/`period_end`, never
     recompute a full period from `pay_date`.
   - API: start accepts `from`/`through`; roster/review projections carry the
     stored period; review page accepts `reviewId` plus `from`/`through`.
   - UI: date-range control defaults to the current window, capped at today;
     prior windows remain selectable; New audit sends the chosen window.
   - Companion parity for the range and start payload.
   - Tests: full, partial, invalid, future, too-long, and prior windows; a run
     on a partial window only writes days inside it.

4. **Interactions and layout**
   - Enable finding decisions whenever the posted revision is mutable, not only
     when the review happens to be `needs_review`.
   - Show guarded frame access wherever linked frames exist, including the
     excluded ledger; keep break rows "No frames by policy".
   - Put the review queue immediately after Hours, with excluded rules, daily
     evidence, briefs, then app context. Make apps and briefs collapsible.
   - Companion mirrors the same action availability and order.
   - Render tests cover actions, frame buttons, and the new section order.

## Verification

- Focused: payroll period, runs, screenshots, reads, decisions, UI, schema.
- Typecheck: `npm run work-os:typecheck`.
- Full suite: `npm run work-os:test`.
- Rendered desktop and narrow states; TestSprite where the existing fixture
  applies.
- Signed-in production check after deployment: actionable finding, frame
  access, immediate analysis, partial window, and prior window.

## Checkpoint

- [ ] Screenshot person scope + migration + tests
- [ ] Immediate drain + cancel + tests
- [ ] Arbitrary window schema/API/UI/Companion + tests
- [ ] Interaction and layout pass + render tests
- [ ] Focused/typecheck/full-suite/rendered gates
