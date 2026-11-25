# Desktop structured EOD — design

Status: approved 2026-11-25. Replaces the desktop companion's legacy markdown
EOD editor for new drafts. The legacy editor stays for historical drafts and
raw recovery.

## Intent

The installed companion should compose the same structured end-of-day report
as the web workspace:

- Server-prepared suggestions from the recorded day.
- Employee-written Completed, In progress and Next sections.
- A summary written only after all three sections have a line, streamed, and
  invalidated by any later edit.
- Immutable, source-grouped evidence.
- One optional Loom share link, stored but not analyzed.
- Submission that produces the same structured brief and deterministic full
  record the web and admin review already read.

The deterministic markdown document remains the report's record and fallback.
No new report model, endpoint, or migration is introduced.

## Goals

- Reach functional parity with the web structured composer for new drafts.
- Preserve the companion's existing clock-out prompt, draft delete, screenshot
  gallery, offline queue, window geometry, and 560px bottom navigation.
- Keep historical reports readable and editable without silently converting
  them.

## Non-goals

- Loom analysis. The link is stored and displayed only.
- Migrating historical markdown drafts to structured drafts.
- New Tauri commands or ACL grants.
- New server routes, tables, or migrations.
- Releasing the companion. This change joins the release queue; the five-
  outcome threshold still applies.

## Decisions

- **Replace, don't dual-run.** New drafts with a version-1 structured payload
  render `EodStructuredComposer`. A report without one renders the existing
  `EodComposer`. There is no switcher for the same draft.
- **One contract.** Types come from
  `src/modules/work-os/eod-structured.ts` as type-only imports. The four small
  runtime helpers the companion needs are mirrored in
  `desktop/work-os-companion/src/eodStructured.ts` and pinned by a parity test.
- **Server-prepared.** The production timer already prepares due days. The
  companion calls `POST /api/work-os/me/eod/prepare` once for today's draft
  only when the payload is absent; historical drafts are never auto-converted.
- **Same writes.** Autosave uses `PATCH /api/work-os/reports/:id`; submit uses
  `PATCH /api/work-os/reports/:id/submit` with `{ structured }`. The server
  composes markdown, writes versions, and keeps the appendix.
- **Honest offline.** All writes go through `sendOrQueue`. A queued save or
  submit is labelled queued, never delivered. Submission carries an
  idempotency key. A `409` save conflict reloads the report and keeps the
  employee's buffer for an explicit choice.
- **Desktop layout.** 1000px default, 720px minimum. Section labels sit beside
  fields above 820px and stack below it. Suggestion pills are two-up, then a
  horizontal snap rail below 700px. The save state, submit reason and submit
  action stay in a sticky footer.

## Acceptance

- A new draft opens with empty sections, prepared suggestion rails, and a
  summary that says it is waiting for entries.
- Adding one line to each section unlocks the summary; the summary streams and
  stores its composition signature.
- Editing any line after the summary marks it stale and disables submission
  until it is refreshed.
- Evidence is read-only, grouped by source, and cannot be edited. An attached
  Loom appears on the report and in the submitted brief.
- Submitting files the same structured brief the web files; the markdown
  document and full record still exist.
- A queued submit says it is queued; a `409` save preserves the employee's
  text.
- A historical markdown draft still opens in the legacy editor.
- At 720px and 560px there is no horizontal overflow, and the bottom bar and
  sticky footer remain reachable.

## Risks

- **Serialized saves.** A save in flight must not drop later keystrokes. The
  component keeps a dirty flag, queues the latest snapshot, and retries once
  the current save finishes.
- **Optimistic concurrency.** The server compares `updated_at`. A queued or
  slow save can lose the race; on `409` reload and keep the buffer.
- **Stale gate bypass.** The client disables submit, but the server remains the
  authority. The component must send the signature it actually rendered.
- **Summary source.** An assembled fallback must not be labelled Otto.
- **Legacy selection.** Selection is by payload version, never by app version
  or a build flag, so an old draft cannot render an empty structured composer.
