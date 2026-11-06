# GHL read-only employee evidence: verified API findings

Checked **2026-11-05**, against current official HighLevel documentation and its official schema repository. Ledger: `ac79f5bc-89fb-4d36-a702-07b8a67afe8e`. Research only; no account access, credentials, customer data, or live API probes.

## Bottom line

A sub-account/location Private Integration Token (PIT) is documented for reading conversations, messages (including calls), email details, users, calendars, and appointments with the scopes below. Email bodies are explicitly documented—not merely subjects/snippets. This supports investigating content-grounded evidence alongside screenshots for recaps, EODs and manager briefings, but does **not** establish complete history, reliable employee authorship, or a supported original-message UI permalink. Those remain bounded by the documented fields and pending probes. [1–8]

## Location-level read permissions and version

| Read surface | Documented endpoint | Exact scope | Notes |
| --- | --- | --- | --- |
| Conversation discovery/assignment | `GET /conversations/search` | `conversations.readonly` | Requires `locationId`; `assignedTo` filters assignment, not authorship. [2] |
| Message export/detail/history; call records | `GET /conversations/messages/export`, `GET /conversations/messages/{id}`, `GET /conversations/{conversationId}/messages` | `conversations/message.readonly` | Export supports `channel=Call`; call message types are documented. No separate call-record read scope is needed for these endpoints. [3,4,9] |
| Individual email content | `GET /conversations/messages/email/{id}` | `conversations/message.readonly` | Sub-account token; explicitly accepts Private Integration. [5] |
| User identity lookup | `GET /users/{userId}`, `GET /users/search` | `users.readonly` | Both document sub-account PIT support. Search requires `companyId` and optionally `locationId`; do not assume a location-only directory request. [6] |
| Calendar discovery | `GET /calendars` | `calendars.readonly` | Requires `locationId`. [7] |
| Appointment/event reads | `GET /calendars/events`, `GET /calendars/events/appointments/{eventId}` | `calendars/events.readonly` | List additionally requires a user/calendar/group selector and millisecond `startTime`/`endTime`. [8] |

All table endpoints explicitly document OAuth and Private Integration authorization. Use a **sub-account** PIT, not an assumed agency-wide token. PIT permissions are selectable/editable; tokens are static rather than automatically refreshed; official guidance recommends rotation every 90 days. These scopes authorize integration access, not unrestricted employee/manager access inside Work OS. [1–8]

**Exact current header: `Version: v3`.** The official versioning page explicitly defines named versions starting with `v3` and lists its release as June 11, 2026. Export, message, conversation search, users, calendars and appointment pages explicitly enumerate `v3` as their header value. This independently verifies the supplied claim; it is not an inference from the documentation menu. Earlier supported versions use exact date strings such as `2021-07-28`, **not** `v2` or `v2021-07-28`. The PIT tutorial still shows `Version: 2021-07-28`, and the official repository calendar schema retrieved through Context7 still shows `2021-04-15`; distinguish those older examples from the current endpoint reference. The current email-detail page omits a header section, so its runtime behavior still needs confirmation. Preserve each endpoint's documented path; do not universally prepend `/v3` based on a product/version label. [1–8,10,11]

## Email grounding, authorship and inline viewing

- Email detail documents required `body`, `contentType`, `subject` (optional), sender `from`, receiver arrays `to`/`cc`/`bcc`, attachment URLs, `direction`, `status`, `dateAdded`, `conversationId`, `threadId`, provider and `source`. Source options are `workflow`, `bulk_actions`, `campaign`, `api`, `app`. Thus full body retrieval is documented, but completeness across connected providers, older messages and retention is **not proven**. [5]
- Generic message detail has optional `userId` (described only as “User Id”) and `source`; its `from`/`to` are explicitly not returned for email types. Email detail itself does **not** list a `userId`. Join message/email records only after verifying identifier relationships; a sender mailbox/name is not conclusive evidence of the employee who clicked send. [4,5]
- Keep **actor** (explicit, validated acting-user evidence), **assignee** (conversation/appointment owner), **automation** (workflow/campaign/etc.), and **unknown** separate. `source=app` alone is not proof of a particular human; `source=api` alone is not proof of employee or automation. An automation message carrying a user's identity must not become “employee personally sent this.” Conversation search's manual/automated filter describes the **last outbound message**, not every message in the thread. These are conservative interpretations of the documented fields, not additional GHL guarantees. [2,4,5,11]
- Authorized inline content viewing is technically plausible from `body`/`contentType`, but is a product/security decision, not an API promise: enforce organization/location and viewer authorization, sanitize HTML or render text, block scripts/remote tracking content, and treat email text as untrusted evidence rather than model instructions. Do not claim attachment or remote-image access is universally available. [5]

## Original GHL UI links

The reviewed email/message/search/export contracts provide identifiers, not a documented canonical conversation/message UI permalink. Attachment URLs and appointment meeting addresses are **not** original-record UI links. No supported deep-link template was established by this research; do not synthesize one from IDs. A GHL fallback should use only an authorized, actually observed/validated UI URL; if unavailable, offer a verified GHL entry point plus record identifiers/manual lookup, explicitly not “open this exact message.” White-label host, location selection, login and target precision need verification before promising navigation. [2–5,8,11]

## Appointments: action time is not scheduled time or audit history

- The official calendar schema distinguishes `startTime`/`endTime` from `dateAdded`/`dateUpdated`. `assignedUserId` is the primary owner and `users` are secondary owners. Optional `createdBy` is “Appointment booked by metadata”; its schema has optional `userId` and required `source`. It is not a documented per-edit actor trail. [11]
- A meeting scheduled for today does not prove it was booked today. Creation time can support a bounded “booking created” claim; latest update time alone cannot identify which change occurred, who made it, or how many times it was rescheduled. The event list's time-window query is not documented as a changed-since audit feed. [8,11]
- The reviewed read endpoints do not expose a complete revision history. Conversation messages can include `TYPE_ACTIVITY_APPOINTMENT`, but coverage and actor semantics are unproven. Appointment-create/update webhooks document appointment snapshots with scheduled and added/updated timestamps and source, not a complete old/new diff or acting-user history. The update page's example even says `AppointmentCreate`; test actual event types rather than trusting that copied example. Historical backfill cannot promise all edits/deletions; polling can miss intermediate changes. [8,9,12]

## PIT polling versus OAuth webhooks

- PIT supports authenticated read polling. Export explicitly omits email unless `channel=Email`, excludes activity messages, and does not support group chat/SMS review-request types. Request email and other channels separately. It supports date bounds, `createdAt`/`updatedAt` sort, and cursor pagination (10–1000 records/page); cursor validity is **two minutes from the last request**. Date-bound semantics, late updates and restart behavior require probes; do not mistake a cursor for a durable sync checkpoint. [3]
- The official webhook guide instructs developers to create an **OAuth marketplace application**, configure scopes, and subscribe to events there. A PIT alone is not documented as providing marketplace webhook subscriptions. This does not rule out separately configured workflow outbound webhooks, but those are not equivalent to verified platform event coverage. [1,13]
- Webhooks can improve future change capture, not reconstruct missing history. The guide requires signature verification and duplicate handling, documents up to 12 retries after the original attempt for non-2xx/no response, and warns of paused delivery after repeated health failures. It identifies `X-GHL-Signature` (Ed25519) as current, with legacy RSA deprecation dated September 1, 2026. Do not assume exactly-once delivery or unbroken coverage. [13]

## Required follow-up probes — all unresolved; none performed

Only with separate authorization and non-customer fixtures, using read-only requests:

1. Confirm minimum PIT scope grants and location isolation on every selected endpoint; verify `Version: v3`, email-detail header acceptance, actual route/envelope shapes, and user search's `companyId` requirement under a sub-account token.
2. Compare controlled manual/shared-mailbox/workflow/campaign/API/inbound email records across export, message detail and email detail: ID mapping, body HTML/plaintext completeness, `userId`, source, sender and timestamps. Establish what “actor” can actually mean; leave absent/ambiguous cases unknown.
3. Verify export bounds/inclusivity/time zones, updated-record discovery, pagination expiry/restart, duplicates and channel omissions. Test call user/source/status metadata; recording availability and its exact permissions remain unverified—the recording endpoint lists PIT but **no scope**. No recording/transcript ingestion promise follows from call-record access. [14]
4. Read controlled appointments created/edited/rescheduled at known times, including meetings outside today's scheduled window, recurring instances, cancellation/deletion and activity messages. Determine polling coverage and whether any authoritative historical actor/change records exist; do not equate snapshots with audit events.
5. Have an authorized operator supply/validate actual GHL UI navigation for a fixture email/conversation on the real host. Verify access denial and login behavior; retain no invented deep links. Separately verify any future OAuth subscriptions/signatures/replay handling before claiming real-time evidence.

## Official sources

1. [Private Integrations Token](https://marketplace.gohighlevel.com/docs/Authorization/PrivateIntegrationsToken/)
2. [Search Conversations](https://marketplace.gohighlevel.com/docs/ghl/conversations/search-conversation/)
3. [Export messages by location ID](https://marketplace.gohighlevel.com/docs/ghl/conversations/export-messages-by-location/)
4. [Get message by message id](https://marketplace.gohighlevel.com/docs/ghl/conversations/get-message/)
5. [Get email by Id](https://marketplace.gohighlevel.com/docs/ghl/conversations/get-email-by-id/)
6. [Get User](https://marketplace.gohighlevel.com/docs/ghl/users/get-user/) and [Search Users](https://marketplace.gohighlevel.com/docs/ghl/users/search-users/)
7. [Get Calendars](https://marketplace.gohighlevel.com/docs/ghl/calendars/get-calendars/)
8. [Get Calendar Events](https://marketplace.gohighlevel.com/docs/ghl/calendars/get-calendar-events/) and [Get Appointment](https://marketplace.gohighlevel.com/docs/ghl/calendars/get-appointment/)
9. [Get messages by conversation id](https://marketplace.gohighlevel.com/docs/ghl/conversations/get-messages/)
10. [API Versioning](https://marketplace.gohighlevel.com/docs/Versioning/)
11. Official schemas: [calendars.json](https://github.com/gohighlevel/highlevel-api-docs/blob/main/apps/calendars.json) (`CalendarEventDTO`, `CreatedOrUpdatedBy`) and [conversations.json](https://github.com/gohighlevel/highlevel-api-docs/blob/main/apps/conversations.json) (`ExportMessagesResponseDto` references message-detail schema). Retrieved directly; calendar schema also checked via Context7. Repository examples can lag current hosted version references.
12. [AppointmentCreate](https://marketplace.gohighlevel.com/docs/webhook/AppointmentCreate/) and [AppointmentUpdate](https://marketplace.gohighlevel.com/docs/webhook/AppointmentUpdate/)
13. [Webhook Integration Guide](https://marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide/)
14. [Get Recording by Message ID](https://marketplace.gohighlevel.com/docs/ghl/conversations/get-message-recording/)
