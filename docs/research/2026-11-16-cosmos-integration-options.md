# Cosmos integration options for Work OS

Date: 2026-11-16. Research only; no application changes, migrations, or deploys.

**Question.** What is Cosmos (cosmos.video), what can its chat-integration webhook actually do, and which Work OS needs can it serve: notification destination, evidence source, both, or neither?

**Answer.** Cosmos is a virtual office for remote teams — persistent spaces, spatial video, channels/DMs, calls, recordings, and admin analytics. It is not a video-review or approval platform. Its only publicly documented integration surface is an inbound chat webhook that posts one `message` string into one channel. That is enough for the actual requirement, confirmed on 2026-11-17: **replace the manual punch-clock typing in the space's `#timebot` channel** with automatic posts for clock-in, break start, break end, and clock-out. It is a one-way notification pipe. No public read API is documented, no outbound event subscription is documented, and there is no documented way to query channel content, comments, approvals, or review state. Cosmos cannot be an automated evidence source for Work OS today. Build the outbound path with a durable outbox, an inline post-commit send so the post appears immediately, and an encrypted per-org webhook URL; treat evidence integration as blocked on Cosmos API access.

**Evidence key.** **VERIFIED** = read in a first-party Cosmos source or observed on the live endpoint on 2026-11-16. **NOT PUBLIC** = a surface or report exists, but first-party documentation is unavailable or gated. **INFERRED** = conclusion from verified facts, not a vendor statement.

## What Cosmos is

- **VERIFIED** cosmos.video is a virtual office / co-working product. The homepage describes "a virtual office where remote teams do their best work — together" and "host co-working sessions with your team in a virtual office" ([cosmos.video](https://cosmos.video)).
- **VERIFIED** The main objects are spaces, rooms (personal, meeting, focus, game, spatial areas), public/private channels, DMs, threads, calls, statuses, and Replay recordings ([features](https://cosmos.video/product/features); [channels](https://support.cosmos.video/article/122-chat-channels-keep-discussions-organised); [Replay](https://support.cosmos.video/article/116-record-your-call-in-cosmos-and-get-shareable-ai-summary-and-transcriptions)).
- **VERIFIED** It is aimed at remote teams, communities, and educators. Pricing describes "teams, students and community"; the FAQ describes creators, communities, co-working, study, and lectures ([pricing](https://cosmos.video/pricing)).
- **VERIFIED** It is a UK company and claims GDPR and SOC 2 compliance ([pricing FAQ](https://cosmos.video/pricing); [security centre](https://security.cosmos.video)).
- **VERIFIED** Space access is organized around owners/admins, members, and guests; owners and admins manage the floor plan, members, and channels, while analytics is limited to designated space administrators ([pricing FAQ](https://cosmos.video/pricing); [analytics](https://cosmos.video/product/features/space-insights--analytics)).
- **VERIFIED** No review assets, versions, asset comments, approvals, or review states appear in the published feature set. The review-adjacent features are live screen-share annotation, which is drawn during a call ([changelog, 2026-10-30](https://cosmos.video/changelog)), and Replay, which records a meeting and produces a transcript, summary, and action items ([Replay](https://cosmos.video/product/features/call-recording--ai-cosmos-replay)).
- **INFERRED** Cosmos is therefore not a Frame.io-style creative-review system. A "video review comments / approvals / version changes / time-in-review" evidence case does not map to it. The closest artifact is a Replay recording of a call, not a review record.

## The chat integration webhook

The official help article is "Set up webhooks for chat integrations", last updated 2025-10-03 ([support.cosmos.video/article/131](https://support.cosmos.video/article/131-set-up-webhooks-for-chat-integrations)). It documents creation, the URL, and one payload example. It does not document authentication, limits, responses, or message rendering.

| Question | Finding |
| --- | --- |
| How it is created | Space dropdown → Space Settings → Integrations → Webhooks → Create a new webhook integration. Enter a name, choose the destination channel, click Create integration. **VERIFIED** (same article). |
| URL shape | `https://cosmos.video/api/v2/chat/integrations/<integration-uuid>`. The article's example is a UUID in the path. **VERIFIED**. |
| Payload | `{"message":"..."}` with `Content-Type: application/json`. `message` is the only documented field. **VERIFIED**. |
| Auth | The documented curl has no `Authorization` header, signature, or timestamp. **VERIFIED**. |
| Method | `POST` only. A live `GET` and `OPTIONS` returned `405` with `allow: POST`. **VERIFIED** (direct probe). |
| Unknown integration | `POST` to a random UUID with no auth returned `404` and `{"error": "integration not found"}` — not `401`. **VERIFIED** (direct probe). |
| Missing field | `POST {}` returned `400` with `1 validation error for MessageRequest / message / field required`. **VERIFIED** (direct probe). |
| Extra fields | Requests with `username`, `author`, `attachments`, `blocks`, or `markdown` passed validation and reached the integration lookup (returned `404`, not `422`). Whether any of them are rendered is undocumented. **VERIFIED** (direct probe; schema acceptance only). |
| Success response | Not documented. We did not `POST` to a real integration, to avoid writing test messages into someone's channel. **NOT PUBLIC**. |
| Rate limits | No documented limit and no `x-ratelimit` or `retry-after` headers observed on error responses. **NOT PUBLIC**. |
| Message length | No documented maximum. **NOT PUBLIC**. |
| Markdown, links, mentions, attachments | Only `message` is documented. **NOT PUBLIC**. |
| Attribution | The creation form has a name and a channel. The docs do not say whether posts appear as a bot, as the integration name, or as a user. **NOT PUBLIC**. |
| Direction | "Webhooks let you post messages to your Cosmos chat channels via HTTP." No read or reply path is documented. **VERIFIED**. |
| Management | "Delete this webhook" is the only management action documented. Rotation means delete and recreate. Multiple webhooks for different services/channels are supported ([integrations page](https://cosmos.video/product/features/integrations)). **VERIFIED**. |

- **INFERRED** The integration UUID in the URL is the credential. The request has no other demonstrated secret, an unauthenticated request reaches integration lookup, and an unknown UUID is rejected with `integration not found`. Treat the full URL as a bearer secret: anyone who has it can post to that channel.
- **INFERRED** The webhook is one-way: the only documented operation is posting, and no read or reply path exists.
- **VERIFIED** Error behavior is FastAPI/Pydantic-shaped (`MessageRequest`), which means the endpoint validates before it looks up the integration. That is useful for schema discovery but says nothing about delivery guarantees.
- **INFERRED** No idempotency key is documented, so a retry after a timeout can duplicate a message. The only defense is at-least-once delivery with a stable message body and accepting occasional duplicates, or not retrying ambiguous timeouts.

## Public API surface

- **VERIFIED** No public API documentation was found. `https://docs.cosmos.video` returned no response. `https://cosmos.video/docs`, `https://cosmos.video/api`, and `https://cosmos.video/developers` return the marketing SPA (HTML `200` with the site title), not developer docs. `https://cosmos.video/api/v2/docs` and `https://cosmos.video/api/v2/openapi.json` return `404` HTML.
- **VERIFIED** The help-center search for "api" returns exactly one article, the chat webhook above. "api key" returns unrelated articles; "developer" returns none ([help search](https://support.cosmos.video/search?query=api)).
- **VERIFIED** The webhook lives under an `/api/v2` namespace, so a v2 API exists. Only the integration endpoint is publicly described; the namespace itself is not a public contract.
- **NOT PUBLIC** A user post on Cosmos's official feedback board (2026-10-21) says "I understand that you can create an API key. However, I'm unable to find any documentation on its uses or the type of information it can retrieve" ([Canny](https://cosmos.canny.io/feature-requests/p/understanding-api-capabilities)). We could not verify an API-key screen without an account. Do not build against it.
- **VERIFIED** Cosmos's terms prohibit scraping, robots, spiders, data mining, automated extraction, and deep-linking without written permission ([terms](https://cosmos.video/terms)). Reading the app's internal endpoints or scraping the UI is not an acceptable substitute for an API.
- **INFERRED** The absence of docs plus the terms means any read integration is blocked on vendor access, not on Work OS engineering effort.
- We did not have a Cosmos account, so the in-app settings and the reported API-key screen could not be inspected. That is the main limit of this research.

## Inbound events

- **VERIFIED** No outbound event subscription, event type, signing secret, or delivery-retry contract is documented. The help center's only webhook article is the inbound chat post; the integrations page describes the webhook as "send messages from external tools to specific chat channels" ([integrations](https://cosmos.video/product/features/integrations)).
- **VERIFIED** The Slack integration is Cosmos → Slack: Cosmos posts office activity to Slack, syncs status, and adds a `/cosmos` command ([Slack article](https://support.cosmos.video/article/30-integration-slack)). That is a first-party destination integration, not a generic event API Work OS can subscribe to.
- **VERIFIED** A request for a "Broadcast API" (trigger an audio file by API/webhook) was closed; no shipped broadcast API is documented ([Canny](https://cosmos.canny.io/feature-requests/p/broadcast-api)).
- **INFERRED** There is nothing to verify for signatures or delivery semantics because no outbound event surface is published.

## Integration patterns Cosmos already supports

- **VERIFIED** Slack: activity notifications into a chosen Slack channel, status sync, named-conversation sharing, and the `/cosmos` slash command ([Slack article](https://support.cosmos.video/article/30-integration-slack); [integrations](https://cosmos.video/product/features/integrations)).
- **VERIFIED** Google Calendar and Outlook: schedule meetings, start a call when the first person joins, and show the day's schedule inside Cosmos ([integrations](https://cosmos.video/product/features/integrations)).
- **VERIFIED** Generic inbound webhook: external tools post messages into a Cosmos channel. This is the pattern the boss handed over.
- **VERIFIED** Embedded apps: open a shared Figma, Miro, Google Docs, or YouTube link inside a call ([changelog, 2025-07-24](https://cosmos.video/changelog)). These are shared web apps, not data integrations.
- **VERIFIED** Space Radio: shared YouTube playlists for the space ([integrations](https://cosmos.video/product/features/integrations)).
- **VERIFIED** Replay, transcription, AI summary, action items, and share links ([Replay](https://cosmos.video/product/features/call-recording--ai-cosmos-replay)).
- **VERIFIED** Admin analytics with CSV exports of conversation logs, user status logs, and office access logs ([analytics help](https://support.cosmos.video/article/128-space-insights-analytics-measure-your-teams-collaboration)).
- **VERIFIED** No native Linear, Notion, or Figma data integration is listed, and no Frame.io-style review integration is listed. Replay lists Google Docs and Notion integration as "coming soon" ([Replay](https://cosmos.video/product/features/call-recording--ai-cosmos-replay)).

## Mapping to Work OS

Work OS context used below: clock and break state can be driven by Worktivity through the Windows companion; manual pause/resume is disabled when Worktivity authoritative breaks are on (`src/lib/work-os-workday.ts`, `src/lib/work-os-policy.ts`). Durable transitions are written to `work_session_events` with a unique `(organization_id, idempotency_key)` (`supabase/migrations/0015_work_os_workday_foundation.sql`). Provider evidence already has a shape: `work_evidence_events` with `provider`, `external_event_id`, `evidence_class`, `person_id`, `occurred_at`, `artifact_url`, `raw`, and a unique `(organization_id, provider, external_event_id)` (`supabase/migrations/0010_work_os_employee_companion.sql`). We found no generic outbound notification outbox in the repo today.

| Work OS need | Cosmos direction | Feasibility | What Work OS must build |
| --- | --- | --- | --- |
| Clock-in / clock-out / break start / break end → channel post (the boss's ask) | Work OS → Cosmos | **High.** This is the only documented capability. **VERIFIED** | Outbox, dispatcher, per-org encrypted webhook config, retry/dead-letter, event filter, feature flag, tests. |
| Activity inference / work check-ins | Cosmos → Work OS | **None today.** No public read API is documented. CSV export is manual and admin-only. **VERIFIED** absence; **INFERRED** not usable as a signal | Nothing until API access. Do not scrape or infer from the desktop app. |
| EOD reports and recaps | Cosmos → Work OS | **None today.** A Replay link can be pasted manually as a link, but Work OS has no Cosmos parser (unlike its Loom path), there is no public API or stable citation, and free-plan recordings expire. **VERIFIED** exports/retention; **INFERRED** manual-only | At most an optional "Replay link" field; no automated evidence citation. |
| Creative-review evidence: comments, approvals, versions, time-in-review | Cosmos → Work OS | **Not applicable.** Cosmos has no review/approval/asset-version objects; annotation is live and Replay is a meeting recording. **INFERRED** from the published feature set | Nothing. If this is the real need, use a review tool with an API; Cosmos is the wrong system. |
| Admin visibility: Cosmos feed inside Work OS, or Work OS events inside Cosmos | Both, but only outbound works | **Outbound high; inbound none.** Work OS can post into Cosmos; Work OS cannot read a Cosmos channel. **VERIFIED** | Post to a channel and link out. A Cosmos feed inside Work OS needs a read API that is not documented. |

### The asymmetry: a notification pipe is not an evidence source

A chat webhook is an output device. Posting `"Maya clocked in at 09:02"` proves only that Work OS sent a string to Cosmos at some point. It does not prove Maya clocked in, no message id is documented, and it does not give Work OS any record it can later query.

- **Direction.** The webhook is Work OS → Cosmos. There is no documented read path, so the data flow stops at the channel.
- **Trust.** Cosmos displays what Work OS told it. That is a claim, not an observation. It can prompt a human to notice something; it cannot substantiate an EOD or recap line.
- **Identity.** Attribution to the employee is not documented. The docs do not say whether the post is labeled with the integration name, a bot, or a user.
- **Verification.** A `2xx` response would only mean Cosmos accepted the HTTP request. There is no documented delivery receipt, message id, or read-back.
- **Social accountability is not evidence.** A visible channel can create awareness. Work OS's evidence model needs stable external ids, timestamps, actor attribution, and dedupe; a chat message has none of those.

To make Cosmos an evidence source, all of the following are required: authenticated read access, scopes that cover the relevant objects, stable ids and timestamps, an identity mapping from Cosmos users to Work OS people, dedupe against re-delivery, correction/retraction semantics, and a retention agreement. Section "What would make Cosmos an evidence source" maps that to the existing Work OS tables.

## What `#timebot` actually needs

The real requirement, confirmed on 2026-11-17, is not "publish attendance analytics". It is **replacing a manual punch-clock channel**. Employees currently open Cosmos and type one word into `#timebot` at each transition. The channel's own history shows the convention:

- Messages are terse: `in`, `break`, `out`. No names, no dates, no sentences — the channel timestamp and the message author supply both.
- The **author is the employee**. Identity comes from the Cosmos account, not from the text.
- Some messages carry a thread reply, so the channel is also used conversationally around an event.
- Cosmos inserts `Today` / `Yesterday` dividers itself.

That convention drives three requirements the generic design above does not capture.

### 1. Attribution changes, and that is a product decision

A webhook post is almost certainly authored by the integration, not by the employee. The help article documents a name at creation time and says nothing about per-message authors. If Work OS posts into `#timebot`, the channel stops showing "David · in" and starts showing one bot name for every employee.

There is no documented way to impersonate the employee, and Work OS should not try. So the employee's name must move into the message body:

| Option | Message | Trade-off |
| --- | --- | --- |
| **A. Name in body** (recommended) | `David — in` | Honest, works with any attribution model, slightly more verbose than today |
| B. One thread per person per day | Parent `David — Today`, replies `in 15:00`, `break 15:40`, `out 21:01` | Tidiest, but threading is undocumented on the webhook |
| C. Keep the terse style | `in` | Unusable: every post looks identical and anonymous |

Option A is the only one certain to work with the documented payload.

**Decision (2026-11-17): flat, and threading is closed, not deferred.** Flat `Name — event` messages are the supported shape. The live test settled the threading question: the endpoint returns `200` with an empty body `{}` — no message id. Without a message id there is no parent to reply to, and without a read API there is no way to discover one. Even if the endpoint silently accepted a `thread_id`, Work OS could never obtain the value. Daily threads are therefore not buildable on this surface. Revisit only if Cosmos ships a documented message id or a read API.

Keep the seam cheap: store a `render_mode` on the channel (`flat` by default, `daily_thread` reserved) and keep the outbox `payload` as `jsonb`. If threading turns out to work, it becomes a renderer change and a per-channel setting — no migration, no new table.

### 2. "Immediately" rules out a cron-only dispatcher

A one-minute sweep is durable but can lag by up to a minute, which is noticeable when someone is watching the channel to confirm their own clock-in. Use both:

1. **Commit first** the session transition and its outbox row.
2. **Then dispatch after the response is sent**, using Next.js `after()` (or the route's `waitUntil`), with a 3–5 s timeout. This is what makes it feel instant.
3. **Keep the cron sweep** as the safety net for anything still `pending` after 30 s, plus retries.

The clock response never waits on Cosmos, and a failed inline send is invisible to the employee because the sweep retries it.

### 3. Ambiguity between clock-in and returning from break

The current manual convention uses `in` for both, disambiguated by the preceding `break`. If a bot posts, that cue is weaker because messages are no longer visually grouped by author. Recommend `in`, `break`, `back`, `out` and raise the wording change with the team before rollout.

### What the live test showed (2026-11-17)

Six posts were sent to the live `#timebot` integration from a terminal. Observed behaviour:

| Check | Result |
| --- | --- |
| HTTP | `200` with body `{}` for every post. No message id, no delivery receipt, no rate-limit headers |
| Latency | ~1.5 s per request |
| Author | **The integration's name**, with a generic grey avatar. In this test the integration was named `in`, so the channel showed `in · 17:06` |
| Rendering | The em dash and `(31m)` rendered correctly |
| Ordering | Preserved |
| **Grouping** | **Consecutive posts from the integration collapsed into one author block, and only the first timestamp was displayed** |
| **Deletion** | After a Cosmos software update (reported 2026-11-17), the team could no longer delete posted messages. Treat every post as permanent |

That last row is the trap. Six events posted seconds apart appeared as one block:

```
in  17:06
  Work OS integration test — ignore this message
  David — in
  David — break
  David — back (31m)
  David — out
```

The individual event times vanished. Real transitions are minutes or hours apart, so they may well get their own blocks — but that is unverified, and the design must not depend on it.

Two consequences:

1. **Put the local time in every message body.** `17:06 David — in` keeps each line self-describing whether or not Cosmos groups it.
2. **Name the integration something meaningful.** The author label is the integration name, so `in` reads as nonsense. Use `Work OS` or `Timebot`. Renaming means deleting and recreating the integration, which changes the URL — do it before wiring anything up.

### Cutover risk

Until manual posting stops, the channel gets **double entries** — one human, one bot. Plan a short overlap: announce the switch, then have the team stop typing. Do not backfill weeks of history from the database; the queue only carries transitions that occur from the moment it is enabled.

**Test in a private channel, never in `#timebot`.** Since messages can no longer be deleted, a bad test post is permanent. Create a private `work-os-test` channel, point a separate webhook at it, and verify there. Only create the production integration against `#timebot` once the format and rendering are settled — and give it a real name, because that name becomes the author label.

## The outbound notification design

Scope: four events — `clock_in`, `pause` (break start), `resume` (break end), `clock_out`. Do not post `eod_due`, `late_reason`, `worktivity_adopted`, `worktivity_reopened`, or `resolve_missed_clock_out`; those are system/correction events, not employee-facing milestones.

Cosmos is never on the clock path. The clock transition commits to `work_session_events`; the outbox row is enqueued in the same transaction (or by reconciliation); HTTP happens later. Cosmos downtime grows the outbox, not the clock latency, and no clock event is lost if the channel is unavailable.

### Data model

Two additive tables are enough; keep the design provider-neutral so Slack or Teams can reuse the dispatcher later.

Work OS has no generic outbound notification outbox, but it does have the right precedent: `supabase/migrations/0044_work_task_provider_outbox.sql` and `0047_work_task_provider_create_intent.sql` make the proposal row the durable intent and adopt the provider id on every retry, so a crash between the HTTP call and the mirror write cannot duplicate work. Copy that stance here — the outbox row is the durable intent, the send is idempotent per `(channel_id, session_event_id)`, and a retry adopts the existing row instead of creating a second post.

```sql
create table work_notification_channels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references work_organizations(id) on delete cascade,
  provider text not null check (provider in ('cosmos_chat','webhook')),
  label text not null,
  destination_cipher text not null,          -- encrypted webhook URL
  events text[] not null default '{clock_in,pause,resume,clock_out}',
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table work_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references work_organizations(id) on delete cascade,
  channel_id uuid not null references work_notification_channels(id) on delete cascade,
  session_event_id uuid not null references work_session_events(id) on delete cascade,
  event_type text not null,
  person_id uuid not null references work_people(id) on delete cascade,
  observed_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending','sending','sent','failed','dead')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (channel_id, session_event_id)
);
create index work_notification_outbox_due_idx
  on work_notification_outbox (status, next_attempt_at);
```

`unique (channel_id, session_event_id)` is the dedupe: one post per channel per work-session event. Fan-out to multiple channels creates one row per channel.

### Producer

Use an `after insert` trigger on `work_session_events`, not four call sites. It covers `clockIn`, `syncWorktivitySession`, `transitionSession`, and future paths. The trigger should insert one outbox row per active channel whose `events` array contains `NEW.event_type`.

Two guards matter:

- **Never break the clock write.** Wrap the trigger body in `exception when others then raise warning ...; return new;`. A missing outbox table or a bad channel row must not fail the clock-in transaction.
- **Never drop a transition for age.** Age changes the presentation, not whether the line exists. A Worktivity recovery at 18:00 still posts the 09:00 clock-in, marked `(delayed 8h)` and dated. Silently omitting it would leave a break or a return with no matching half. See the decision note below.

Add a small reconciliation job (same `CRON_SECRET` pattern as `src/app/api/work-os/attendance/sync-due/route.ts`) that finds `work_session_events` of the four types with no outbox row for an active channel and inserts them. This covers a swallowed trigger failure without making the clock path fragile.

### Dispatcher

`POST /api/work-os/integrations/cosmos/dispatch`, protected by `Authorization: Bearer ${CRON_SECRET}`, following the existing scheduled-route pattern. Run every minute.

1. Reset `sending` rows older than 5 minutes (a worker may have died mid-send), then claim a bounded batch with `for update skip locked`, ordered by `created_at`; use a per-channel advisory lock so one worker owns a channel and ordering is preserved.
2. Render the message from the joined person and event.
3. `POST` the channel URL with `Content-Type: application/json`, a 5-second timeout, and no redirects.
4. Classify the result:

| Result | Action |
| --- | --- |
| `2xx` | `sent`, `sent_at = now()` |
| `400`, `401`, `403`, `404` | `dead`; the URL or payload is wrong. Surface to admins; do not retry. |
| `408`, `429`, `5xx`, network timeout | `failed`; exponential backoff `1m, 5m, 15m, 1h, 6h`, then hold at 6h. A valid transition is never dead-lettered for running out of attempts. |
| Other `4xx` | `dead`; log the body. |

5. Keep the last error but redact the URL. A `404` after a working period usually means the Cosmos integration was deleted; show "Cosmos integration missing or rotated" to admins.
6. Head-of-line rule: if an earlier event for the same channel is not yet `sent` or `dead`, do not send a later event past it. This keeps "clocked in → break → resume → clocked out" in order. A dead event unblocks the queue.

Because Cosmos documents no idempotency key, a timeout after Cosmos accepted the message can duplicate it. Accept at-least-once delivery; do not build a fake exactly-once guarantee.

### Secrets

The full webhook URL is a bearer secret. Encrypt it with the existing AES-256-GCM helper (`encryptProviderSecret` / `decryptProviderSecret` in `src/lib/work-os-secrets.ts`, keyed by `WORK_OS_PROVIDER_SECRET_KEY`) and store only `destination_cipher`. Never return the URL to the browser; show the channel label and a masked UUID, plus a "replace URL" action. Never log it, including in `last_error`. Record create/rotate/delete in `work_audit_log`.

### Message copy and privacy

Match the channel's existing convention rather than inventing a new one. The employee's name has to be in the body because the author will be the integration, not the person — and so does the time, because grouped posts only show one timestamp:

- `09:02 David — in`
- `13:05 David — break`
- `13:34 David — back (29m)` — the duration is optional but useful
- `17:31 David — out`

Use the employee's local timezone. Keep the four event words stable and lowercase so the channel stays scannable.

Do not include late reasons, EOD content, task titles, screenshots, break reasons, or total hours worked. Make the integration per-org opt-in and admin-configured; do not enable it by default. Cosmos's own analytics page says its data is for understanding availability "rather than for monitoring work hours" ([analytics](https://cosmos.video/product/features/space-insights--analytics)); the notification design should follow that spirit.

**Privacy note for this specific channel.** `#timebot` is already visible to everyone in the space, so employees have effectively accepted that their breaks are public. Automating it does not create new visibility, but it does make the record complete and machine-posted — every break, every day, with durations. Get explicit sign-off from the team, not just the administrator, and keep the channel membership scoped to the people whose time is posted.

### Admin surface and verification

Admin → Settings → Integrations → Cosmos: paste the webhook URL, choose events, send a test message, see last delivery status and recent failures. Store one channel binding per org (or several, with a label).

Verification:

- Unit: event filter, message rendering, retry classifier, backoff, URL masking.
- DB: one row per active channel; duplicate `session_event_id` does not duplicate; a forced trigger exception does not block a `work_session_events` insert.
- Failure isolation: with Cosmos returning `500` or timing out, clock-in still succeeds and the outbox row stays `pending`/`failed`; when the stub recovers, the message sends.
- Ordering: a failed clock-in blocks later break messages for that channel until it is `sent` or `dead`.
- Live: create a private test channel, send the four-event sequence, confirm order, content, and duplicate behavior.

### What was built (v1, 2026-11-17)

Single-channel, env-configured. Branch `codex/cosmos-timebot`.

| Piece | File |
| --- | --- |
| Outbox table, enqueue trigger, claim function | `supabase/migrations/0075_work_cosmos_timebot_notifications.sql` |
| Renderer, delivery classifier, backoff, queue drain | `src/lib/work-os-cosmos-timebot.ts` |
| Scheduled drain and retry | `src/app/api/work-os/integrations/cosmos/timebot/dispatch/route.ts` |
| Retry safety net every 10 minutes | `.github/workflows/work-os-timebot-dispatch.yml` |
| Inline flush right after a real transition | `src/app/api/work-os/attendance/observe/route.ts` (uses `after()`) |
| Flush after the scheduled attendance sweep | `src/app/api/work-os/attendance/sync-due/route.ts` |
| Tests | `test/work-os-cosmos-timebot.test.mts` |

**Environment.** `COSMOS_TIMEBOT_WEBHOOK_URL` and `COSMOS_TIMEBOT_ORGANIZATION_ID` together enable the feature. One without the other is treated as a configuration error and nothing is sent: the destination is a single channel, so the deployment must name the organization it speaks for, or a second tenant's attendance would land in the same channel. `CRON_SECRET` already exists for the scheduled routes.

**Behaviour.** Only `clock_in`, `pause`, `resume` and `clock_out` are posted. The trigger snapshots the person's name and the session timezone at enqueue time, so a later rename or timezone change cannot rewrite history. The queue is ordered per organization on `(observed_at, enqueue_seq)`: a failed send blocks later events until it is sent or dead, keeping `in → break → back → out` readable.

**Late lines are marked, never dropped.** An independent review of an earlier revision found that the first version discarded events older than 15 minutes at enqueue. That was incoherent: an event received promptly but delivered late by the retry loop was posted bare, while the same event first seen 16 minutes late was deleted. Two identical transitions produced different channel histories depending only on where the delay happened. Lateness is now measured at **delivery** (`attempt time − observed_at`) and only changes the text:

- under 15 minutes: `17:06 David — in`
- 15 minutes to a day: `17:06 David — in (delayed 20m)`
- an earlier local day: `16 Nov 23:50 David — in (delayed 20m)`
- multi-day: `14 Nov 17:06 David — out (delayed 3d)`

The date appears only when the event's local day differs from the delivery day, because Cosmos's `Today`/`Yesterday` dividers describe posting time. The marker is attached per event, so a delayed `break` does not make the following `back` look delayed.

**Deferred by decision.** Compressing anything older than 24 hours into one per-person recovery line was considered and deliberately postponed: the team is small, multi-day outages are rare, and dated individual lines degrade honestly. Revisit only if a real backlog proves noisy.

**Deliberately deferred.** Per-org admin configuration and a test-send button. The URL is global, so every organization posts into the same channel — fine for a single-company deployment, wrong the moment a second tenant exists. Upgrading means adding a channel table and joining it in the trigger; the outbox and dispatcher do not change.

**Verification.** 17 focused tests pass; `work-os:typecheck` passes; the migration applies twice cleanly under PGlite; `eslint` is clean; `work-os-route-contracts` passes (25 tests).

## What would make Cosmos an evidence source

Cosmos would need to expose, at minimum:

1. **Read auth and scopes.** An API key or OAuth app with read-only scopes for spaces, channels, members, messages, recordings, and analytics. The current webhook URL grants write-to-one-channel only.
2. **Stable object ids and timestamps.** Message id, author id, channel id, thread id, created/edited/deleted times; recording id and duration; presence/status interval id. Display names are not enough.
3. **Member identity.** A stable user id plus email or an admin-verified mapping, so Work OS can resolve `work_source_accounts` (`provider = 'cosmos'`, `verified = true`) instead of matching by name.
4. **Event or delta semantics.** Either outbound webhooks with signatures and delivery ids, or a read endpoint that supports incremental sync and tombstones for edits/deletes.
5. **Attribution.** An explicit actor per object. A channel message is a `work_claim`, not proof of work; a recording is an artifact; presence is an `activity_observation`.
6. **Retention and correction.** A guarantee that an artifact URL will still resolve for the evidence retention period. Free-plan recordings expire after 15 days; paid plans advertise unlimited retention subject to storage ([pricing](https://cosmos.video/pricing)). Corrections and retractions need to propagate.
7. **Privacy agreement.** No DM ingestion, no surveillance of conversation content, and a written scope for which channels/artifacts may be analyzed.

If those exist, the mapping is straightforward:

| Cosmos object | Work OS evidence class | Notes |
| --- | --- | --- |
| Status/presence interval, office access log | `activity_observation` | Establishes presence, not output. Do not use for EOD claims. |
| Channel message authored by the employee | `work_claim` | A claim, not verified output. Needs task linkage to be useful. |
| Replay recording + summary | `output_evidence` or `work_claim` | The recording is the artifact; the AI summary is a claim about it. |
| Review comment / approval | Not present in the published feature set | Would be `output_evidence` if Cosmos ever ships review objects. |

The existing `work_evidence_events` shape already supports this: `provider = 'cosmos'`, `external_event_id` from Cosmos, the Cosmos actor resolved into `person_id`, `occurred_at`, `artifact_url`, `raw`, and the unique `(organization_id, provider, external_event_id)` for dedupe. Attribution would reuse `resolveProviderAttribution` and `work_source_accounts`, as GitHub and GHL do.

The `performed` vs `triggered` distinction cannot come from Cosmos. Cosmos activity is presence and communication; it does not know whether the employee produced an artifact or merely triggered a downstream event. Work OS's artifact-level providers (GitHub, GHL, a review tool) can support that distinction with evidence.

## Rollout checklist

1. **Decide the destination.** Because Cosmos no longer allows message deletion, verify in a private `work-os-test` channel first if the format or the integration name is still in question. Otherwise the first real transition is the test, permanently.
2. **Apply the migration.** `npm run db:apply -- supabase/migrations/0075_work_cosmos_timebot_notifications.sql`. Additive only; it creates one table, one trigger, one function.
3. **Set `COSMOS_TIMEBOT_WEBHOOK_URL` and `COSMOS_TIMEBOT_ORGANIZATION_ID`** in the server environment. Either one alone is a no-op, so this pair is the moment the feature becomes live.
4. **Redeploy** through the normal Work OS path.
5. **Verify with one real transition.** Clock in, then confirm the line appears in the channel within a few seconds. Check `work_notification_outbox` shows `sent`.
6. **Watch the first day.** A `dead` row with `integration missing or rotated (404)` means the Cosmos integration was deleted. A `failed` row retries on the 1m/5m/15m/1h/6h schedule and then holds at six hours until it succeeds; late deliveries are marked in the channel rather than discarded.

**Rollback.** Unset `COSMOS_TIMEBOT_WEBHOOK_URL` and redeploy. Rows keep queueing but nothing is sent; set the variable again and the backlog drains. The migration can stay in place indefinitely — an unused outbox is inert.

## Recommendation

**Do the notification-only integration now.** It is small, it matches the boss's actual ask, and it uses the only capability Cosmos documents. The concrete goal is narrower than "integrate Cosmos": **retire manual `#timebot` typing** by having Work OS post the four transitions. Keep it behind a per-org feature flag; do not describe it as evidence, attendance verification, or productivity measurement.

**Two decisions are needed before code, and neither is technical.** First, the message convention: the employee's name must be in the body once the author becomes the integration, so the terse `in` / `break` / `out` style cannot survive unchanged. Second, team sign-off on a complete, machine-posted break record — `#timebot` is already public, but automation makes it exhaustive.

**Wait for API access before any evidence work.** Do not scrape the Cosmos app, call undocumented `/api/v2` endpoints, or reverse-engineer the internal API; the terms prohibit it, and the result would be fragile and unsupported.

**Smallest useful next step.** Ask the boss to create a private test channel and a test webhook integration, then post four messages by hand from a terminal to confirm attribution, rendering, and ordering before writing any code. That single experiment answers the biggest unknowns. Then ship one PR with the two tables, the trigger, the dispatcher, the admin config, and the four-event test. In parallel, send the open questions below to the Cosmos contact. If Cosmos confirms a read API and scopes, scope that as a separate project; until then, Cosmos is not an automated evidence source — only a manual link or CSV export.

## Open questions for the Cosmos contact

1. Is the integration URL the only credential? Is there a signing secret, HMAC header, or rotation flow?
2. What does a successful response return — status code, body, message id? Can we retrieve or reconcile a message later?
3. What fields beyond `message` are supported: author/bot name, avatar, markdown, links, mentions, attachments, blocks?
4. What are the message length limit and rendering rules for URLs, emoji, and line breaks?
5. What are the rate limits per integration and per space? What should a client do on `429`?
6. Is delivery retried by Cosmos, or is it fire-and-forget? Is there any idempotency key?
7. How are webhook posts attributed in the channel — bot, integration name, or a user? Can we set the display name/icon?
8. Does Cosmos have a public or private API for reading channels, messages, members, presence, Replay, and analytics? What auth and scopes?
9. The feedback board mentions an API key screen. What is it for, and where are its docs?
10. Are there outbound webhooks or event subscriptions? Event types, signatures, retry policy, delivery ids?
11. Can the CSV analytics exports be scheduled or fetched via API, or are they manual downloads only?
12. What are the retention periods for messages, Replay recordings, transcripts, and analytics exports on each plan?
13. Is there an enterprise agreement or DPA that covers posting employee attendance events into a shared channel?

## Sources

First-party Cosmos sources, accessed 2026-11-16:

- https://cosmos.video — product positioning, "virtual office", remote teams.
- https://cosmos.video/product/features/integrations — Slack, calendar, webhook, embedded apps, Space Radio.
- https://cosmos.video/product/features/space-insights--analytics — admin analytics, presence, "not for monitoring work hours".
- https://cosmos.video/product/features/call-recording--ai-cosmos-replay — Replay, transcription, summaries, sharing.
- https://cosmos.video/changelog — screen annotation, embedded apps, current product.
- https://cosmos.video/pricing — plans, retention, roles, UK/GDPR/SOC 2 claims.
- https://cosmos.video/terms — scraping/automation prohibition.
- https://security.cosmos.video — GDPR and SOC 2 listings.
- https://support.cosmos.video/article/131-set-up-webhooks-for-chat-integrations — the only webhook documentation.
- https://support.cosmos.video/article/30-integration-slack — Cosmos → Slack behavior.
- https://support.cosmos.video/article/128-space-insights-analytics-measure-your-teams-collaboration — CSV exports.
- https://support.cosmos.video/article/116-record-your-call-in-cosmos-and-get-shareable-ai-summary-and-transcriptions — Replay behavior and sharing.
- https://support.cosmos.video/article/122-chat-channels-keep-discussions-organised — channel model.
- https://support.cosmos.video/search?query=api — only one API-related article.
- https://cosmos.canny.io/feature-requests/p/understanding-api-capabilities — user report of an API key, no docs.
- https://cosmos.canny.io/feature-requests/p/api-access-to-track-attendanceabsences — attendance request marked complete via Analytics, not API.
- https://cosmos.canny.io/feature-requests/p/broadcast-api — inbound broadcast API request closed.

Live probes, 2026-11-16:

- `GET`/`OPTIONS https://cosmos.video/api/v2/chat/integrations/<uuid>` → `405`, `allow: POST`.
- `POST` with no auth to a random UUID → `404 {"error":"integration not found"}`.
- `POST {}` → `400` Pydantic "message field required".
- `POST` with extra fields → `404` (validation accepted; rendering unknown).
- `GET https://cosmos.video/api/v2/docs`, `/api/v2/openapi.json` → `404` HTML.
- `https://docs.cosmos.video` → no response.

Work OS references:

- `src/lib/work-os-workday.ts` — clock/break transitions, `work_session_events` audit, Worktivity authority.
- `src/lib/work-os-policy.ts` — `worktivity_authoritative_breaks`.
- `src/lib/work-os-evidence.ts` — provider evidence ingestion and attribution.
- `src/lib/work-os-secrets.ts` — AES-256-GCM provider secret storage.
- `src/app/api/work-os/attendance/sync-due/route.ts` — existing `CRON_SECRET` scheduled-route pattern.
- `supabase/migrations/0015_work_os_workday_foundation.sql` — `work_session_events` and unique idempotency key.
- `supabase/migrations/0010_work_os_employee_companion.sql` — `work_evidence_events`, `work_provider_connections`, `work_source_accounts`.
