import assert from "node:assert/strict";
import test from "node:test";
import { eodActivityWindowFromSessionRow, resolveEodActivityWindow, withinEodActivityWindow } from "../src/lib/work-os-eod-window";

test("the EOD activity window follows the scheduled shift when the day has one", () => {
  // The pilot's mistake day: the session started overnight, but the workday is
  // the scheduled shift, so the overnight and pre-shift frames stay out.
  const window = resolveEodActivityWindow({
    scheduledStartsAt: "2026-10-14T14:00:00.000Z",
    scheduledEndsAt: "2026-10-14T21:00:00.000Z",
    clockedInAt: "2026-10-14T00:46:29.086Z",
    clockedOutAt: "2026-10-14T14:10:50.525Z",
    now: "2026-10-14T20:00:00.000Z",
  });
  assert.deepEqual(window, { startIso: "2026-10-14T14:00:00.000Z", endIso: "2026-10-14T21:00:00.000Z", source: "schedule" });
});

test("without a schedule the EOD activity window follows the session interval", () => {
  assert.deepEqual(resolveEodActivityWindow({
    clockedInAt: "2026-10-14T09:00:00.000Z",
    clockedOutAt: "2026-10-14T17:30:00.000Z",
  }), { startIso: "2026-10-14T09:00:00.000Z", endIso: "2026-10-14T17:30:00.000Z", source: "session" });
  // An open session runs to now.
  assert.deepEqual(resolveEodActivityWindow({
    clockedInAt: "2026-10-14T09:00:00.000Z",
    now: "2026-10-14T15:00:00.000Z",
  }), { startIso: "2026-10-14T09:00:00.000Z", endIso: "2026-10-14T15:00:00.000Z", source: "session" });
});

test("the EOD activity window reads the session row's stored columns", () => {
  // The admin client returns timestamptz columns as Date objects under their
  // snake_case column names; the resolver must map them, never read camelCase
  // keys off the raw row.
  const window = eodActivityWindowFromSessionRow({
    scheduled_starts_at: new Date("2026-10-14T14:00:00.000Z"),
    scheduled_ends_at: new Date("2026-10-14T21:00:00.000Z"),
    clocked_in_at: new Date("2026-10-14T00:46:29.086Z"),
    clocked_out_at: null,
  });
  assert.deepEqual(window, { startIso: "2026-10-14T14:00:00.000Z", endIso: "2026-10-14T21:00:00.000Z", source: "schedule" });
  // ISO strings are accepted the same way.
  assert.deepEqual(eodActivityWindowFromSessionRow({
    scheduled_starts_at: "2026-10-14T14:00:00.000Z",
    scheduled_ends_at: "2026-10-14T21:00:00.000Z",
  }), { startIso: "2026-10-14T14:00:00.000Z", endIso: "2026-10-14T21:00:00.000Z", source: "schedule" });
});

test("day facts outside the workday window are excluded from the report", () => {
  const window = { startIso: "2026-10-14T14:00:00.000Z", endIso: "2026-10-14T21:00:00.000Z", source: "schedule" as const };
  // In-window facts stay; the overnight and post-shift ones drop.
  assert.equal(withinEodActivityWindow("2026-10-14T15:53:00.000Z", window), true);
  assert.equal(withinEodActivityWindow(new Date("2026-10-14T14:00:00.000Z"), window), true);
  assert.equal(withinEodActivityWindow("2026-10-14T21:00:00.000Z", window), true);
  assert.equal(withinEodActivityWindow("2026-10-14T01:17:00.000Z", window), false);
  assert.equal(withinEodActivityWindow("2026-10-14T21:41:00.000Z", window), false);
  // No window or no usable timestamp keeps the fact: the report never drops
  // what it cannot prove is outside the workday.
  assert.equal(withinEodActivityWindow("2026-10-14T01:17:00.000Z", null), true);
  assert.equal(withinEodActivityWindow(null, window), true);
  assert.equal(withinEodActivityWindow("invalid", window), true);
});

test("the EOD activity window is unavailable when the day has no usable schedule or session", () => {
  assert.equal(resolveEodActivityWindow({}), null);
  assert.equal(resolveEodActivityWindow({ scheduledStartsAt: "invalid", scheduledEndsAt: "2026-10-14T21:00:00.000Z" }), null);
  assert.equal(resolveEodActivityWindow({ scheduledStartsAt: "2026-10-14T21:00:00.000Z", scheduledEndsAt: "2026-10-14T14:00:00.000Z" }), null);
  // An unusable schedule falls back to a usable session.
  assert.deepEqual(resolveEodActivityWindow({
    scheduledStartsAt: "invalid",
    clockedInAt: "2026-10-14T09:00:00.000Z",
    now: "2026-10-14T15:00:00.000Z",
  }), { startIso: "2026-10-14T09:00:00.000Z", endIso: "2026-10-14T15:00:00.000Z", source: "session" });
});
