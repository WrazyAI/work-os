# GHL evidence: Work OS discovery checkpoint

Status: discovery only; not an approved implementation design. Ledger: `ac79f5bc-89fb-4d36-a702-07b8a67afe8e`. Inspected `origin/main` at `e99bfb44` on 2026-11-05. No live GHL API probes or product changes performed.

## Confirmed user requirements

- One shared GHL location. Employees are believed to have individual logins; the browser investigation also found generic identities, so attribution needs validation.
- GHL is an evidence source alongside screenshot/work-activity analysis, analogous to GitHub for engineers. It must feed interval recaps, EOD reports, manager briefings, and the manager evidence page, not a separate employee dashboard.
- Analyze relevant email content to ground descriptions of work, not just activity counts.
- Authorized managers should be able to open supporting email content inline when available, plus an original GHL link; link-only is acceptable if content cannot be retrieved. Original UI link support remains unverified.
- Read-only PIT pilot is a recommendation, not an approved final architecture. No credentials have been supplied or generated.
- User subsequently selected excerpt retention with full emails fetched on demand, not full-message archival. Unavailable originals must be clearly marked unavailable.
- On 2026-11-06 the user requested all listed GHL accounts in the pilot, including generic/team identities: include any recorded evidence, without silently excluding shared/unknown actors. This broadens capture, not personal attribution; generic/shared and unknown activity stays location/account-level unless an individual actor is established. User-supplied directory lists David Z, Lisa Perry, Sam Adly, Support Team, Tonya A and Wrazy Representative. Employment, account sharing and Work OS person mappings are not verified.
- User approved a 30-day backfill on 2026-11-06. Proposed design: `docs/superpowers/specs/2026-11-06-ghl-evidence-design.md`. Independent builder check completed; proposed exclusions, shared-record manager access, AI/retention defaults, minimum calendar coverage and delivery defaults need user approval before implementation planning.

## Existing source-code seams

- `src/lib/work-os-evidence.ts`: provider connection resolution, organization feature gates including `ghl_evidence`, verified account attribution, idempotent event upsert, and mirroring attributed events into `work_evidence`. Reuse rather than create a separate evidence store. Raw provider payloads currently persist; do not blindly place sensitive email bodies in generic raw payloads or broadly returned metadata.
- `src/lib/work-os-attribution.ts`: shared/ambiguous identities explicitly remain unattributed. It does not establish whether an incoming provider field actually identifies an actor rather than an assignee.
- `src/app/api/work-os/integrations/ghl/webhook/route.ts`: existing generic GHL scaffold, not a complete evidence integration. It guesses actor from `userId`, `user.id`, or `createdBy`; stringifying a structured `createdBy` would not produce a valid user ID. Its fallback timestamp is receipt time; its event identity falls back to object ID or payload hash. Type-specific actor, lifecycle, source, identity and occurrence rules need validation before use. No email hydration or artifact URL is supplied.
- `src/lib/work-os-provider-webhooks.ts`: Ed25519 verification helper with configured/default GHL public key exists. Official key/header compatibility still needs verification; existence is not live acceptance.
- `src/lib/work-os-activity-intervals.ts`: currently explicitly loads GitHub activity into recap prompts, allowlists, and coverage. Merely inserting GHL evidence will not give it equivalent interval recap grounding.
- `src/lib/work-os-github-activity.ts`: useful bounded, read-only, person/window-specific pattern that separates performed from triggered events. GHL additionally needs assigned-only, automation and unknown attribution distinctions.
- `src/lib/work-os-eod.ts:318-353`: generic non-Worktivity/non-Loom evidence already projects title, summary, URL, source and task into EOD facts; a dedicated GHL facts/content path is not present. Preserve evidence boundaries and avoid duplicating generic rows and new provider facts.
- `src/modules/work-os/admin/AdminEvidence.tsx` and `AdminSettings.tsx`: GHL remains marked coming soon/disabled. No UI was modified. Read all `design.md` before any future UI work.
- `src/lib/work-os-readiness.ts` / `work-os-readiness-report.ts`: readiness assumes a GHL webhook key. A PIT polling pilot needs readiness to model the actual active ingestion mode rather than require an unused webhook.

## Pending decisions and validation

1. Verify current official GHL API content/scopes/version/attribution/link contracts; separate documented support from real account behavior.
2. Validate a tiny read-only sample with a securely provisioned credential before enabling ingestion. Do not infer human work from ownership, a shared sender address, or automation.
3. Agree email content retention, authorized AI processing, manager access and audit expectations; exclude attachments/remote images/scripts by default. Treat external text as untrusted evidence, never instructions.
4. Choose initial history window and update frequency; pilot includes all six reported identities. A scheduled appointment time must not stand in for booking/action time.
5. Trace the exact manager briefing consumer before promising coverage; no module literally named briefing was found in the initial `src/lib` search.
6. Prepare a written design and independent builder check, then ask for approval before implementation.
