import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  COSMOS_TIMEBOT_EVENTS,
  DELAY_MARKER_MS,
  classifyTimebotDelivery,
  cosmosTimebotConfigured,
  describeTimebotFailure,
  humanDelay,
  postTimebotMessage,
  renderTimebotMessage,
  timebotBackoffMs,
} from "../src/lib/work-os-cosmos-timebot.ts";

const observedAt = "2026-11-17T17:06:00.000Z";
// Fresh relative to the event, so the line carries no delay marker.
const fresh = { now: observedAt } as const;

test("renders the channel's own vocabulary: in, break, back, out", () => {
  const words = COSMOS_TIMEBOT_EVENTS.map((event) =>
    renderTimebotMessage({ displayName: "David Zawadi", eventType: event, observedAt, timezone: "Europe/London", ...fresh }),
  );
  assert.deepEqual(words, ["17:06 David — in", "17:06 David — break", "17:06 David — back", "17:06 David — out"]);
});

test("uses the employee's timezone, not the server's", () => {
  const message = renderTimebotMessage({ displayName: "Aden", eventType: "clock_in", observedAt, timezone: "America/New_York", ...fresh });
  assert.equal(message, "12:06 Aden — in");
});

test("falls back to UTC instead of throwing on a bad timezone", () => {
  assert.equal(
    renderTimebotMessage({ displayName: "Aden", eventType: "clock_in", observedAt, timezone: "Mars/Olympus", ...fresh }),
    "17:06 Aden — in",
  );
  assert.equal(renderTimebotMessage({ displayName: "Aden", eventType: "clock_in", observedAt, timezone: null, ...fresh }), "17:06 Aden — in");
});

test("an unparseable timestamp still produces a postable line", () => {
  assert.equal(renderTimebotMessage({ displayName: "Aden", eventType: "clock_in", observedAt: "not-a-date", timezone: "UTC", ...fresh }), "--:-- Aden — in");
});

test("keeps only the first name so the channel stays scannable", () => {
  assert.equal(
    renderTimebotMessage({ displayName: "  Lisa   van der Berg ", eventType: "clock_out", observedAt, timezone: "UTC", ...fresh }),
    "17:06 Lisa — out",
  );
});

test("refuses events the channel should never see", () => {
  for (const eventType of ["late_reason", "mark_active", "worktivity_reopened", "resolve_missed_clock_out", ""]) {
    assert.equal(renderTimebotMessage({ displayName: "David", eventType, observedAt, timezone: "UTC", ...fresh }), null);
  }
  assert.equal(renderTimebotMessage({ displayName: "   ", eventType: "clock_in", observedAt, timezone: "UTC", ...fresh }), null);
});

test("a late line is posted and marked, never dropped", () => {
  const message = renderTimebotMessage({
    displayName: "David",
    eventType: "pause",
    observedAt: "2026-11-17T11:40:00.000Z",
    timezone: "Europe/London",
    now: "2026-11-17T12:00:00.000Z",
  });
  assert.equal(message, "11:40 David — break (delayed 20m)");
});

test("a line under the marker threshold stays terse", () => {
  const justUnder = new Date(Date.parse(observedAt) + DELAY_MARKER_MS - 1_000).toISOString();
  assert.equal(renderTimebotMessage({ displayName: "David", eventType: "clock_in", observedAt, timezone: "UTC", now: justUnder }), "17:06 David — in");
  const justOver = new Date(Date.parse(observedAt) + DELAY_MARKER_MS).toISOString();
  assert.equal(
    renderTimebotMessage({ displayName: "David", eventType: "clock_in", observedAt, timezone: "UTC", now: justOver }),
    "17:06 David — in (delayed 15m)",
  );
});

test("a delayed line from an earlier local day carries the date", () => {
  // 23:50 on the 16th, delivered 20 minutes later on the 17th.
  const message = renderTimebotMessage({
    displayName: "David",
    eventType: "clock_in",
    observedAt: "2026-11-16T23:50:00.000Z",
    timezone: "Europe/London",
    now: "2026-11-17T00:10:00.000Z",
  });
  assert.equal(message, "16 Nov 23:50 David — in (delayed 20m)");
});

test("a multi-day delay is dated and expressed in days", () => {
  const message = renderTimebotMessage({
    displayName: "David",
    eventType: "clock_out",
    observedAt: "2026-11-14T17:06:00.000Z",
    timezone: "Europe/London",
    now: "2026-11-17T17:06:00.000Z",
  });
  assert.equal(message, "14 Nov 17:06 David — out (delayed 3d)");
});

test("the delay marker describes the event, not the following one", () => {
  // A delayed break followed by a prompt back: the back must stay unmarked.
  const lateBreak = renderTimebotMessage({
    displayName: "David",
    eventType: "pause",
    observedAt: "2026-11-17T11:40:00.000Z",
    timezone: "UTC",
    now: "2026-11-17T12:00:00.000Z",
  });
  const promptBack = renderTimebotMessage({
    displayName: "David",
    eventType: "resume",
    observedAt: "2026-11-17T11:58:00.000Z",
    timezone: "UTC",
    now: "2026-11-17T12:00:00.000Z",
  });
  assert.equal(lateBreak, "11:40 David — break (delayed 20m)");
  // Two minutes late is under the marker threshold, so the prompt back stays
  // unmarked: the delay belongs to the break alone.
  assert.equal(promptBack, "11:58 David — back");
});

test("humanDelay stays legible across magnitudes", () => {
  assert.equal(humanDelay(20 * 60_000), "20m");
  assert.equal(humanDelay(3 * 60 * 60_000), "3h");
  assert.equal(humanDelay(3 * 24 * 60 * 60_000), "3d");
  assert.equal(humanDelay(1), "1m");
});

test("treats a 2xx as sent and never retries it", () => {
  for (const status of [200, 201, 204]) assert.equal(classifyTimebotDelivery(status), "sent");
});

test("treats wrong-URL and rejected statuses as permanent", () => {
  for (const status of [400, 401, 403, 404, 422]) assert.equal(classifyTimebotDelivery(status), "dead");
});

test("retries timeouts, rate limits, server errors and network failures", () => {
  for (const status of [408, 429, 500, 502, 503]) assert.equal(classifyTimebotDelivery(status), "retry");
  assert.equal(classifyTimebotDelivery(null), "retry");
});

test("backoff grows and then holds at six hours", () => {
  assert.equal(timebotBackoffMs(1), 60_000);
  assert.equal(timebotBackoffMs(2), 5 * 60_000);
  assert.equal(timebotBackoffMs(3), 15 * 60_000);
  assert.equal(timebotBackoffMs(4), 60 * 60_000);
  assert.equal(timebotBackoffMs(5), 6 * 60 * 60_000);
  assert.equal(timebotBackoffMs(50), 6 * 60 * 60_000);
});

test("a valid transition is never dead-lettered for running out of attempts", () => {
  const lib = readFileSync("src/lib/work-os-cosmos-timebot.ts", "utf8");
  assert.doesNotMatch(lib, /gave up after/);
  assert.doesNotMatch(lib, /MAX_ATTEMPTS/);
});

test("posts exactly the documented payload", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const result = await postTimebotMessage("17:06 David — in", "https://cosmos.test/hook", (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch);

  assert.deepEqual(result, { status: 200 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://cosmos.test/hook");
  assert.equal(calls[0].init.method, "POST");
  assert.equal((calls[0].init.headers as Record<string, string>)["Content-Type"], "application/json");
  assert.equal(calls[0].init.body, JSON.stringify({ message: "17:06 David — in" }));
  assert.equal(calls[0].init.redirect, "error");
});

test("a dead integration surfaces as a status, not a throw", async () => {
  const result = await postTimebotMessage("17:06 David — in", "https://cosmos.test/hook", (async () =>
    new Response('{"error":"integration not found"}', { status: 404 })) as unknown as typeof fetch);
  assert.equal(result.status, 404);
  assert.equal(classifyTimebotDelivery(result.status), "dead");
});

test("a network failure stays retryable", async () => {
  const result = await postTimebotMessage("17:06 David — in", "https://cosmos.test/hook", (async () => {
    throw new Error("connect timeout");
  }) as unknown as typeof fetch);
  assert.equal(result.status, null);
  assert.match(result.error ?? "", /connect timeout/);
});

test("the stored failure reason never contains the webhook URL", () => {
  const reason = describeTimebotFailure(null, "connect timeout at https://cosmos.video/api/v2/chat/integrations/secret-id");
  assert.doesNotMatch(reason, /secret-id/);
  assert.doesNotMatch(reason, /cosmos\.video/);
  assert.match(reason, /\[url\]/);
});

test("needs both the webhook and the organization binding", () => {
  assert.equal(cosmosTimebotConfigured({}), false);
  assert.equal(cosmosTimebotConfigured({ COSMOS_TIMEBOT_WEBHOOK_URL: "https://cosmos.test/hook" }), false);
  assert.equal(cosmosTimebotConfigured({ COSMOS_TIMEBOT_ORGANIZATION_ID: "org-1" }), false);
  assert.equal(cosmosTimebotConfigured({ COSMOS_TIMEBOT_WEBHOOK_URL: "   ", COSMOS_TIMEBOT_ORGANIZATION_ID: "org-1" }), false);
  assert.equal(
    cosmosTimebotConfigured({ COSMOS_TIMEBOT_WEBHOOK_URL: "https://cosmos.test/hook", COSMOS_TIMEBOT_ORGANIZATION_ID: "org-1" }),
    true,
  );
});

test("the dispatcher never posts another organization's attendance", () => {
  const lib = readFileSync("src/lib/work-os-cosmos-timebot.ts", "utf8");
  assert.match(lib, /row\.organization_id !== organizationId/);
  assert.match(lib, /organization is not bound to this timebot destination/);
});

test("a swallowed enqueue has a recovery path", () => {
  const lib = readFileSync("src/lib/work-os-cosmos-timebot.ts", "utf8");
  assert.match(lib, /work_reconcile_timebot_outbox/);
  const sql = readFileSync("supabase/migrations/0075_work_cosmos_timebot_notifications.sql", "utf8");
  assert.match(sql, /create or replace function work_reconcile_timebot_outbox/);
});

test("the dispatch route is cron-authenticated", () => {
  const route = readFileSync("src/app/api/work-os/integrations/cosmos/timebot/dispatch/route.ts", "utf8");
  assert.match(route, /CRON_SECRET/);
  assert.match(route, /authorization/);
  assert.match(route, /flushTimebotOutbox/);
});

test("the attendance sync schedules the flush after the response", () => {
  const route = readFileSync("src/app/api/work-os/attendance/sync-due/route.ts", "utf8");
  assert.match(route, /after\(async \(\) => \{/);
  assert.match(route, /flushTimebotOutbox/);
  assert.doesNotMatch(route, /=\s*await flushTimebotOutbox/, "a slow Cosmos must not hold the sweep open");
});

test("the migration can never break a clock transition", () => {
  const sql = readFileSync("supabase/migrations/0075_work_cosmos_timebot_notifications.sql", "utf8");
  assert.match(sql, /after insert on work_session_events/, "enqueue covers every session-event writer");
  assert.match(sql, /event_type not in \('clock_in','pause','resume','clock_out'\)/, "system events stay out of the channel");
  assert.match(sql, /exception when others then[\s\S]*return new;/, "a queue failure must not abort the clock write");
  assert.match(sql, /unique \(session_event_id\)/, "a retry adopts the row instead of posting twice");
  assert.match(sql, /for update skip locked/, "two dispatchers cannot send the same row");
  assert.match(
    sql,
    /\(earlier\.observed_at, earlier\.enqueue_seq\) < \(o\.observed_at, o\.enqueue_seq\)/,
    "ordering follows event time, with insertion order breaking ties",
  );
  assert.match(sql, /order by o\.observed_at, o\.enqueue_seq/, "the same key is used for claiming");
  assert.match(sql, /generated always as identity/, "created_at and uuid order cannot sequence one transaction");
  assert.match(sql, /e\.recorded_at > now\(\)/, "work_session_events has no created_at column");
  assert.match(sql, /set_config\('lock_timeout'/, "a queue lock must not wait out the clock transaction");
  assert.doesNotMatch(sql, /interval '15 minutes'/, "age must not decide whether a transition exists");
  assert.doesNotMatch(sql, /'stale'/, "there is no stale dead-letter path");
  assert.match(
    sql,
    /revoke all on function public\.work_claim_notification_outbox\(integer\) from public/,
    "PostgreSQL grants EXECUTE to PUBLIC by default; the RPC must not be public",
  );
  assert.match(
    sql,
    /revoke all on function public\.work_enqueue_timebot_notification\(\) from public/,
    "the security-definer trigger function must not be callable by ordinary roles",
  );
});
