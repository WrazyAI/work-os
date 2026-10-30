# Companion release batching

Approved scope: companion installer/updater releases only. Web deployments,
ordinary CI, and the scheduled macOS validation workflow remain unchanged.

- Require five distinct, verified companion features/fixes per release, not
  five commits, changelog bullets, or agent runs. The agent landing the fifth
  update prepares one patch bump and dated release notes for the whole batch.
- Keep an append-only, checked-in update queue with stable outcome IDs, short
  employee-facing summaries, and verification references. Do not split one
  outcome to inflate the count. Seed the queue with the four existing Unreleased
  outcomes added since published 0.5.16; this tooling change does not count.
- Determine consumed updates from the queue at the latest **published** internal
  release tag, using the complete GitHub release catalog. Drafts, bare tags and
  failed builds consume nothing. For the pre-policy 0.5.16 baseline, consumed
  updates are empty. Never fall back to an empty queue on a provider/read error.
- An emergency below five requires a pending fix ID, the candidate version,
  the broken essential behavior and how the fix restores it, committed in the
  queue. No free-form dispatch flag bypasses the policy. Agents may use this
  only to restore a broken app or unblock essential functionality.
- A free Linux preflight validates all entry points before Windows/macOS jobs
  allocate runners. Require the next patch, synchronized versions, a dated
  changelog, an append-only queue, and a release commit reachable from main.
- Preserve cross-ref workflow serialization, signing, asset integrity and
  startup checks. Recheck eligibility immediately before publication. Already
  published versions skip rather than rebuild; final publication is the only
  event that consumes the snapshot's queued updates.

Implementation calls: use dependency-free Node scripts and GitHub CLI reads;
keep the queue cumulative instead of deleting entries after publication, so
publishing never requires a follow-up commit that could race another agent.
Historical update entries must retain their IDs and contents. A source snapshot
contains the whole pending batch (including more than five if agents land
concurrently); later commits remain pending for the next release.
