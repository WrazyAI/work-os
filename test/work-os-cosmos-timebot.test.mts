import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  COSMOS_TIMEBOT_EVENTS,
  MAX_ATTEMPTS,
  classifyTimebotDelivery,
  cosmosTimebotConfigured,
  formatTimebotTime,
  postTimebotMessage,
  renderTimebotMessage,
  timebotBackoffMs,
} from "../src/lib/work-os-cosmos-timebot.ts";

const observedAt = "2026-11-17T17:06:00.000Z";

test("renders the channel's own vocabulary: in, break, back, out", () => {
  const words = COSMOS_TIMEBOT_EVENTS.map((event) =>
    renderTimebotMessage({ displayName: "David Zawadi", eventType: event, observedAt, timezone: "Europe/London" }),
  );
  assert.deepEqual(words, ["17:06 David — in", "17:06 David — break", "17:06 David — back", "17:06 David — out"]);
});

test("uses the employee's timezone, not the server's", () => {
  const message = renderTimebotMessage({ displayName: "Aden", eventType: "clock_in", observedAt, timezone: "America/New_York" });
  assert.equal(message, "12:06 Aden — in");
});

test("falls back to UTC instead of throwing on a bad timezone", () => {
  assert.equal(formatTimebotTime(observedAt, "Mars/Olympus"), "17:06");
  assert.equal(formatTimebotTime(observedAt, null), "17:06");
});

test("an unparseable timestamp still produces a postable line", () => {
  assert.equal(formatTimebotTime("not-a-date", "UTC"), "--:--");
});

test("keeps only the first name so the channel stays scannable", () => {
  assert.equal(
    renderTimebotMessage({ displayName: "  Lisa   van der Berg ", eventType: "clock_out", observedAt, timezone: "UTC" }),
    "17:06 Lisa — out",
  );
});

test("refuses events the channel should never see", () => {
  for (const eventType of ["late_reason", "mark_active", "worktivity_reopened", "resolve_missed_clock_out", ""]) {
    assert.equal(renderTimebotMessage({ displayName: "David", eventType, observedAt, timezone: "UTC" }), null);
  }
  assert.equal(renderTimebotMessage({ displayName: "   ", eventType: "clock_in", observedAt, timezone: "UTC" }), null);
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
  assert.equal(timebotBackoffMs(MAX_ATTEMPTS), 6 * 60 * 60_000);
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

test("a network failure stays retryable and never leaks the webhook", async () => {
  const result = await postTimebotMessage("17:06 David — in", "https://cosmos.test/hook", (async () => {
    throw new Error("connect timeout https://cosmos.test/hook");
  }) as unknown as typeof fetch);
  assert.equal(result.status, null);
  assert.match(result.error ?? "", /connect timeout/);
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

test("the attendance sync flushes the queue without failing the sync", () => {
  const route = readFileSync("src/app/api/work-os/attendance/sync-due/route.ts", "utf8");
  assert.match(route, /flushTimebotOutbox/);
  assert.match(route, /try \{\s*\n\s*timebot = await flushTimebotOutbox/);
});

test("the migration can never break a clock transition", () => {
  const sql = readFileSync("supabase/migrations/0075_work_cosmos_timebot_notifications.sql", "utf8");
  assert.match(sql, /after insert on work_session_events/, "enqueue covers every session-event writer");
  assert.match(sql, /event_type not in \('clock_in','pause','resume','clock_out'\)/, "system events stay out of the channel");
  assert.match(sql, /interval '15 minutes'/, "provider recovery must not post a stale morning clock-in");
  assert.match(sql, /exception when others then[\s\S]*return new;/, "a queue failure must not abort the clock write");
  assert.match(sql, /unique \(session_event_id\)/, "a retry adopts the row instead of posting twice");
  assert.match(sql, /for update skip locked/, "two dispatchers cannot send the same row");
  assert.match(
    sql,
    /\(earlier\.created_at, earlier\.id\) < \(o\.created_at, o\.id\)/,
    "the predecessor check is a total order: now() ties inside one transaction",
  );
  assert.match(sql, /order by o\.created_at, o\.id/, "the total order is used for claiming too");
  assert.match(
    sql,
    /revoke all on function public\.work_claim_notification_outbox\(integer\) from public/,
    "PostgreSQL grants EXECUTE to PUBLIC by default; the RPC must not be public",
  );
});
