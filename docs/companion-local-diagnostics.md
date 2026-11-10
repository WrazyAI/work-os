# Local companion identity and debugger diagnostics

The companion writes `app-info.json` into its **local app-data directory** on
every launch. On Windows this is:

```text
%LOCALAPPDATA%\com.wrazy.workos.pilot\app-info.json
```

From this WSL checkout, first inspect the installed app's files under
`/mnt/c/Users/<Windows-user>/AppData/Local/com.wrazy.workos.pilot/` rather
than asking the operator to upload them. Do not assume a checkout's version
is the installed version. Before this metadata shipped, the installed
`work-os-companion.exe` also exposes `FileVersion` and `ProductVersion` via
Windows `VersionInfo`.

The snapshot contains only `schemaVersion`, `app`, `version`, `build.commit`,
`build.profile`, `platform.os`, and `platform.arch`. Version comes from the
compiled package, source commit is embedded at build time (or `null` when Git
identity is unavailable), and platform describes the running binary. Commit
identifies the source revision, not a guarantee that local edits were absent.

This is generated **informational output, not editable app configuration**.
The app never loads settings from it; edits are overwritten on the next launch.
A failed write is logged as `app.info.write_failed` and does not stop startup.
The same snapshot accompanies `app.startup` in
`logs/diagnostics/app-events.jsonl` and is included in exported diagnostics ZIPs.
Exports derive identity from the binary, not potentially stale disk contents.
No tokens, account details, environment variables, or machine paths are included.

## Debugger window flashes and disappears on Windows

All webviews using the same data directory must use compatible WebView2
environment options. The main and avatar windows configure custom browser
arguments; a dynamic debugger created with default arguments fails with
`0x8007139F` when it tries to share that directory. In Tauri 2.11.5 / runtime-wry
2.11.4, window creation is queued: a returned detached handle and
`window.debug.created` do not prove a native webview was successfully created.
Later focus calls can target that stale handle.

The debugger inherits the main window's configured browser arguments. Keep its
command async as well: synchronous Windows window creation can deadlock.
Native acceptance is first open, content rendered, close, then successful reopen;
build success and the `created` event alone are not acceptance evidence.

### Verified native acceptance — 2026-11-09

Ledger: `9f3199b5-7bcb-4dd6-afa9-4b45aee7ce69`.

An isolated Windows Tauri 2.11.5 fixture imported the production
`debug_window.rs`, `window_fit.rs`, and `diagnostics.rs` directly and embedded
the actual production-built `debug.html`. Its distinct application identifier
was `com.wrazy.workos.debugger-acceptance`; it did not replace, terminate, or
change the installed companion. The only vault function used by diagnostics
(the optional panic breadcrumb) was a no-op because the fixture has no vault.

The native run checked the rendered debugger's controls and nonzero DOM
geometry through its real WebView2, checked native visibility, closed the first
window through the native API, waited until its label was removed, reopened it,
and closed the second window using its actual frontend Close button. It also
called real diagnostics initialization and export, checking that the generated
file, startup event metadata and exported snapshot agree with the fixture binary.

```text
PASS metadata: real init wrote app-info.json, startup log and export match running Windows fixture
RENDERED 1: actual debugger DOM and tab controls have nonzero geometry
CLOSED 1: real native window removed
RENDERED 2: actual debugger DOM and tab controls have nonzero geometry
CLOSED 2: real native window removed
PASS: production open_debug_window + built debug.html open/render/close/reopen on Windows
```

The run exited successfully. Chromium emitted a class-unregistration diagnostic
(`Error = 1412`) on final fixture shutdown, after both verified closes; it did
not fail the run. This validates the native production window path, not an
installed/updater release. The installed 0.5.27 app remains unchanged until a
separate installer release.
