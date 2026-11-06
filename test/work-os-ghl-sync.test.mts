import assert from "node:assert/strict";
import test from "node:test";
import { actorSam, fixture, org, scope } from "./helpers/work-os-ghl-fixture.mts";
import { GhlRequestError } from "../src/lib/work-os-ghl-client";
import {
  advanceGhlCheckpoint,
  claimGhlPartition,
  getGhlStatus,
  ghlBackfillDates,
  ghlBackfillWindow,
  ghlLocalMidnight,
  ghlPartitionPlan,
  GhlCursorExpiredError,
  GhlRateLimitError,
  runGhlSync,
  syncDueGhlEvidence,
  type GhlSyncSource,
} from "../src/lib/work-os-ghl-sync";

const now = new Date("2026-11-06T12:00:00.000Z");

async function rows(db: { query: (sql: string) => Promise<{ rows: unknown[] }> }, sql: string) {
  return (await db.query(sql)).rows as Array<Record<string, any>>;
}

function fakeSource(input: {
  messages?: GhlSyncSource["messages"];
  calendars?: GhlSyncSource["calendars"];
  appointments?: GhlSyncSource["appointments"];
  contacts?: GhlSyncSource["contacts"];
  opportunities?: GhlSyncSource["opportunities"];
} = {}): GhlSyncSource {
  return {
    messages: input.messages ?? (async () => ({ items: [], nextCursor: null, capped: false })),
    calendars: input.calendars ?? (async () => ["cal-1"]),
    appointments: input.appointments ?? (async () => ({ items: [], nextCursor: null, capped: false })),
    contacts: input.contacts ?? (async () => ({ items: [], nextCursor: null, capped: false })),
    notes: async () => [],
    tasks: async () => [],
    opportunities: input.opportunities ?? (async () => ({ items: [], nextCursor: null, capped: false })),
  };
}

function localHour(iso: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

test("the backfill covers thirty local dates across DST at local midnight", () => {
  assert.deepEqual(ghlBackfillDates(now).slice(0, 1), ["2026-10-08"]);
  assert.equal(ghlBackfillDates(now).length, 30);
  assert.equal(ghlBackfillDates(new Date("2026-04-10T12:00:00.000Z"))[0], "2026-03-12");
  assert.equal(localHour(ghlLocalMidnight("2026-03-12")), "00:00");
  assert.equal(localHour(ghlLocalMidnight("2026-11-06")), "00:00");
  assert.equal(ghlBackfillWindow(now).dates.length, 30);
});

test("the partition plan keeps email separate and overlaps the last 24 hours", () => {
  const plan = ghlPartitionPlan(now);
  assert.ok(plan.some((item) => item.key === "backfill:Email" && item.channel === "Email"));
  assert.ok(plan.some((item) => item.key === "backfill:Call" && item.channel === "Call"));
  const recent = plan.find((item) => item.key === "recent:Call")!;
  assert.equal(recent.from, new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());
  const reconcile = plan.find((item) => item.key === "reconcile:Call")!;
  assert.equal(new Date(reconcile.through).getTime() - new Date(reconcile.from).getTime(), 29 * 24 * 60 * 60 * 1000 + 8 * 60 * 60 * 1000);
});

test("appointment discovery is partial and still persists snapshots", async () => {
  const f = await fixture();
  try {
    const source = fakeSource({
      appointments: async () => ({
        items: [{
          id: "appt-future",
          calendarId: "cal-1",
          assignedUserId: actorSam,
          startTime: "2027-03-15T14:00:00.000Z",
          dateAdded: "2026-11-03T22:00:00.000Z",
          status: "confirmed",
        }],
        nextCursor: null,
        capped: false,
      }),
    });
    const result = await runGhlSync({ scope, now, maxPages: 50, deadlineMs: 40_000, source });
    assert.equal(result.coverage.find((item) => item.kind === "appointment")?.state, "partial");
    assert.equal((await rows(f.db, "select count(*)::int as n from work_evidence_events where event_type = 'appointment.snapshot'"))[0].n, 1);
    assert.equal(result.pending, false);
  } finally {
    await f.close();
  }
});

test("an expired cursor restarts from the durable checkpoint without skipping the partition", async () => {
  const f = await fixture();
  try {
    let expired = false;
    const source = fakeSource({
      messages: async ({ channel }) => {
        if (channel === "Email" && !expired) {
          expired = true;
          throw new GhlCursorExpiredError();
        }
        return { items: [], nextCursor: null, capped: false };
      },
    });
    await runGhlSync({ scope, now, maxPages: 50, deadlineMs: 40_000, source });
    const state = (await rows(f.db, "select state, cursor_value from work_ghl_sync_state where partition_key = 'backfill:Email'"))[0] as any;
    assert.equal(state.state, "pending");
    assert.equal(state.cursor_value, null);
    await runGhlSync({ scope, now, maxPages: 50, deadlineMs: 40_000, source });
    assert.equal((await rows(f.db, "select state from work_ghl_sync_state where partition_key = 'backfill:Email'"))[0].state, "complete");
  } finally {
    await f.close();
  }
});

test("a persistence failure leaves the checkpoint unadvanced", async () => {
  const f = await fixture();
  try {
    await runGhlSync({
      scope,
      now,
      maxPages: 1,
      deadlineMs: 40_000,
      source: fakeSource(),
      persist: async () => { throw new Error("synthetic persist failure"); },
    });
    const state = (await rows(f.db, "select state, cursor_value from work_ghl_sync_state where partition_key = 'backfill:Call'"))[0] as any;
    assert.equal(state.state, "failed");
    assert.equal(state.cursor_value, null);
    assert.equal((await rows(f.db, "select count(*)::int as n from work_evidence_events"))[0].n, 0);
  } finally {
    await f.close();
  }
});

test("a stolen lease cannot advance the previous worker's checkpoint", async () => {
  const f = await fixture();
  try {
    await runGhlSync({ scope, now, maxPages: 1, deadlineMs: 40_000, source: fakeSource() });
    const state = (await rows(f.db, "select id from work_ghl_sync_state where partition_key = 'backfill:Call'"))[0] as any;
    assert.equal(await claimGhlPartition({ stateId: state.id, leaseOwner: "worker-a", now }), true);
    await f.db.query("update work_ghl_sync_state set lease_owner = 'worker-b' where id = $1", [state.id]);
    assert.equal(await advanceGhlCheckpoint({
      stateId: state.id,
      leaseOwner: "worker-a",
      now,
      scanned: 1,
      nextCursor: null,
      state: "complete",
      coverage: { kind: "call", state: "complete", from: now.toISOString(), through: now.toISOString(), reason: null, scanned: 1, capped: false },
    }), false);
  } finally {
    await f.close();
  }
});

test("rate limits and authorization failures are separate bounded states", async () => {
  const f = await fixture();
  try {
    await runGhlSync({
      scope, now, maxPages: 1, deadlineMs: 40_000,
      source: fakeSource({ messages: async () => { throw new GhlRateLimitError(30); } }),
    });
    const limited = (await rows(f.db, "select state, failure_reason from work_ghl_sync_state where partition_key = 'backfill:Call'"))[0] as any;
    assert.equal(limited.state, "pending");
    assert.match(limited.failure_reason, /rate/i);
    await f.db.query("delete from work_ghl_sync_state");
    await runGhlSync({
      scope, now, maxPages: 1, deadlineMs: 40_000,
      source: fakeSource({ messages: async () => { throw new GhlRequestError("GHL read failed (401)", 401); } }),
    });
    const denied = (await rows(f.db, "select state, coverage, failure_reason from work_ghl_sync_state where partition_key = 'backfill:Call'"))[0] as any;
    assert.equal(denied.state, "failed");
    assert.equal(denied.coverage.state, "unavailable");
    assert.match(denied.failure_reason, /401\/403/);
  } finally {
    await f.close();
  }
});

test("disconnected or disabled locations are skipped by the due job", async () => {
  const f = await fixture();
  try {
    await f.db.query("update work_organizations set feature_flags = '{\"ghl_evidence\":false}'::jsonb where id = $1", [org]);
    assert.deepEqual(await syncDueGhlEvidence({ now, limit: 5, sourceForScope: () => fakeSource() }), { processed: 0, pending: 0, failed: 0 });
    await f.db.query("update work_organizations set feature_flags = '{\"ghl_evidence\":true}'::jsonb where id = $1", [org]);
    await f.db.query("update work_provider_connections set active = false where external_workspace_id = $1", [scope.locationId]);
    assert.deepEqual(await syncDueGhlEvidence({ now, limit: 5, sourceForScope: () => fakeSource() }), { processed: 0, pending: 0, failed: 0 });
  } finally {
    await f.close();
  }
});

test("the legacy GHL webhook stays closed for a polling connection", async () => {
  const { POST } = await import("../src/app/api/work-os/integrations/ghl/webhook/route");
  const response = await POST(new Request("http://localhost/api/work-os/integrations/ghl/webhook", { method: "POST", body: "{}" }));
  assert.equal(response.status, 503);
});

test("the due job runs on the five-minute cadence and reports a secret-free status", async () => {
  const f = await fixture();
  try {
    const first = await syncDueGhlEvidence({ now, limit: 5, sourceForScope: () => fakeSource() });
    assert.equal(first.processed, 1);
    const fourMinutes = new Date(now.getTime() + 4 * 60 * 1000);
    assert.equal((await syncDueGhlEvidence({ now: fourMinutes, limit: 5, sourceForScope: () => fakeSource() })).processed, 0);
    const sixMinutes = new Date(now.getTime() + 6 * 60 * 1000);
    assert.equal((await syncDueGhlEvidence({ now: sixMinutes, limit: 5, sourceForScope: () => fakeSource() })).processed, 1);
    const status = await getGhlStatus(scope);
    assert.equal(status.mode, "pit_polling");
    assert.equal(status.state, "ready");
    assert.ok(status.lastSyncedAt);
    assert.equal(JSON.stringify(status).includes("pit-secret"), false);
  } finally {
    await f.close();
  }
});
