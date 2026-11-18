# Shared vault startup — implementation and verification

Ledger: `15352c49-47b8-49ae-9b38-2a7c2a261540`. Branch:
`codex/companion-shared-vault-startup`; product base `f6975b3a`.
Plan: `docs/superpowers/plans/2026-11-16-shared-vault-startup.md`.
Status: implementation, focused/native/browser checks, CodeRabbit review, and
final suite runs completed as recorded below. No installer publication.

## Cause and change

Installed build 0.5.33 diagnostics place the dominant delay inside local vault
opening, not theme application. Seven identified 0.5.32 launches had a median
first completed vault-open duration of 2,775 ms; three 0.5.33 launches had
7,404 ms. This observational sample does not prove themes caused slower native
execution: the relevant open code and native dependencies were unchanged.

Both WebViews used to call Stronghold initialize independently. Each call derived
the same key, decrypted the same snapshot, and replaced the native plugin's
collection entry. The snapshot's public header uses scrypt logN=19/r=8/p=1,
approximately 512 MiB of working memory per open. Under load, duplicating that
work adds CPU/memory contention and can invalidate the other window's client.

One native worker now owns the vault instance and loaded `work-os` client.
Main/avatar attach through permissioned commands; the password does not cross
that frontend IPC. Snapshot writes and explicit reset share the same serialized
worker. A generation fence rejects stale reads/writes after reset or failed
durable operations rather than replaying old data into a new vault. Native
dependency panics settle the request without disabling the recovery worker.

The same upstream Argon2, salt file, Stronghold snapshot implementation, client
name, record keys, and JSON encoding remain in use. No crypto parameter was
lowered, no production vault was reset, and no data migration is needed.

## Tests watched fail first

- Core lifecycle: six initial failures at the unimplemented worker; later green.
- Frontend transport: seven failures on legacy password/plugin IPC; later green.
- ACL: new commands initially unregistered, then green after registration and
  capability grants. An additional failing manifest test verifies every custom
  command participates in build-time restrictions.
- Timings: missing measurements and incorrect window labeling failed, then green.
- Native timings and confirmed `BadFileKey` recovery: two Windows test failures
  (missing phase events / flattened decryption error), then green.
- Dependency panic: worker death disconnected the reply; recovery test now green
  after guarding backend calls and retiring uncertain state.

## Native Windows compatibility

The committed harness `src-tauri/native-vault-acceptance` imports the production
`vault_backend.rs` and `vault-runtime-core` without touching the installed profile
or OS credential store. Its credentials and records are synthetic.

Executed tests cover:

- Legacy wrapper writes an encrypted snapshot; the shared owner opens it unchanged.
- Two callers get one initialization, and a later caller reuses it.
- Both callers' writes survive a separately opened legacy reader and a new runtime.
- Saved session bytes and dark theme/prompt history survive reopening.
- Reset discards local state and rejects an earlier-generation mutation.
- Corrupt snapshots and malformed salts are preserved, never silently replaced.
- Confirmed `BadFileKey` retains explicit, truthful start-fresh recovery.
- Native key/derive/snapshot/client events occur once, not once per window.

Latest native run after the recovery hardening: **6 passed / 0 failed / 1
benchmark ignored**. This includes a real wrong-credential open through the
production adapter returning `bad_file_key` with `requires_reset: true` while
leaving the snapshot and salt unchanged, plus separately isolated corrupt
snapshot and malformed salt cases. The ignored benchmark was run separately and
passed.

Toolchain: installed stable Rust, native Windows GNU target, debug harness with
production `scrypt` optimized at level 3. The pinned 1.99.1 Windows target is not
installed here. This machine's older MinGW CRT required a **test-harness-only**
volatile `memset_explicit` implementation to link libsodium; it is not added to
the companion or its release configuration. Therefore this is real native
snapshot/worker evidence, not a packaged MSVC/macOS release claim.

## Same-machine synthetic snapshot benchmark

Successive trials open one synthetic encrypted snapshot using the old
two-concurrent-wrapper path, then the new shared worker. These include real key
derivation, snapshot decryption, and client load. Both requests must finish in
each measurement. Machine load varied between runs, and the first-window wait is
one key derivation either way, so this benchmark cannot by itself establish an
installed startup gain.

| Run | Duplicate opens (ms) | Shared open (ms) | Observation |
| --- | --- | --- | --- |
| A (before fixture-lock fix) | 7,445 / 5,185 / 8,777 | 4,464 / 4,901 / 4,864 | shared median faster |
| B (after fixture-lock fix) | 4,046 / 4,477 / 8,897 | 3,826 / 5,320 / 4,780 | roughly even; variance dominates |

The earlier fixture helper held its mutex through Argon2, artificially
serializing the duplicate path; that was corrected before run B. The two runs
disagree, so **no reliable speedup percentage is claimed**. What the native tests
do establish is that a second window no longer repeats KDF/snapshot work or
replaces the first window's live instance. The likely end-to-end benefit is less
CPU/memory contention and no replacement race; installed launch time was not
measured and no two-second launch is promised.

The reusable harness is committed at
`desktop/work-os-companion/src-tauri/native-vault-acceptance/`; run its ignored
benchmark with `--ignored` to reproduce the variability.
## Support timings

- `vault.shared.key`, `.derive`, `.snapshot`, `.client`: successful native open
  subphase durations, `window: host`; emitted only by the actual initializer.
- `vault.shared.ready`: per-window wait duration and `reused` state.
- Existing `vault.open.started` / `.ready` events retain their categories and now
  identify the known window and duration. They contain no query string/token.
- `app.startup.vault_wait`, `.cache_restore`, `.content_frame`, `.overlay_exit`,
  `.avatar_frame`: one-shot monotonic WebView measurements. The content frame
  and overlay exit are separate. Two animation frames observe a post-commit
  paint opportunity; they are **not** browser TTI, provider freshness, or an
  assertion that all background requests have finished. Hidden windows can delay
  observations but never hold the boot gate for them.

## Broader verification and limitations

- Focused companion vault/gate/settings/assets: **68 passed**.
- Lifecycle core including panic recovery: **7 passed**.
- Frontend timing/boot/transport group: **19 passed**.
- Desktop and ACL root contracts: passed.
- Companion production build: passed (final rerun recorded with the handoff).
- Locked Windows GNU cargo check: passed; final manifest/telemetry check passed.
- Direct browser lifecycle/isolation suite: **5 passed**. The installed browser
  revision differs from the Playwright package expectation; a scratch preload
  selects the existing Chromium 1254 executable, without package installation
  or product/test changes.
- Full companion suite after all lease, sign-out, and recovery changes: **232 files / 2,062 tests passed**, and the production build passed.
- Full Work OS suite: **1,332 tests / 1,321 passed / 0 failed / 11 skipped** on
  the pre-rebase branch before the final companion-only hardening. After
  rebasing onto current main (published 0.5.36), the full companion suite (232 files/2,062 tests),
  `work-os:typecheck`, root ACL/desktop contracts, and the production build pass.
  A whole-repo root-suite rerun on the rebased tree was not completed, so it is
  not claimed; companion runtime behavior is covered by the full companion suite.
- TestSprite existing recovery test `e99152d3-19ce-4954-834c-576268ebc195` was
  attempted against this worktree on local port 14329. Trigger refused with
  `FEATURE_GATED` / `billing_hold` / `payment_failure` (exit 13); no test ran.
  Retrying or changing billing is not authorized. This remains a verification gap.
- No packaged installed-profile startup timing, macOS execution, or production
  deployment is claimed. The existing packaged-Mac recovery gate remains in CI.

## Review disposition

CodeRabbit completed with 6 findings (3 major, 3 minor), all verified against
current code:

- Reset ACL question — **refuted**: `allow-app-commands` grants
  `reset_local_vault` to main and avatar; the ACL guard passes.
- Release panic strategy question — **refuted**: effective `panic=unwind`; no
  abort profile, so the recovery boundary is effective.
- Other-window stale recovery question — **refuted**: stale reads/writes retire
  their cached lease; the next explicit operation attaches to the current
  generation. The reset/restart tests cover this.
- Queued settings lease — **fixed**: each queued save acquires its lease when it
  begins, so one stale failure cannot strand a later save that has not read yet.
  Regression test RED→GREEN (9 transport tests).
- Benchmark fixture lock — **fixed**: password copied before Argon2 so duplicate
  trials are not serialized; corrected measurement above.
- Verification placeholders — **fixed** in this record.

A second CodeRabbit pass after the queued-settings fix returned 3 major
questions. One was refuted: both windows grant `open_local_vault` through
`allow-vault-store`, and the ACL test checks it. Two were valid and fixed:

- The native owner retires its live instance after a failed snapshot commit, so
  the frontend now retires its cached lease on `storage_failed`/`unavailable`
  too; the next save attaches fresh instead of replaying or stranding on the old
  generation. Regression test RED→GREEN (9 transport tests).
- The lifecycle durability fake now models a live store mutation whose snapshot
  commit fails; the test proves the rejected value is discarded on the next open
  and the last durable value remains. 7 core tests pass.

A third CodeRabbit pass returned 8 findings (5 major, 3 minor). Verified:

- ACL and startup-retry questions — refuted by the capability/manifest tests and
  the `unavailable` retry predicate.
- Wrong-key recovery — **fixed** with a real synthetic snapshot plus wrong
  credential through the production adapter; `bad_file_key`/`requires_reset`
  verified, files unchanged.
- Sign-out cleanup — **fixed**: cleanup restarts on a retired lease, so deleting
  the session first cannot strand the remaining chat records. Regression test.
- Lease eviction — **fixed**: only the failed attempt may be retired, so a late
  rejection cannot discard a replacement lease.
- Empty queue write and combined corruption tests — **fixed**: a real non-empty
  queue action round-trips before cleanup; corrupt snapshot and malformed salt
  are separate cases with a valid fixture.
- Chat-scope registry cross-window race — **ruled out of this change**: the
  read-modify-write predates shared-vault work and is best-effort cleanup; it is
  recorded as a follow-up, not silently claimed fixed.

The configured independent reviewer did not produce findings: it stopped with a
usage-limit error before returning a review. CodeRabbit completed three passes;
the main agent verified and fixed the valid findings. This is documented rather
than presented as an independent pass.

Queue: one companion outcome appended as `shared-vault-single-initialization`
after the existing `guide-split-view-and-settings-film`; release status is 2/5
pending, ineligible. Published version is 0.5.36. No version bump, packaging, or
installer publication.
