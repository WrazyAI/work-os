# Companion release policy

Ship one companion update after **five completed, verified features/fixes**.
This applies to Windows/macOS installers and the desktop updater, not web
deployments or ordinary validation CI. The nightly macOS check is unchanged.

## Record an update

1. Finish and verify a distinct employee-facing outcome.
2. Append an entry to `desktop/work-os-companion/release-queue.json`:

   ```json
   {
     "id": "downloads-resume-after-network-failure",
     "type": "fix",
     "summary": "Downloads resume after a network interruption.",
     "verification": "Actual test command and result, or a link to the verified ledger outcome."
   }
   ```

3. Add a plain-language note under `## Unreleased` in the companion changelog.
4. Run `npm run companion:release:status` from the repository root. It needs GitHub
   CLI read access (`gh auth status`); it does not build, publish, bump versions
   or change the queue. Provider/read errors are blockers, not a zero count.
5. Rebase on latest main before pushing. Keep stable IDs when resolving conflicts.

One coherent feature/fix is one update even if it took several commits, tests,
follow-ups or changelog bullets. Internal tooling, docs, refactors and dependency
maintenance do not count unless they deliver a distinct employee-facing outcome.
Never add placeholders for unimplemented or unverified work. The queue's
verification references are an agent responsibility, not proof inferred by CI.

The initial queue preserved the four employee outcomes that were Unreleased
since published 0.5.16. Release-cadence tooling does not add a fifth outcome.
The pre-policy 0.5.17 build at
`eb1784f50b3453ca39e499b3b2ae867af159547b` was cancelled without publishing;
`release-baselines/0.5.17.json` preserves that cancelled snapshot and consumes
nothing. The four outcomes then shipped in 0.5.18 at
`a545e518e4cd33a9151c5d45fe9b53c5fd610b55`. Its published snapshot is archived
in `release-baselines/0.5.18.json` and counts those outcomes as consumed,
leaving zero pending. Do not restart 0.5.17; the next companion release is the
next patch after 0.5.18 once five new outcomes are queued.

## Updates one through four

Merge normally, leaving the current companion version unchanged. Do not create
a release tag or manually run packaging. Web changes may deploy normally.

## The agent landing update five

1. Rebase and inspect `companion:release:status`; review all pending outcomes.
2. Increment the latest published companion version by one patch. Synchronize
   companion `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`
   and relevant lockfile metadata using the established release procedure.
3. Move the pending notes from `## Unreleased` to
   `## <canonical-version> — <YYYY-MM-DD>` using the ship date.
4. Set `emergency` to `null` for an ordinary release. Keep all queue entries;
   **never clear the queue**, even after release.
5. Run the usual verification, merge the version bump into main, and monitor
   the single automatic release pipeline. No separate tag push/manual dispatch
   is normally needed: those would only enqueue redundant preflights. If an
   unpublished version is already reserved after a cancelled/failed attempt
   and no later version has published, keep that version and start one fresh
   dispatch once the batch is eligible.
6. Verify publication and the installer/updater flow, not just workflow exit.

If more than five outcomes accumulate before the release snapshot, release all
of them together. Commits that land after that snapshot remain pending for the
next batch. The latest published release's queue snapshot is the consumption
boundary; no reset commit can race another agent's new update.

## Emergency exception

Release below five **only** to restore a broken app or unblock an essential
function. Name a pending `fix` and commit a version-scoped record in the queue:

```json
"emergency": {
  "version": "0.5.17",
  "updateId": "restore-sign-in-after-startup-crash",
  "brokenBehavior": "Installed app crashes before employees can sign in.",
  "restoredBehavior": "The fix restores startup and employees can sign in again."
}
```

The fix must also have its verified update entry. Explain the emergency in the
release handoff. The gate checks the record's shape, pending fix and exact
version; agents remain accountable for the truth of the incident and evidence.
An arbitrary dispatch flag cannot override it. After publication this batch is
consumed like any other; clear the emergency record before the next bump.

## Failures, retries and concurrency

- Failed builds, unpublished drafts and bare tags consume **zero** updates.
  Fix the build and retry the same committed version/snapshot through a manual
  dispatch on main; preserve the unsigned-publication acknowledgement.
- Use a **fresh workflow dispatch**, not GitHub's **Re-run jobs** or **Re-run
  failed jobs**. Successful job outputs are cached across reruns, so packaging
  and publication jobs reject attempts after the first; each fresh dispatch
  checks current release eligibility before any paid runner is allocated.
- Any existing candidate tag, lightweight or annotated, must resolve to the
  exact source commit being built. A mismatched tag blocks packaging and
  publication; reconcile it explicitly rather than moving it silently.
- If a draft already targets an older commit, do not overwrite or silently
  repoint it. Follow the existing draft-integrity failure and reconcile its
  target explicitly before retrying; the batch stays pending meanwhile.
- An already published version is skipped before packaging, even if a tag push
  or manual dispatch enqueues it again. Never rebuild/overwrite its assets.
- Release workflows remain serialized across refs. Publication rechecks the
  live published baseline immediately before publishing. External/manual GitHub
  release publication must not bypass this workflow; repository administrators
  still control permissions and can change workflows or release objects.
- Missing or malformed post-policy snapshots fail closed. Only the known
  pre-policy 0.5.16 baseline has an empty historical queue; the cancelled
  0.5.17 build and the published 0.5.18 release each have a source-pinned
  historical snapshot. No API/read error can create a new baseline.

## Verification commands

```bash
node --test test/work-os-companion-release-gate.test.mjs test/work-os-macos-release.test.mjs test/work-os-release-policy.test.mjs
npm run work-os:typecheck
npm run work-os:test
npm run companion:release:status
```

`check` is the workflow-only preflight and emits job eligibility after all
checks. `verify` requires eligibility and is run immediately before publication.
Both validate release-source ancestry on main, append-only queue history,
canonical synchronized versions and dated release notes before any release.
