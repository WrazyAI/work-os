# GHL employee evidence integration

Status: design and proposed defaults approved by the user on 2026-11-06 ("Sounds good"). Implementation plan review/execution choice is next. Credentials, live API probes, deployment and companion release remain separate authorization gates.

Ledger: `ac79f5bc-89fb-4d36-a702-07b8a67afe8e`. Discovery baseline: `e99bfb44`. Supporting findings: [Work OS seams](../../research/2026-11-05-ghl-work-os-evidence-discovery.md), [official API research](../../research/2026-11-05-ghl-evidence-api.md). Follow repository `AGENTS.md` and canonical `design.md`; the latter was read completely for this proposal.

## Intent and user decisions

GHL becomes a first-class evidence source alongside screenshot/work-activity analysis, just as GitHub supports engineering employees. This is not a separate CRM dashboard or a way to send messages. Evidence must ground interval recaps, EODs, manager summaries and the existing evidence record.

The user confirmed:

- One shared Wrazy location; the ID is available from the browser investigation and is deployment configuration, not hardcoded product logic.
- Pilot all six reported accounts, including generic identities, and include available recorded evidence rather than excluding accounts without individual mapping.
- Backfill the past 30 days, then continuously collect new activity.
- Use email content, not just counts, to ground work descriptions.
- Retain supporting excerpts; retrieve full supporting emails on demand, not permanent full-inbox copies. Show inline supporting content where possible and a link back to GHL where validated. If full content is unavailable, the excerpt and honest unavailable state remain.

Reported accounts: David Z, Lisa Perry, Sam Adly, Support Team, Tonya A, Wrazy Representative. Directory presence does not verify employment, account sharing or Work OS mapping. Stable provider IDs supplied by the user are operational mapping inputs, not public UI copy or sufficient identity verification.

## Proposed calls made by the builder, not yet user decisions

- One centrally managed location-level Private Integration Token (PIT), read-only polling initially. OAuth platform webhooks are a separate later phase if lifecycle/event coverage justifies them. Do not enable the existing generic webhook scaffold as a shortcut.
- Poll every five minutes from a server-side scheduled job, independent of employee device/window state. Report freshness; this is not real-time delivery or guaranteed five-minute completion under provider failures.
- First release collects supported calls, email, SMS, appointments, notes, contact tasks and opportunities. Preserve inbound/shared/automation/unknown records as context, never invent human work. Do not silently omit a failing evidence category: report its coverage and limits.
- Email analysis initially covers outgoing email records; inbound email metadata is contextual, with full inbound-thread analysis excluded from this first phase. Attachments, recordings and transcripts are excluded. This is a bounded evidence integration, not an email archive.
- Use existing Work OS AI configuration/provider for email-grounded analysis. Approval includes this processing; do not send production email content until this design is approved and an authorized operator enables the connection. No new model/provider, training use or independent client.
- Excerpts follow an existing organization evidence-retention rule when present; otherwise propose a configurable 90-day content retention default. Excerpts, hashes, derived content-bearing summaries and citations must participate in the same purge/redaction path. Record metadata follows the existing evidence policy. Retention choice must be visible before production activation, never silently indefinite.
- Supporting email is displayed as safe plain text initially, not active HTML. No remote images, scripts, attachment proxying or tracking fetches.

## Goals, non-goals and failure conditions

Success means an authorized reviewer can trace a recap/report claim to a bounded provider record or excerpt, know whose action it actually establishes, and know whether evidence coverage is incomplete.

Non-goals: CRM mutations, sending emails/SMS, booking appointments, employee productivity scores, automatic task completion, new check-in rows, changing attendance/cadence, company-wide inbox archival, and guaranteed reconstruction of deleted history.

Failures even if synchronization technically works: assigning a workflow send to a contact owner; calling an appointment scheduled today a booking performed today; treating receipt time as action time; putting unrelated customer content in prompts; silently hiding generic-account traces; claiming all historical appointment changes were recovered; weakening person/team access to show shared records.

## Connection, tokens and activation

One server-only sub-account PIT is sufficient for the documented core reads. No employee passwords/tokens or agency-wide credential is needed. Configure the known location ID and verify API responses match it. Retrieve company metadata only where required for user search.

Core exact read scopes documented by research: `locations.readonly`, `users.readonly`, `conversations.readonly`, `conversations/message.readonly`, `calendars.readonly`, `calendars/events.readonly`. Notes/contact tasks add `contacts.readonly`; opportunity reads add `opportunities.readonly`; location task search, if used, adds `locations/tasks.readonly`. Validate the last supporting scopes/endpoints against current docs and actual grants before requesting them. No write scopes, recording or LC Email statistics scope in the initial connection.

Use current endpoint-specific API version contracts (`Version: v3` documented for core endpoints); verify email detail header acceptance. Never globally prepend `/v3` or treat older date-version examples as equivalent.

Store secrets in deployment server-side secret storage or an existing protected, gitignored server environment. Never in chat, source, query strings, client env or browser storage. Mask failures/logs. Disconnect stops polling and on-demand fetch; rotation must not duplicate evidence. No token creation or external account changes by the agent without authorization.

Activation sequence: approved design → implementation and fixture verification → operator provisions minimum token securely → bounded read-only live validation → verify/confirm individual mappings → explicitly enable ingestion/backfill. No production evidence writes during discovery/probes. If attribution is incomplete, ingestion may retain unknown/contextual records but person recaps must stay conservative.

## Ingestion and historical coverage

Use one location-bound adapter and normalized evidence contract; existing provider connections, source accounts and evidence events remain authoritative. Persist a recoverable sync state per organization/location/channel, with backfill range, completed partitions, high-water mark, last successful reconciliation, failure reason and category coverage. Use leases/single-flight to prevent overlapping jobs from racing checkpoints.

Thirty-day backfill means 30 calendar dates including activation day in `America/New_York`, from local midnight 29 days earlier through the captured activation instant. Convert boundaries to UTC instants; retain source instants separately. Person recap/EOD windows continue using their existing shift/timezone rules, not UTC date slicing.

Messages: export Email separately because the default export omits it; export other supported channels separately where needed. Use bounded pages/date partitions. Drain ephemeral cursors within documented validity; if expired, restart the current partition and deduplicate. Persist checkpoints only after durable writes, not the temporary cursor. Recurring sync overlaps at least the prior 24 hours to reconcile late updates, with a daily bounded reconciliation over the retained 30-day capture window. Track creation time, modification time and observation time independently. One message changing delivery state is not a second email sent.

Appointments: scheduled-window list queries are not changed-since queries. Capture discoverable snapshots and provider creation/update timestamps, plus documented activity messages if verified. Clearly label coverage as incomplete for bookings outside queried schedule windows or unavailable lifecycle history. Do not claim a universal 30-day action backfill for appointments, notes or other endpoints without an enumerator that actually supports it. Where APIs cannot enumerate action history, expose that limitation and offer the later OAuth event phase; do not fabricate transitions or quietly broaden into an unbounded CRM crawl.

Notes/tasks/opportunities: bounded paged enumeration through documented parent/search endpoints, date-filtered where supported; record discovery caps and partial coverage. Missing complete enumeration is a visible pilot limitation, not a success claim. Retry individual partitions with bounded backoff and provider rate headers; 401/403 pause the affected category with configuration guidance, not infinite retries.

Stable identity is organization + location + provider object/type + logical action/version, not webhook delivery ID or contact ID alone. Separate current record state from proven occurrence events; deduplicate across backfill/reconciliation and any future webhook/poll overlap. Repeated snapshots must not manufacture actions or counts. Preserve corrections/disputes and reviewed recaps during provider updates.

## Attribution and normalized evidence

Keep provider record/object ID, conversation/contact references as needed, action kind, channel, source instant, observed instant, status/duration, explicit actor ID, assignee ID(s), source/automation classification, attribution basis, source availability and citations. Keep customer identifiers minimal and server-controlled.

Relations: verified human-performed; automation; shared-account; assigned-only; unknown. The classification is event-specific, not just account-specific. `source=app`, a business sender address or `assignedUserId` is not by itself proof of a particular employee. `source=api` is not automatically a human or a bot. Incoming calls do not prove who answered; missed calls do not establish employee work.

Verified provider-account mapping plus authoritative acting-user semantics is required for individual credit. Never infer mappings from similar names alone. Shared/generic accounts remain unassigned to a single person unless independently established; do not create fake Work OS employees. All categories remain inspectable by organization admins. Restricted managers see only records within their existing authorized person/team scope; location-only unknown/shared content is admin-only initially. It must not leak into an employee's recap/EOD just because their contact is assigned to them.

Existing `ingestProviderEvidence` only mirrors person-attributed rows into `work_evidence`. Add an explicit organization-context read path for unattributed GHL events rather than misusing a fake person ID or broadening all employee queries. Review/remap paths must preserve nonhuman classification and support correct retraction of previous false attribution, not just additive backfill.

## Email grounding, retention and access

Hydrate outgoing email bodies only for selected bounded records. Establish generic message ID ↔ email detail ID relationships via a probe. Build capped plain text, remove quoted-thread/signature boilerplate conservatively, and label omissions/truncation. Read content in memory, retain only minimal supporting excerpts (proposed maximum 2,000 characters per record) and derived claims with source IDs/hashes/retrieval timestamps; a cap is not permission to retain every body in full. Unneeded bodies are discarded after processing, never saved in generic `raw`, logs, tracing, prompt logs, on-disk cache or error reports.

Use existing AI request/model/usage infrastructure; no tools or mutations available to email analysis. Clearly delimit email text as untrusted source data. Ground output in source IDs and validate citations against the supplied record allowlist. Counts/durations/timestamps come from deterministic provider facts. An email saying a proposal was sent supports that communication, not a sale or completed Work OS task. Content-grounding failure degrades to metadata and an unavailable-content state, not a guessed summary. Cache derived summaries by normalized content hash and analysis version to avoid reprocessing unchanged email on each poll.

Full-content requests authenticate current authoritative Work OS membership and person/team access, resolve the stored evidence record within the organization/location, then fetch only its known provider identifier. Never accept arbitrary upstream URL/location/message IDs from the client. Admin-only for unknown/shared records. Return safe text through `no-store` responses; no durable browser/companion caching. Audit viewer, evidence ID, purpose/action and time, never body text. Source deletion/revocation/provider failure leaves the retained permitted excerpt and an honest full-content-unavailable message. Fetching does not prove full history or create new work evidence.

GHL original-record UI permalinks are not documented in reviewed contracts. Validate actual URLs with the operator on the real host before rendering an exact-record link; allowlist the known GHL/white-label HTTPS host and expected location. If no precise link works, provide a validated GHL entry point and lookup identifiers, explicitly not an exact-message link. Attachment URLs are never substituted for an original-record URL.

## Consumers and presentation boundaries

- Interval recaps: add a bounded GHL activity/excerpt context alongside screenshots/GitHub, including provider-source IDs in the recorded-activity allowlist and coverage. Provider-backed actions can ground a recap without a screenshot of the action. Unknown/shared/automation are not employee-performed work. Preserve one recap per due slot, reviewed recap freezing, no check-in/cadence mutation and existing confirm/amend/approval contracts. A source failure does not block screenshot analysis.
- EOD: extend deterministic evidence/facts, not an unrequested AI EOD rewrite. Content-derived evidence summaries carry provenance; sent emails/calls/bookings are not completed tasks. Avoid double counting new provider-specific facts and existing generic mirrored evidence. Backfill does not silently rewrite submitted reports or frozen reviewed recaps.
- Manager briefings: extend existing `work-os-admin-overview.ts`, `work-os-admin-insights.ts`, and authorized Admin Otto reads/summary evidence projections, rather than invent a new daily delivery mechanism. Include GHL source/coverage and references in those current manager-facing summaries and relevant EOD/recap reads. No scheduled email/Slack briefing is in scope. Preserve admin chat source filters, tenant/person access and read-only boundaries.
- Existing Evidence surfaces: enable GHL as a real source, expose the normalized trace plus allowed excerpt/full-content action and original link/fallback; include all-attribution classes at organization scope, with filters distinguishing actor from assignee. Retain existing visual language, responsive/focus/state contracts and screenshot restrictions. Raw screenshots do not gain access merely because GHL email can be viewed. No separate CRM dashboard or visual redesign is required.
- Readiness: distinguish configured, validated, initial backfill pending/partial, syncing, stale and disconnected; PIT polling must not require an unused webhook public key. Zero records, failed sync and incomplete coverage must be different states.

Visual interaction details will be shown separately if the user accepts a mockup; this document defines behavior, not a new visual system. Any companion changes follow the append-only release queue and five-outcome release gate; no installer/version bump is authorized as part of discovery or automatically by this single outcome.

## Verification and release acceptance

Required before activation:

1. Fixture tests for shared/manual/workflow/API/unknown identities, assignee-vs-actor, missed vs answered calls, bookings made today for future dates, updates without acting users, timestamp/timezone/DST boundaries, invalid schemas and duplicate record states.
2. Integration tests for backfill resumption, expired cursors, separate email channel, late statuses, leases/concurrency, checkpoint atomicity, re-attribution/retraction, caps, rate limiting, connection rotation and failure degradation.
3. Authorization tests for cross-org/location/person access, restricted managers, unknown/shared records, disabled memberships and crafted provider IDs. Body/excerpt sanitization, injection, remote tracking, no-store and no secret/content leakage checks. Purge/redaction must cover derived summaries/excerpts and reference copies.
4. End-to-end fixture: GHL record → normalized event → correctly attributed or org-context evidence → recap/EOD/manager summary → authorized source viewing. Verify unsupported claims are rejected and unchanged records do not inflate counts. Tests must execute code, not only scan source.
5. Focused tests, Work OS typecheck and full suite before merge/deploy; rendered desktop/narrow/loading/empty/dense/error/keyboard/focus/reduced-motion checks for changed surfaces, plus existing TestSprite verification. CodeRabbit once per completed batch and independent security/attribution review as repository policy requires.
6. Operator-authorized read-only probes on tiny known samples, with no customer bodies in tooling/chat logs: identity semantics, API versions/grants, content/body correlation, channel/date coverage and working source navigation. Where fixtures are unavailable, get explicit approval for a minimal production sample; do not send samples to AI merely to test connectivity.
7. Report measured historical coverage per category and retained gaps. No promise that polling reconstructs all past transitions. Deployment goes through Agent OS convergence/atomic deployment workflow only when separately authorized; verify live commit/assets/representative flow.

## Builder freedom and approval gate

Independent builder check completed on 2026-11-06. Approval must explicitly cover (or correct) the proposed first-release exclusions, admin-only shared/unknown-record access, existing-provider email processing and retention defaults, acceptance of incomplete historical appointment discovery, and PIT/five-minute/current-manager-surface delivery defaults. These are substantive user choices, not assumptions the implementation plan may silently settle.

The implementation plan may settle private module names, exact additive schema/migration layout, scheduler integration and internal bounds consistent with the contracts above. Compare shared paths with Agent OS before editing; reuse existing operational scheduling rather than create a second runner. Treat upstream capability gaps as coverage limitations and explicit phase choices, never silently weaken attribution or expand permissions.

Before product code: present this design, its proposed defaults and any important builder-check questions to the user. Only after approval create the implementation plan. Credentials and live activation remain separate operator actions. No implementation tests or live validation have been run during this documentation-only phase.
