import assert from "node:assert/strict";
import test from "node:test";
import { resolveEodActivityWindow } from "../src/lib/work-os-eod-window";

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
