# Confirmed decryption failure recovery

Nifty: `102iz2Rcxc`. Baseline: `e56662cc`.

## Evidence and limits

The October 22 Mac diagnostics export contains 4,285 events, including 370
`vault.open.failed` events and only two successful opens (October 16). In the
latest session, `vault.password.ready` precedes repeated Stronghold
`BadFileKey` failures. A returned password is not evidence that it matches the
encrypted snapshot. The export contains neither key material nor salt/vault
history, so it cannot establish which changed or recover the original data.
Its runtime-health describes the debug window, not main-window geometry or an
installed version. Queue bodies and counts are unavailable; do not assume empty.

The Windows event supplied by the user is `vault.gate.failed`, code `unknown`,
and Retry works. This is a local gate, not an HTTP gateway. It contains no
underlying failure reason. The exact dependency for further Windows diagnosis
is the same-session `vault.open.failed` / `vault.password.failed` event or a
diagnostics export from that initial failed launch. No Windows root cause or
startup fix is claimed here.

## Proven defect and bounded change

`vaultFailureFrom` recognized only structured `unlock_failed` / `requiresReset`.
Raw Stronghold decryption errors therefore hid the existing recovery action.
Five new tests failed before the implementation. The classifier now recognizes
the explicit standalone `BadFileKey` token in string, Error, and structured
message forms, shows a bounded explanation, and exposes existing recovery.
Unknown, generic decode/file, permission, timeout, and transient startup errors
do not acquire reset permission. No key/salt/password/reset code changed.

The explanation does not claim the mismatch cause or a pending OS dialog. It
names sign-out, loss of unsent queued updates, and preservation of data already
saved on the server. Existing two-click destructive confirmation remains.

## Lifecycle inspection

- The password worker serializes requests and caches one successful password
  for the launch. It refuses to mint over an existing vault when the credential
  is missing; a returned but mismatched password cannot be repaired by this
  frontend classification.
- `vaultStartup.ts` bounds retries for recognized startup errors;
  `strongholdStartup.ts` retries only plugin-registration failures. Neither
  treats `BadFileKey` as transient. No evidence ties the Windows event to a
  particular retry case.
- Existing reset removes `work-os-vault.hold`, best-effort removes its credential,
  changes the vault ID, and clears cached key state. It does not preserve a
  backup. Therefore no employee reset was executed or authorized by this work.
  Any actual reset must follow employee consent about local-only data loss.

## Verification

- Companion: 1,268 tests passed, including 33 vault gate/startup tests.
- Password core: 13 Rust tests passed using fake stores, not an OS keychain.
- Work OS typecheck and companion production build passed.
- Broader Work OS suite: 573 passed / 7 failed (plus 14 preliminary tests
  passed). All seven are unchanged provider-outbox guards and reproduce on
  clean `e56662cc`; this suite is not claimed green.
- Local browser: real recovery renderer and classifier at 1440×900, 1024×768,
  720×900, and 390×844; explanation, keyboard focus, confirmation wording,
  confirmation return, eight-second disarm, no offline bypass, and bounded
  controls passed. Permission-waiting state still has no reset control.
  Screenshots inspected at small/unarmed and wide/armed sizes. The preview
  callback is deliberately a no-op: this is not an actual native reset test.
- Normal motion with medium text also checked at 720×600, 390×844, and
  512×384 (equivalent to a compact 1024×768 viewport at 200%): no horizontal
  overflow and confirmation reachable by scrolling. At the shortest height,
  the full content scrolls; the controls are not claimed visible without it.
- Reproducible local check: `scripts/verify-vault-recovery.mjs`, against Vite
  on port 1442. No paid TestSprite run per the user's local-only preference.

## Remaining acceptance

CodeRabbit completed the seven-file batch review with zero findings. The fix
is intended for the next companion release; no version bump, installer, server
deployment, or Agent OS convergence is included in this batch.
The affected Mac's decryptability and
post-recovery setup remain unverified. A signed-off reset would discard
local-only data; otherwise original matching material or a usable backup is
needed for non-destructive recovery. No change to release runner selection.
