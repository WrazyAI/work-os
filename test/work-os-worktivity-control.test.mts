import assert from "node:assert/strict";
import test from "node:test";
import { decideWorktivityAction, worktivityClockInChanged, worktivityClockInContext, worktivityClockOutBoundary, worktivityInstant, worktivityIntervalReopenCandidate, worktivityIsoInstant, worktivityProjectionClockOutBoundary, worktivityRestarted, worktivityConfirmationRequirement } from "../src/modules/work-os/worktivity-control";

test("Worktivity provider state is the action gate and idempotency authority", () => {
  assert.deepEqual(decideWorktivityAction("clock_in", "off_shift"), { status: "ready" });
  assert.deepEqual(decideWorktivityAction("clock_in", "active"), { status: "already_target" });
  assert.deepEqual(decideWorktivityAction("pause", "paused"), { status: "already_target" });
  assert.deepEqual(decideWorktivityAction("resume", "active"), { status: "already_target" });
  assert.deepEqual(decideWorktivityAction("clock_out", "off_shift"), { status: "already_target" });
  assert.equal(decideWorktivityAction("clock_in", "paused").status, "blocked");
  assert.equal(decideWorktivityAction("pause", "unknown").status, "blocked");
});

test("Worktivity clock-out reconciliation preserves exact provider time", () => {
  assert.deepEqual(worktivityClockOutBoundary({
    clockedInAt: "2026-09-23T09:00:00.000Z",
    clockedOutAt: "2026-09-23T17:00:00.000Z",
    observedAt: "2026-09-23T17:02:00.000Z",
  }), { at: "2026-09-23T17:00:00.000Z", inferred: false });
});

test("Worktivity off-shift without a provider timestamp uses a marked fresh boundary", () => {
  assert.deepEqual(worktivityClockOutBoundary({
    clockedInAt: "2026-09-23T09:00:00.000Z",
    clockedOutAt: null,
    observedAt: "2026-09-23T17:03:00.000Z",
  }), { at: "2026-09-23T17:03:00.000Z", inferred: true });
  assert.equal(worktivityClockOutBoundary({ clockedInAt: "invalid", clockedOutAt: null, observedAt: "2026-09-23T17:03:00Z" }), null);
});

test("clock-in reconciliation compares instants and ignores invalid provider timestamps", () => {
  assert.equal(worktivityClockInChanged("2026-09-23T09:00:00.000Z", "2026-09-23T11:00:00+02:00"), false);
  assert.equal(worktivityClockInChanged("2026-09-23T09:00:00.000Z", "2026-09-23T09:01:00Z"), true);
  assert.equal(worktivityClockInChanged("2026-09-23T09:00:00.000Z", "invalid"), false);
  // The data client returns timestamptz columns as Dates; an unchanged start
  // must not read as a new provider clock-in.
  assert.equal(worktivityClockInChanged(new Date("2026-09-23T09:00:00.000Z"), "2026-09-23T11:00:00+02:00"), false);
  assert.equal(worktivityClockInChanged(new Date("2026-09-23T09:00:00.000Z"), "2026-09-23T09:01:00Z"), true);
  assert.equal(worktivityClockInChanged(new Date("invalid"), "2026-09-23T09:01:00Z"), true);
  assert.equal(worktivityClockInChanged(null, "2026-09-23T09:01:00Z"), true);
});

test("stored instants normalize across ISO strings and Date values", () => {
  assert.equal(worktivityInstant("2026-09-23T11:00:00+02:00"), Date.parse("2026-09-23T09:00:00.000Z"));
  assert.equal(worktivityInstant(new Date("2026-09-23T09:00:00.000Z")), Date.parse("2026-09-23T09:00:00.000Z"));
  assert.equal(Number.isNaN(worktivityInstant("invalid")), true);
  assert.equal(Number.isNaN(worktivityInstant(null)), true);
  assert.equal(worktivityIsoInstant(new Date("2026-09-23T09:00:00.000Z")), "2026-09-23T09:00:00.000Z");
  assert.equal(worktivityIsoInstant("2026-09-23T11:00:00+02:00"), "2026-09-23T09:00:00.000Z");
  assert.equal(worktivityIsoInstant("invalid"), null);
});

test("only a later provider start is a fresh work interval", () => {
  assert.equal(worktivityRestarted("2026-09-23T09:00:00.000Z", "2026-09-23T13:00:00.000Z"), true);
  assert.equal(worktivityRestarted("2026-09-23T09:00:00.000Z", "2026-09-23T09:00:00.000Z"), false);
  // A provider correction that backfills an earlier start must not re-stamp.
  assert.equal(worktivityRestarted("2026-09-23T09:00:00.000Z", "2026-09-23T08:45:00.000Z"), false);
  assert.equal(worktivityRestarted(null, "2026-09-23T09:00:00.000Z"), true);
  assert.equal(worktivityRestarted("2026-09-23T09:00:00.000Z", "invalid"), false);
});

test("a closed interval reopens only while the provider still reports it open", () => {
  // An inferred off-shift observation closed the row, but the provider never
  // ended that interval: the sync may reopen it instead of replaying the
  // idempotent clock-in.
  assert.equal(worktivityIntervalReopenCandidate({ state: "clocked_out", correction_status: "valid" }), true);
  assert.equal(worktivityIntervalReopenCandidate({ state: "clocked_out", correction_status: null }), true);
  // An open session needs no reopen, and a correction keeps its closed row.
  assert.equal(worktivityIntervalReopenCandidate({ state: "active", correction_status: "valid" }), false);
  assert.equal(worktivityIntervalReopenCandidate({ state: "clocked_out", correction_status: "needs_correction" }), false);
  assert.equal(worktivityIntervalReopenCandidate(null), false);
});

test("provider reconciliation keeps only explicit clock-in acknowledgements and reasons", () => {
  assert.deepEqual(worktivityClockInContext({
    late_acknowledged: false,
    late_reason: " ",
    exception_acknowledged: true,
    exception_reason: "  Support call  ",
  }), { exception_acknowledged: true, exception_reason: "Support call" });
  assert.deepEqual(worktivityClockInContext({ late_reason: "not acknowledged", exception_reason: "" }), {});
});

test("a previously inferred provider clock-out stays marked inferred", () => {
  assert.deepEqual(worktivityProjectionClockOutBoundary({
    clockedInAt: "2026-09-23T09:00:00.000Z",
    clockedOutAt: "2026-09-23T17:00:00.000Z",
    clockedOutAtInferred: true,
    observedAt: "2026-09-23T17:03:00.000Z",
  }), { at: "2026-09-23T17:03:00.000Z", inferred: true });
  assert.deepEqual(worktivityProjectionClockOutBoundary({
    clockedInAt: "2026-09-23T09:00:00.000Z",
    clockedOutAt: "2026-09-23T17:00:00.000Z",
    clockedOutAtInferred: false,
    observedAt: "2026-09-23T17:03:00.000Z",
  }), { at: "2026-09-23T17:00:00.000Z", inferred: false });
});

test("clock-in and clock-out keep server-side late, exception, and extended-shift confirmations", () => {
  const start = "2026-09-23T09:00:00.000Z";
  const end = "2026-09-23T17:00:00.000Z";
  assert.equal(worktivityConfirmationRequirement({ action: "clock_in", now: "2026-09-23T09:20:00.000Z", scheduledStartsAt: start, scheduledEndsAt: end, body: {} }), "late");
  assert.equal(worktivityConfirmationRequirement({ action: "clock_in", now: "2026-09-23T09:20:00.000Z", scheduledStartsAt: start, scheduledEndsAt: end, body: { late_acknowledged: true } }), null);
  assert.equal(worktivityConfirmationRequirement({ action: "clock_in", now: "2026-09-23T09:00:00.000Z", body: {} }), "exception");
  assert.equal(worktivityConfirmationRequirement({ action: "clock_in", now: "2026-09-23T09:00:00.000Z", body: { exception_acknowledged: true, exception_reason: "Support call" } }), null);
  assert.equal(worktivityConfirmationRequirement({ action: "clock_out", now: "2026-09-23T17:20:00.000Z", scheduledEndsAt: end, body: {} }), "extended");
});
