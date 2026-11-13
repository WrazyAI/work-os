# Otto memory visibility and recall repair

Ledger: `a61c1cb8-5db6-47f3-beb2-06f760be0c63`.
User approved fixing the diagnosed visibility/recall defects. Existing records
must not be recreated, deleted, auto-confirmed, or moved between people.

## Ordered checkpoint

- [x] Reproduce with PGlite: older confirmed facts survive a newer proposal flood;
  status-scoped keyset pages/counts remain tenant/person isolated; relevant old
  confirmed facts reach recall even after twelve newer unrelated facts.
- [x] Split server fact reads into independent confirmed/candidate pages and
  totals. Preserve `facts`/`recent` response compatibility for installed clients;
  the default response returns up to 50 of each, never a shared quota. Add
  status/cursor reads with validation and no-store responses. Rank confirmed
  recall by query relevance before recent fallback, under existing prompt budget.
- [x] Wire accurate totals and explicit independent Load more controls in the
  companion and web memory modal. Keep Keep/Discard/Forget, focus, and errors;
  invalidate both fact-page caches and summary after decisions.
- [x] Run focused/integration/render tests, typechecks, full suites/builds,
  wide/narrow rendered interactions, TestSprite and one CodeRabbit batch review.
  Record actual evidence before release-queue append.
- [ ] Reconcile server/web changes per file into Agent OS, verify, land/deploy
  through the existing workflow, read back actual live saved counts. Respect
  companion release cadence; distinguish server repair from installed UI release.

## Implementation calls

No migration. Stable ordering is `occurred_at DESC, id DESC`; cursors are
validated timestamp/UUID pairs and filters precede pagination. Candidate facts
never enter the confirmed recall lane. Recent confirmed facts remain the fallback
when the query has no matches. Existing same-day tentative context stays distinct.
The saved/review tabs retain their existing design, adding only counts and the
quiet explicit pagination edge. Load failures preserve already loaded rows.

## Verification checkpoint

Work OS suite 1318 pass, 0 fail, 11 opt-in skips; companion 215 files/1922
tests pass. Both typechecks and builds pass. Real query-observer tests cover
arrivals/removals while the modal stays open and failed exhausted-list refresh
retry. CodeRabbit completed with two minor findings; both fixed and tested.
Playwright at 1440/1024/390: independent paging, retained rows on paging error,
focus, Escape/reopen, reduced motion, no horizontal overflow or page errors.
TestSprite existing case `60488eda-f25a-40b8-8922-1b6a304c8616` was refused
with `FEATURE_GATED`, `billing_hold`, `payment_failure`; not a product verdict.
No billing changes or retries made. Server/web port applied per-file to
`agentos-memory-persistence`; memory tests and Work OS typecheck pass there.

Final GitHub review also found stale decision-page caches after a successful
save followed by a failed refresh, and query cancellation replacing the default
timeout. Both fixed with real failing-then-passing query tests; confirmed
decisions now settle shared web/companion cache reducers before revalidation,
and page reads combine cancellation with the 20-second deadline. Final full
suites/builds are recorded under `.superpowers/memory-persistence/` (ignored).
