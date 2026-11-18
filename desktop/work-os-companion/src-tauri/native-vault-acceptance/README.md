# Native vault acceptance harness

Synthetic-only checks for the production `vault_backend.rs` and
`vault-runtime-core` lifecycle. It creates its own temporary snapshots and
credentials; it never opens the installed profile, keychain, or employee data.

Run on Windows for the release-relevant path:

```sh
cargo test --manifest-path desktop/work-os-companion/src-tauri/native-vault-acceptance/Cargo.toml
```

The `memset_explicit` shim is harness-only and exists for older MinGW CRTs used
in WSL; it is not linked into the companion. See
`docs/verification/2026-11-16-shared-vault-startup.md`.
