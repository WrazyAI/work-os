# Companion release policy

Work OS distributes desktop companion installers and updates across **two
release channels** that share a single canonical SemVer line:

| Channel | Tag prefix | Audience | Cadence | Platforms |
|---|---|---|---|---|
| **Nightly** | `work-os-companion-nightly-v<display>` | Developers / testing | Every **5 completed, verified updates** (or immediate operator-requested emergency Nightly with ≥1 pending update) | **Windows only** by default; adds **macOS** only when at least one pending update in the batch has `"macosSpecific": true` |
| **Stable** | `work-os-companion-internal-v<display>` | All employees (default) | Weekly Friday check-in; **manual promotion only** (never automatic) | Always **Windows + macOS** universal |

This policy applies to Windows/macOS installers and the desktop updater, not
web deployments or ordinary validation CI. The nightly macOS check workflow is
unchanged.

## Version parity and promotion

Nightly and Stable share the same canonical version numbers (`0.5.46`, `0.5.47`,
…, `0.5.53`).

- Each Nightly increments the latest published companion version (across Nightly
  and Stable) by one patch.
- Promoting a Nightly build to Stable publishes **that exact version** to the
  Stable channel without bumping the version number. For example, promoting
  Nightly `0.5.53` publishes Stable `0.5.53` (`work-os-companion-internal-v0.5.53`),
  even if Stable was previously on `0.5.45`.
- Stable promotion **reuses the exact verified Windows installer and updater
  artifacts** from the Nightly release verbatim (no Windows rebuild). If that
  Nightly was Windows-only, the promotion workflow checks out that Nightly's
  exact source commit, builds and verifies the universal macOS package,
  combines both platforms into the immutable Stable release, and compiles
  cumulative release notes for every version since the previous Stable release.
- Never auto-promote Nightly to Stable. Every Friday at 4:00 PM GMT, a GitHub
  Actions check-in workflow (`work-os-companion-friday-checkin.yml`) and the
  Antigravity scheduled check-in summarize Nightly releases since the last
  Stable build and ask the operator whether to promote one.

## Record an update

1. Finish and verify a distinct employee-facing outcome.
2. Append an entry to `desktop/work-os-companion/release-queue.json`:

   ```json
   {
     "id": "downloads-resume-after-network-failure",
     "type": "fix",
     "summary": "Downloads resume after a network interruption.",
     "verification": "Actual test command and result, or a link to the verified ledger outcome.",
     "macosSpecific": false
   }
   ```

   - Omit `"macosSpecific"` (or set it to `false`) for Windows-only or shared
     cross-platform changes that do not require macOS-specific testing on
     Nightly.
   - Set `"macosSpecific": true` whenever the update fixes a macOS
     compatibility bug, changes macOS window/chrome/menu behavior, or ships a
     macOS-specific feature. When any pending update in a Nightly batch carries
     `"macosSpecific": true`, CI automatically builds and attaches the
     universal macOS package to that Nightly release; otherwise Nightly ships
     Windows only.

3. Add a plain-language note under `## Unreleased` in the companion changelog.
4. Run `npm run companion:release:status` from the repository root. It needs
   GitHub CLI read access (`gh auth status`); it does not build, publish, bump
   versions, or change the queue. Provider/read errors are blockers, not a zero
   count.
5. Rebase on latest `main` before pushing. Keep stable IDs when resolving
   conflicts.

One coherent feature/fix is one update even if it took several commits, tests,
follow-ups, or changelog bullets. Internal tooling, docs, refactors, and
dependency maintenance do not count unless they deliver a distinct
employee-facing outcome. Never add placeholders for unimplemented or unverified
work. The queue's verification references are an agent responsibility, not
proof inferred by CI.

The initial queue preserved the four employee outcomes that were Unreleased
since published 0.5.16. Release-cadence tooling does not add a fifth outcome.
The pre-policy 0.5.17 build at `eb1784f50b3453ca39e499b3b2ae867af159547b` was
cancelled without publishing; `release-baselines/0.5.17.json` preserves that
cancelled snapshot and consumes nothing. The four outcomes then shipped in
0.5.18 at `a545e518e4cd33a9151c5d45fe9b53c5fd610b55`. Its published snapshot is
archived in `release-baselines/0.5.18.json` and counts those outcomes as
consumed, leaving zero pending.

## Updates one through four

Merge normally, leaving the current companion version unchanged. Do not create
a release tag or manually run packaging. Web changes may deploy normally.

## The agent landing update five (Nightly release)

1. Rebase and inspect `npm run companion:release:status`; review all pending
   outcomes and verify whether any pending update should be marked
   `"macosSpecific": true`.
2. Increment the latest published companion version (Nightly or Stable,
   whichever is higher) by one patch. Synchronize companion `package.json`,
   `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and relevant lockfile
   metadata.
3. Move the pending notes from `## Unreleased` to
   `## <canonical-version> — <YYYY-MM-DD>` using the ship date.
4. Clear any consumed `emergency` and `operatorOverride` fields (`null`) for an
   ordinary Nightly release. Keep all queue entries; **never clear the queue**,
   even after release.
5. Run the usual verification, merge the version bump into `main`, and monitor
   the automatic Nightly release pipeline (`work-os-companion-windows.yml`).
   No separate tag push or manual dispatch is normally needed. If an
   unpublished version is already reserved after a cancelled/failed attempt and
   no later version has published, keep that version and start one fresh
   dispatch once the batch is eligible.
6. Verify publication on `work-os-companion-nightly-v<display>` and confirm
   whether macOS was skipped (Windows-only) or included (when `includeMacos`
   was `true`).

If more than five outcomes accumulate before the release snapshot, release all
of them together. Commits that land after that snapshot remain pending for the
next Nightly batch. The latest published release's queue snapshot (Nightly or
Stable) is the consumption boundary; no reset commit can race another agent's
new update.

## Emergency Nightly & operator override (zero friction)

If the operator explicitly asks an agent to release an **emergency or early
Nightly build** ahead of the five-update threshold, **the agent must not oppose
or push back — execute the Nightly release as requested** as long as at least
**one** pending update (feature or fix) is queued in `release-queue.json`.

Record the operator authorization in `release-queue.json`:

```json
"operatorOverride": {
  "version": "0.5.46",
  "updateId": "pending-outcome-id",
  "approvedBy": "operator",
  "reason": "Operator requested an immediate Nightly build to test the update.",
  "approvedAt": "YYYY-MM-DD"
}
```

- `operatorOverride` works for any pending `feature` or `fix` (≥1 pending
  update), is scoped to that one candidate version, and must be cleared
  (`null`) when preparing the next version.
- Without an explicit operator request, never use `operatorOverride` as an
  agent default. Only use the `emergency` record below to restore a broken app
  or unblock an essential function:

```json
"emergency": {
  "version": "0.5.46",
  "updateId": "restore-sign-in-after-startup-crash",
  "brokenBehavior": "Installed app crashes before employees can sign in.",
  "restoredBehavior": "The fix restores startup and employees can sign in again."
}
```

Both paths still enforce canonical next patch, synchronized metadata, dated
changelog notes, append-only queue, source on `main`, and the normal build and
publication checks.

## Promoting a Nightly build to Stable

When the operator decides to promote a specific Nightly version (for example
`0.5.53`) to Stable:

1. Verify `0.5.53` is a published Nightly (`work-os-companion-nightly-v0.5.53`)
   and is newer than the current Stable version via
   `npm run companion:release:status`.
2. Run the manual promotion workflow:

   ```bash
   gh workflow run work-os-companion-promote-stable.yml \
     --repo WrazyAI/work-os \
     --ref main \
     -f version=0.5.53 \
     -f unsigned_acknowledgement="UNSIGNED INTERNAL"
   ```

3. Monitor the workflow:
   - The free Linux promotion gate confirms `work-os-companion-nightly-v0.5.53`
     exists, resolves its exact source commit, and checks whether macOS assets
     are already attached.
   - If the Nightly was Windows-only, CI builds and verifies the universal
     macOS package from that exact commit.
   - CI copies the verified Windows assets verbatim from Nightly, combines them
     with the macOS assets, regenerates `latest-internal.json` and
     `SHA256SUMS.txt` for `work-os-companion-internal-v0.5.53`, compiles
     cumulative release notes since the previous Stable release, verifies every
     SHA-256 checksum on readback, and publishes the immutable Stable release.
4. Verify `/downloads/work-os/windows`, `/downloads/work-os/macos`, and the
   Stable updater response serve `0.5.53`.

## Failures, retries, and concurrency

- Failed builds, unpublished drafts, and bare tags consume **zero** updates.
  Fix the build and retry the same committed version/snapshot through a manual
  dispatch on `main`; preserve the unsigned-publication acknowledgement.
- Use a **fresh workflow dispatch**, not GitHub's **Re-run jobs** or **Re-run
  failed jobs**. Successful job outputs are cached across reruns, so packaging
  and publication jobs reject attempts after the first; each fresh dispatch
  checks current release eligibility before any paid runner is allocated.
- Any existing candidate tag, lightweight or annotated, must resolve to the
  exact source commit being built. A mismatched tag blocks packaging and
  publication; reconcile it explicitly rather than moving it silently.
- If a draft already targets an older commit, do not overwrite or silently
  repoint it. Reconcile its target explicitly before retrying; the batch stays
  pending meanwhile.
- An already published version on a channel is skipped before packaging, even
  if a tag push or manual dispatch enqueues it again. Never rebuild or
  overwrite published release assets.
- Release workflows remain serialized across refs. Publication rechecks the
  live published baseline immediately before publishing.
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

`check` is the Nightly workflow preflight and emits `eligible`, `version`,
`tag`, and `include_macos` after all checks. `verify` rechecks eligibility
immediately before Nightly publication. `check-promote` and `verify-promote`
validate Stable promotion eligibility, source commit, and whether macOS must be
built from source.
