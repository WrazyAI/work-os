# Work OS Companion

Tauri 2 Windows companion for the employee-facing Work OS workflow. It packages local React assets and talks only to authenticated Work OS APIs.

## Development

```bash
npm install
npm run build
npm run tauri:dev
```

Set `VITE_WORK_OS_API_URL` to use a non-production API origin. The API URL can also be changed inside the app for local testing.

## Signed Windows Release

The release workflow expects `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `TAURI_UPDATER_PUBLIC_KEY`, `WINDOWS_CERTIFICATE_BASE64`, and `WINDOWS_CERTIFICATE_PASSWORD` as GitHub secrets. Private updater and certificate material must never be committed.
