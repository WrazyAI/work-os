# Work OS Companion

Tauri 2 Windows companion for the employee-facing Work OS workflow. It packages local React assets and talks only to authenticated Work OS APIs.

## Development

Use the repository-pinned WSL Node.js toolchain for local development:

```bash
PATH=/home/zahemen/.nvm/versions/node/v22.14.0/bin:$PATH \
  /home/zahemen/.nvm/versions/node/v22.14.0/bin/npm install
PATH=/home/zahemen/.nvm/versions/node/v22.14.0/bin:$PATH \
  /home/zahemen/.nvm/versions/node/v22.14.0/bin/npm run build
PATH=/home/zahemen/.nvm/versions/node/v22.14.0/bin:$PATH \
  /home/zahemen/.nvm/versions/node/v22.14.0/bin/npm run tauri:dev
```

Set `VITE_WORK_OS_API_URL` to use a non-production API origin. The API URL can also be changed inside the app for local testing.

## Windows releases

`.github/workflows/work-os-companion-windows.yml` is the controlled free-tier Windows packaging path. It does **not** produce a Microsoft-trusted or Authenticode-signed application. It runs in either of these ways:

- Push an exact `work-os-companion-internal-v<semver>` tag, such as `work-os-companion-internal-v0.2.2`. Tag runs always leave a draft Release.
- Run the workflow manually with a version matching all three version files. Manual runs also leave a draft by default. Publishing is restricted to `main`, requires the `publish_internal_release` checkbox and the exact acknowledgement `UNSIGNED INTERNAL`, and always creates a GitHub prerelease rather than a latest/stable release.

The version must match `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`. The workflow fails before building if they differ. Do not reuse or move a published version tag.

### Changelog

`CHANGELOG.md` is the employee-facing release notes file, and keeping it current is a hard release requirement: CI fails the release when the released version has no matching `## ` section with at least one bullet, and the GitHub release notes are built from that section. Write every entry for the employee who just installed the update — one short, plain bullet per change, no jargon, details only for complex changes that cannot fit one line. Collect entries under `## Unreleased` while work is in flight; move them under the new `## <version>` heading when cutting the release.

The release job produces fixed asset names so website and updater links do not change between versions:

| Asset | Purpose |
| --- | --- |
| `Work-OS-Companion-Setup-UNSIGNED.exe` | Preferred unsigned NSIS installer for internal use |
| `Work-OS-Companion-UNSIGNED.msi` | Unsigned MSI deployment package for internal use |
| `Work-OS-Companion-Portable-UNSIGNED.zip` | ZIP containing the unsigned portable executable |
| `latest-internal.json` | Tauri v2 updater manifest for the internal channel |
| `*.sig` | Tauri updater signatures |
| `SHA256SUMS.txt` | SHA-256 checksums for every download |

Before release upload, CI verifies that the executable, NSIS installer, and MSI are actually unsigned; that updater signatures exist; and that the portable ZIP, updater manifest, and checksums are coherent. Every filename, release title, release note, and workflow artifact says `UNSIGNED` or `unsigned-internal`. A published release is never overwritten. Protect the GitHub environment with required reviewers if the organization needs two-person control.

Clean `main` currently omits `@types/node` from the companion package even though its test files import `node:*`. CI installs the exact type-only package `@types/node@22.18.3` without lifecycle scripts or lockfile changes before running the existing build gate. Remove that CI-only bootstrap after the desktop package declares the dependency in its own lockfile; changing the package files is intentionally outside this release-automation change.

### Required GitHub Actions secrets

Configure these in the `windows-production-release` GitHub environment, never in source control, workflow logs, or release assets:

- `TAURI_SIGNING_PRIVATE_KEY`: Tauri updater private key content.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: updater private-key password.
- `TAURI_UPDATER_PUBLIC_KEY`: matching updater public key embedded into the release build.

These updater keys are free and are not a Windows code-signing certificate. They let already-installed copies of the app reject forged updates; they do not suppress Windows SmartScreen warnings. `GITHUB_TOKEN` is issued automatically for the run. Missing or mismatched updater signing material fails the job before packaging.

The updater public-key secret must exactly match the public key committed in `tauri.conf.json`; CI checks this without printing either value. Back up the private key and password in the team's approved password manager. Losing them prevents existing installations from accepting future updates. Enable GitHub release immutability so tags and assets cannot be altered after publication.

The private website may distribute these unsigned packages to approved employees, but the UI and operating instructions must preserve the warning. Do not call them trusted, signed, stable, or SmartScreen-approved. If the organization later buys an exportable OV or EV Windows code-signing certificate, add Authenticode as a separate reviewed production mode rather than weakening this workflow's labeling.

### Stable employee download link

For a public repository with a non-prerelease release, GitHub provides a version-independent browser download URL. This project intentionally does not use that pattern because its repository is private and its free-tier releases are prereleases.

```text
https://github.com/OWNER/REPOSITORY/releases/latest/download/ASSET.exe
```

The Work OS repository is currently private. That GitHub URL therefore requires GitHub authentication and is **not** an employee-facing website link. The production website should expose a stable same-origin route such as:

```text
https://app.wrazyos.com/downloads/work-os/windows
```

That route must resolve the newest published prerelease whose tag starts with `work-os-companion-internal-v`, require the exact asset `Work-OS-Companion-Setup-UNSIGNED.exe`, and stream it through the authenticated website using a server-only, read-only token. It must never expose the token or authenticated GitHub URL, and it must fail closed on drafts, ordinary releases, unexpected tag names, missing assets, or ambiguous assets. The parallel `/downloads/work-os/windows/checksums` route serves `SHA256SUMS.txt` from the same release.

Set `WORK_OS_RELEASE_GITHUB_TOKEN` only in the production Agent OS server environment. A classic token should have only `repo` access to this private repository; a fine-grained token should have repository metadata read and contents read, with no write permission. Do not prefix it with `NEXT_PUBLIC_`, and do not implement the download as a client-side redirect.

PowerShell checksum verification:

```powershell
Get-FileHash .\Work-OS-Companion-Setup-UNSIGNED.exe -Algorithm SHA256
```

Compare the full value with the `Work-OS-Companion-Setup-UNSIGNED.exe` entry in `SHA256SUMS.txt` obtained through the same website origin.

### Updater options

The application currently uses the authenticated WrazyOS update endpoint declared in `src-tauri/tauri.conf.json`. Keep that endpoint when the web control plane selects releases or proxies private assets.

If release assets move to a public repository or public object store, Tauri v2 can instead consume the attached internal manifest directly:

```text
https://github.com/zahemen9900/work-os/releases/download/<internal-tag>/latest-internal.json
```

The static manifest is only usable when both the manifest and its referenced installer URL are anonymously reachable. The updater public key in the shipped app must match the private key used by CI, and rotating that key requires a signed transition release or existing clients will reject future updates.

Rollback should create a new, higher SemVer release containing the reverted code. Do not move a tag, replace published assets, or point the updater at a lower version.

### Antivirus software

The installer is unsigned, so antivirus products (Avast CyberCapture and equivalents) may hold it for scanning on first sight — observed past 50 seconds. The app stays open through the hold: the in-app install waits it out, and if the attempt is rejected the failure card offers Retry once the scan clears. A second attempt then succeeds because the file is already known. If an install ever reports failure, use the card's Retry action (or Settings → Desktop updates → Install) before falling back to the manual setup installer.

## macOS internal packages

The release workflow also builds a **universal macOS 12+ package** for Intel
and Apple Silicon. The floating companion uses Tauri's macOS private API for
transparency; this distribution targets GitHub Releases, not the Mac App Store.

1. Install the universal `Work-OS-Companion-macOS-Universal-UNSIGNED.dmg` from
   the approved internal release and drag Work OS Companion to Applications.
2. Verify the download against `SHA256SUMS.txt`. The Mac bundle has an ad-hoc
   signature required by Apple Silicon, but no Developer ID signature or Apple
   notarization. If macOS blocks it, use System Settings → Privacy & Security →
   Open Anyway after verification. Never disable Gatekeeper globally.
3. Open Work OS, connect the workspace in your browser, and authorize microphone
   access when recording a voice note. Settings opens with Cmd+,; hold-to-talk
   keeps Ctrl+M on both platforms. Recover a hidden app from its Dock icon or
   the menu-bar menu.

Use the Worktivity Mac app to clock in, pause/resume, and clock out. Work OS
shows confirmed provider attendance; its Windows PowerShell automation is not
included in the Mac package. Tasks, planning, recaps, EOD, and floating chat
use the shared Companion code.

Local build (on a Mac, with a native Node/Rust toolchain):

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm ci
npm run tauri:build:macos
```

Set the existing Tauri updater signing environment variables for a release
build. `npm run tauri:dev:macos` opens a local development build. The pull
request Mac workflow builds both architectures without release secrets, checks
both executable slices and the bundle signature, and uploads a seven-day DMG
artifact for manual Mac testing.

Release CI reuses the `windows-production-release` environment's existing
Tauri signing secrets. After the Windows draft is staged, the Mac job uploads
its DMG, signed `.app.tar.gz`, signature, and checksum fragment. Only after
both jobs succeed does the final job verify downloaded checksums, combine
`windows-x86_64`, `darwin-aarch64`, and `darwin-x86_64` in `latest-internal.json`,
read back the assets, and publish if the existing publication gate permits it.
A failed Mac build leaves the release as a draft. The optional Actions artifact
copy remains independent of release upload so storage quota cannot block it.

The authenticated updater endpoint accepts those three platforms and chooses
an exact allowlisted asset. Mac download grants bind the architecture as well
as the version and expiry; no GitHub token reaches the employee. Port the shared
update library and both update routes to Agent OS and deploy them before
claiming the installed Mac updater works against production. Apple Developer ID
signing and notarization require a separate credential-backed release change.
