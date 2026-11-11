# GHL evidence operations

> **Live pilot (2026-11-11):** Location **Boots & Hammer** (`EAzucMccSCpfHNlJFNj7`), workspace **David Yeboah Workspace** (`b094c847-1332-4cab-9588-bdd7f8e99e7d`). Verified mappings: Aden Badon, David Z, Lisa Perry. The Wrazy pilot connection was removed. Email-content analysis is paused until the expired `OPENROUTER_API_KEY` is rotated; full-email viewing still works.

Read-only GoHighLevel evidence (calls, SMS, email, appointments, notes, contact tasks, opportunities) is pulled with a location-level Private Integrations Token (PIT). There is no employee-level credential and no OAuth app in the pilot.

## Connection

- One shared GHL location per Work OS organization.
- Token: sub-account PIT with the read scopes in the approved design (`locations.readonly`, `users.readonly`, `conversations.readonly`, `conversations/message.readonly`, `calendars.readonly`, `calendars/events.readonly`, `contacts.readonly`, `opportunities.readonly`).
- Store the token encrypted through the existing provider credential path; it is never accepted from a browser form or returned to a client.
- Rotate at least every 90 days. Update the stored cipher only; sync checkpoints remain valid.
- Disconnect by marking the provider connection inactive, which stops due jobs and blocks email viewing. Delete the stored credential separately when the integration is retired.
- GoHighLevel webhook ingestion stays disabled for polling connections (`WORK_OS_GHL_WEBHOOK_MODE` is unset). OAuth marketplace webhooks are a later phase and must not be enabled by flipping the legacy route.

## Scheduling

- Register `POST /api/work-os/integrations/ghl/sync-due` with `Authorization: Bearer $CRON_SECRET` in the deployed Agent OS scheduler every five minutes.
- Each run is bounded to 10 provider pages and about 40 seconds. A run that does not finish leaves a durable checkpoint and is resumed next time.
- Backfill is 30 local calendar dates (America/New_York) including activation day. Recurring runs overlap the last 24 hours; a completed backfill also unlocks a daily 30-day reconciliation.
- Export cursors expire. An expired cursor restarts that partition from the last durable checkpoint; completed pages are already persisted.
- 429 responses keep the partition pending for a later run. 401/403 marks the affected category `unavailable` until the credential/scopes are fixed.
- A failed category never turns into a silent zero. Check `/api/work-os/admin/integrations/ghl/status` for per-category coverage.

## Retention and access

- Email bodies are fetched in memory, reduced to plain text, and only supporting excerpts (up to 2,000 characters) plus derived summaries are stored encrypted.
- Content expires 90 days after the provider occurrence time unless an explicit organization evidence policy overrides it. Expiry is not renewed by re-sync.
- Expired content and registered machine-generated copies are redacted by `POST /api/work-os/integrations/ghl/retention` (cron secret). Reads enforce expiry even before cleanup runs.
- Full email is available only through the authenticated evidence route: the server resolves the stored GHL email ID and the caller's person/team scope. Unknown/shared records are admin-only.
- Never send production message bodies to logs, chat, test fixtures, or an AI model before the activation readback.

## Probe and configure

- Dry probe: `npm run work-os:ghl:probe -- --organization-id <uuid> --location-id <id>` (no network, no credential).
- Protected live probe: add `--credential-file <path> --live`; it prints endpoint status and field-presence booleans only.
- Dry configure: `npm run work-os:ghl:configure -- --organization-id <uuid> --location-id <id> --credential-file <path>` (no writes).
- Apply only after operator authorization: add `--confirm-host <resolved-db-host> --apply`. The connection starts disabled.
- Enable only after the probe, confirmed mappings and AI/retention readback: add `--enable --confirm-activation`. No command prints the token.

## Activation checklist

1. Verify the resolved database host before applying only `supabase/migrations/0073_work_os_ghl_evidence.sql`.
2. Configure the location ID, encrypted PIT, and enable `ghl_evidence`.
3. Run the read-only probe against a tiny sample. Confirm location isolation, email/message ID correlation, actor fields, call metadata, and date/pagination bounds.
4. Confirm the six GHL identities and explicitly verify Work OS person mappings. Generic/shared accounts must not be mapped to a single employee by name.
5. Confirm the 90-day content retention and existing-AI-provider processing with the workspace owner.
6. Enable the connection and register the five-minute sync. Watch coverage until the 30-day backfill is complete.
7. Validate a representative recap/EOD/manager evidence flow, authorized email viewing, and an unavailable-source state. Do not regenerate submitted reports or reviewed recaps.
