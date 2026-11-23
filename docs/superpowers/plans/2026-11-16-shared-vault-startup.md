# Shared Companion Vault Startup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove duplicate main/avatar vault initialization while preserving saved sessions, themes, encrypted file compatibility, and recovery, and measure the actual startup improvement.

**Architecture:** A single native worker owns one initialized Stronghold instance and its `work-os` client for the process. Frontend `secureState` retains its existing API and serialized JSON records but uses narrowly permissioned native commands instead of independently calling the plugin's initialize command. Blocking key lookup/crypto/file operations stay on workers; resetting the vault invalidates earlier leases so queued writes cannot restore discarded state.

**Tech Stack:** Existing Tauri 2, Rust, Stronghold 2.3.1 / IOTA Stronghold 2.1.0, React/TypeScript, Vitest, and node:test. Reuse locked cryptography; no framework upgrade.

**Spec:** The user's approved recommendation in this conversation: unlock once in the native host, share the initialized instance across both windows, preserve encryption, and add detailed startup timings. Investigation evidence: `/tmp/opencode/workos-startup-probe/investigation.md`, `installed-timing-summary.json`, and `windows-kdf-results.txt`; durable diagnostics contract: `docs/companion-local-diagnostics.md`.

## Global Constraints

- No encryption weakening, credential rotation, vault reset, or data migration as an optimization.
- Preserve `work-os-vault.hold`, `stronghold-salt`, existing password-worker/keychain identity, `work-os` client, record keys, and JSON byte encoding.
- Preserve authoritative session validation and organization/token-scoped cache checks in `vault.ts`.
- Failed opens remain retryable and non-destructive; only explicit recovery may reset local data.
- Do not publish an installer, change app versions, or use an early-release override for this request.
- Work inline in `codex/companion-shared-vault-startup`; bounded independent review is required for concurrency/data integrity.
- Never log passwords, key material, account records, tokens, or vault paths; timings identify only window, phase, duration, and shared/reused state.

## Review Focus

1. Simultaneous startup, WebView reload, or retry must never reinitialize/replace a healthy shared vault.
2. A blocked/denied keychain prompt or corrupt snapshot must keep all windows responsive and preserve existing data.
3. Reset racing open/save must invalidate older requests; no stale write may recreate the previous snapshot afterward.
4. Existing encrypted snapshots must open unchanged, survive concurrent writes, and restore after process restart.
5. Sign-out and account switch must retain current cache fencing, prompt history, settings merging, and conversation behavior.

## Baseline and Checkpoint

- Ledger: `15352c49-47b8-49ae-9b38-2a7c2a261540`.
- Worktree: `/home/maigreeks/projects/.worktrees/companion-shared-vault-startup`.
- Base: `f6975b3a` (`origin/main` fetched 2026-11-16).
- `agentos` fetched and affected source compared by content; Work OS owns the newer companion behavior. Do not copy the older Agent OS companion implementation.
- Dependencies linked from the existing checkout; no install performed.
- Baseline command in `desktop/work-os-companion`: `vitest run src/vaultPersistence.test.ts src/vaultStartup.test.ts src/strongholdStartup.test.ts src/vaultGate.test.ts src/vaultSettings.test.ts`.
- Result: 5 files / **44 passed**, no failures.
- Native Node 22 path documented by AGENTS.md is absent here; available native WSL Node is `/home/maigreeks/.nvm/versions/node/v24.16.0/bin`.
- Planning only so far; no product code changed. Next gate: human review of this plan, then inline execution.

### Task 1: One Native Vault Owner and Compatible Frontend Transport

**Files:**
- Create: `desktop/work-os-companion/src-tauri/vault-runtime-core/Cargo.toml`, `src/lib.rs`, and `tests/runtime.rs`.
- Create: `desktop/work-os-companion/src-tauri/src/vault_store.rs`.
- Modify: `desktop/work-os-companion/src-tauri/src/vault_password.rs`, `src/lib.rs`, `Cargo.toml`, `Cargo.lock`, and `build.rs`.
- Create: `desktop/work-os-companion/src-tauri/permissions/allow-vault-store.toml`.
- Modify: `desktop/work-os-companion/src-tauri/capabilities/default.json` and `avatar.json`.
- Modify: `desktop/work-os-companion/src/vault.ts` and native-boundary vault test fixtures.
- Modify: `desktop/work-os-companion/src/vaultPersistence.test.ts`, `vaultStartup.test.ts`, `vaultSettings.test.ts`, and `companion-assets.test.ts`.
- Modify: `test/work-os-companion-acl.test.mts`, affected desktop contract tests, and `.github/workflows/ci.yml`.

**Interfaces:**
- Core `VaultBackend` trait owns `open`, `get`, `put`, `remove`, and `reset`; raw records are `Vec<u8>`, not interpreted account data. Core lifecycle state contains readiness and a monotonically increasing generation.
- `VaultLease { generation: u64, reused: bool }` identifies a successful open in this process. It is lifecycle fencing, not an authentication credential.
- Native commands: `open_local_vault() -> Result<VaultLease, VaultStoreError>`, `read_local_vault(generation: u64, key: String) -> Result<Option<Vec<u8>>, VaultStoreError>`, `write_local_vault(generation: u64, key: String, value: Vec<u8>) -> Result<(), VaultStoreError>`, `remove_local_vault(generation: u64, key: String) -> Result<(), VaultStoreError>`.
- Preserve `reset_local_vault() -> Result<(), ...>` but route its work through the same owner. Keep the existing password error payload's code/message/requiresReset semantics so the recovery screen remains truthful.
- The worker resolves the same password and uses the plugin's public Stronghold implementation and Argon2 KDF with the existing salt, then loads or creates `work-os` only when genuinely absent.
- `secureState` public methods and all record schemas remain unchanged. It caches a lease, never a password or separate Stronghold instance. Failed opens retire the local promise. A stale-generation write fails without replaying its payload against the new vault.

- [ ] **Step 1: Add failing lifecycle/transport tests.**
  - Two windows plus multiple concurrent reads call backend open exactly once and share stored data.
  - An abandoned frontend request or WebView reload does not discard the native successful open.
  - A failed open does not mark ready; explicit retry reaches the backend again.
  - Keychain failure preserves its structured recovery code; existing data is not replaced.
  - Delayed open/save ordered with reset rejects old generations and cannot resurrect old records.
  - Existing session, settings/theme/prompt history, queue, snapshots, pending auth, and conversations round-trip and survive restart.
  - A write/save failure rejects rather than reporting durable success.
  - ACL tests permit only main/avatar for store commands; debugger and remote origins cannot access them. Remove frontend permissions for raw plugin initialization once no production caller uses them.
- [ ] **Step 2: Run the new tests before implementation and record the expected failures.**
  - Core: `cargo test --manifest-path desktop/work-os-companion/src-tauri/vault-runtime-core/Cargo.toml`.
  - Companion: focused Vitest files above; root: focused ACL/desktop contract suites.
- [ ] **Step 3: Implement the worker and thin transport.**
  - Keep ownership/lifecycle tests independent of Tauri through the injectable core trait.
  - One serialized worker owns the backend. Readiness is retained only after full snapshot/client success; repeats attach without KDF/decryption.
  - Resolve credentials through the existing password worker without blocking the UI or async executor. Zeroize temporary password material after derivation.
  - Serialize native store mutation plus snapshot save, and route reset through this same queue. Drop old live state and invalidate its generation during explicit reset; do not save discarded state on teardown.
  - Preserve per-device settings serialization and account checks. Do not auto-retry an old mutation across a generation change.
  - Register commands, build-time ACL, both window capabilities, and native lifecycle tests in CI.
- [ ] **Step 4: Run the lifecycle, persistence, recovery, settings, and ACL tests to green.**
- [ ] **Step 5: Commit the coherent storage-owner change with its tests.**

### Task 2: Startup Measurements and Native Acceptance

**Files:**
- Modify: `desktop/work-os-companion/src-tauri/src/vault_store.rs`, `src/vault.ts`, and `src/bootTrace.ts`.
- Modify only instrumentation sites as needed: `desktop/work-os-companion/src/App.tsx`, `AvatarApp.tsx`, and related boot tests. No visual/theme redesign.
- Create: `docs/verification/2026-11-16-shared-vault-startup.md`.
- Modify: `docs/companion-local-diagnostics.md`, `desktop/work-os-companion/release-queue.json`, and `CHANGELOG.md` after acceptance.

**Interfaces:**
- Native diagnostic phases: `vault.shared.key`, `vault.shared.derive`, `vault.shared.snapshot`, `vault.shared.client`, and `vault.shared.ready` with durations; reuse reports `reused: true` without repeating initialization.
- Frontend metadata: known window label, elapsed vault wait, cached-state restoration, and content/paint milestone. Distinguish state breadcrumbs from an actual rendered usable surface and from the final loading-overlay exit.
- Keep existing event categories where support tooling relies on them; additional fields are additive.

- [ ] **Step 1: Add failing diagnostics tests.** Assert window/phase/duration fields and verify event payloads exclude records, credentials, file paths, and key material. Assert reuse does not log a second derivation/snapshot load.
- [ ] **Step 2: Run those tests and record the expected failures.**
- [ ] **Step 3: Implement timing instrumentation without adding a startup wait or changing theme behavior.**
- [ ] **Step 4: Run focused tests, changed-file lint, companion typecheck/build, and locked native Windows cargo check.**
- [ ] **Step 5: Execute isolated native acceptance with synthetic fixtures, not the installed app's data.**
  - Import the production adapter/lifecycle code and exercise a real encrypted snapshot at production KDF settings.
  - Create a baseline snapshot using the old path; open with the new owner, verify existing values, update from two callers, and reopen after process restart.
  - Verify one initialization with both callers, a late/reloaded caller attaching without another KDF, structured failed-open recovery, and reset fencing.
  - Compare repeated old duplicated opens and new shared opens on the same machine under comparable load. Record trial counts, compiler/build identity, phases, and wall time; do not claim synthetic KDF timings prove full-app startup.
  - Drive the built companion in an isolated profile when available and check that both surfaces become usable, saved sign-in/theme survive, and sign-out/account switch remain fenced. Report unavailable packaged/macOS evidence explicitly rather than marking it passed.
- [ ] **Step 6: Run `npm run work-os:typecheck` and full `npm run work-os:test`; run the companion suites affected by native IPC and boot.**
- [ ] **Step 7: Obtain one bounded independent review of requirements, diff, and actual test evidence; run the required CodeRabbit batch pass and resolve valid findings.**
- [ ] **Step 8: Write actual verification evidence, append one stable-ID companion outcome and its Unreleased note, and run `npm run companion:release:status`.** No version bump or packaging publication.
- [ ] **Step 9: Commit the verified batch, update the ledger/checkpoint with results and limitations, and report the measured improvement without promising a two-second launch.**

## Plan Self-Review

- The approved scope maps to shared initialization (Task 1), unchanged security/data format (Task 1 acceptance), and measured startup improvement (Task 2).
- Each of the five Review Focus risks has a corresponding test/acceptance step.
- Native worker ownership is necessary because the upstream plugin's collection is private and each `initialize` unconditionally replaces it; avoid forking/vendoring the entire plugin.
- No Next.js route, backend database, user-visible theme, or installed-profile mutation is in scope.
- Execute inline: the native lifecycle, frontend transport, and diagnostics share state and contracts; splitting implementation among agents adds integration risk rather than useful independence.
