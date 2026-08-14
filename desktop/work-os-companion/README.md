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

`.github/workflows/work-os-companion-windows.yml` is the only trusted Windows release path. It runs in either of these ways:

- Push an exact `work-os-companion-v<semver>` tag, such as `work-os-companion-v0.2.1`. A valid tag build publishes a stable GitHub Release and marks it latest.
- Run the workflow manually with a version matching all three version files. Manual runs leave a draft Release by default; publication requires explicitly selecting `publish_release` from `main`. Pilot releases require a prerelease version such as `0.2.2-pilot.1` and never become latest.

The version must match `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`. The workflow fails before building if they differ. Do not reuse or move a published version tag.

The release job produces fixed asset names so website and updater links do not change between versions:

| Asset | Purpose |
| --- | --- |
| `Work-OS-Companion-Setup.exe` | Preferred signed NSIS installer |
| `Work-OS-Companion.msi` | Signed MSI deployment package |
| `Work-OS-Companion-Portable.zip` | ZIP containing the signed portable executable |
| `latest.json` | Tauri v2 static updater manifest |
| `*.sig` | Tauri updater signatures |
| `SHA256SUMS.txt` | SHA-256 checksums for every download |

Before release upload, CI verifies the Authenticode chain and expected certificate on the executable, NSIS installer, and MSI; updater signatures; portable ZIP contents; updater manifest; and checksums. A published release is never overwritten. Configure the protected GitHub environment or repository release policy to require reviewer approval for production if the organization needs two-person control.

Clean `main` currently omits `@types/node` from the companion package even though its test files import `node:*`. CI installs the exact type-only package `@types/node@22.18.3` without lifecycle scripts or lockfile changes before running the existing build gate. Remove that CI-only bootstrap after the desktop package declares the dependency in its own lockfile; changing the package files is intentionally outside this release-automation change.

### Required GitHub Actions secrets

Configure these in GitHub, never in `.env`, source control, workflow logs, or release assets:

- `WINDOWS_CERTIFICATE_BASE64`: base64-encoded code-signing PFX.
- `WINDOWS_CERTIFICATE_PASSWORD`: PFX export password.
- `TAURI_SIGNING_PRIVATE_KEY`: Tauri updater private key content.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: updater private-key password.
- `TAURI_UPDATER_PUBLIC_KEY`: matching updater public key embedded into the release build.

`GITHUB_TOKEN` is issued automatically for the run. The job requests `contents: write` only for release creation and asset upload. Missing or invalid signing material fails the job; it never silently falls back to an unsigned production artifact.

Store the five secrets in the `windows-production-release` GitHub environment and configure required reviewers plus protected deployment branches. The updater public-key secret must exactly match the public key committed in `tauri.conf.json`; CI checks this without printing either value. Enable GitHub release immutability so tags and assets cannot be altered after publication.

Unsigned local packages are for internal engineering tests only. They must include `unsigned-internal` in their filename, must not be attached to a GitHub Release, must not be linked from the website, and must not be described as trusted employee downloads.

### Stable employee download link

For a public release repository, GitHub provides a version-independent browser download URL:

```text
https://github.com/zahemen9900/work-os/releases/latest/download/Work-OS-Companion-Setup.exe
```

The Work OS repository is currently private. That GitHub URL therefore requires GitHub authentication and is **not** an employee-facing website link. The production website should expose a stable same-origin route such as:

```text
https://app.wrazyos.com/downloads/work-os/windows
```

That route must resolve the latest non-draft, non-prerelease release through the GitHub Releases API using a server-only, read-only token, stream `Work-OS-Companion-Setup.exe` to the browser with `Content-Disposition: attachment`, and never expose the token or authenticated GitHub URL. It must fail closed rather than serve a draft, prerelease, unsigned, missing, or ambiguously named asset. Add a parallel checksum route or link to `SHA256SUMS.txt` so employees can verify the download.

The focused Work OS repository does not contain the production Next.js route tree, so this server route belongs in the Agent OS integration repository and requires a separately approved server secret/deployment. Do not implement it as a client-side redirect: private GitHub release assets cannot be downloaded anonymously that way.

PowerShell checksum verification:

```powershell
Get-FileHash .\Work-OS-Companion-Setup.exe -Algorithm SHA256
```

Compare the full value with the `Work-OS-Companion-Setup.exe` entry in `SHA256SUMS.txt` obtained through the same trusted website origin.

### Updater options

The application currently uses the authenticated WrazyOS update endpoint declared in `src-tauri/tauri.conf.json`. Keep that endpoint when the web control plane selects releases or proxies private assets.

If release assets move to a public repository or public object store, Tauri v2 can instead consume the attached static manifest directly:

```text
https://github.com/zahemen9900/work-os/releases/latest/download/latest.json
```

The static manifest is only usable when both the manifest and its referenced installer URL are anonymously reachable. The updater public key in the shipped app must match the private key used by CI, and rotating that key requires a signed transition release or existing clients will reject future updates.

Rollback should create a new, higher SemVer release containing the reverted code. Do not move a tag, replace published assets, or point the updater at a lower version.
