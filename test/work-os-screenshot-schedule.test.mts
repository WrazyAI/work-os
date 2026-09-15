import assert from "node:assert/strict";
import { test } from "node:test";
import { screenshotRunMode } from "../src/lib/work-os-screenshots";

const base = {
  timezone: "UTC",
  shiftStart: "09:00",
  shiftEnd: "17:00",
  intervalMinutes: 60,
  eodLeadMinutes: 30,
};

test("hourly runs are due at the interval and inside the shift window", () => {
  assert.equal(screenshotRunMode({ ...base, now: new Date("2026-09-15T10:30:00Z") }), "hourly");
  assert.equal(screenshotRunMode({ ...base, now: new Date("2026-09-15T10:30:00Z"), lastHourlyAt: "2026-09-15T10:00:00Z" }), null);
  assert.equal(screenshotRunMode({ ...base, now: new Date("2026-09-15T11:05:00Z"), lastHourlyAt: "2026-09-15T10:00:00Z" }), "hourly");
});

test("nothing runs before the window starts", () => {
  assert.equal(screenshotRunMode({ ...base, now: new Date("2026-09-15T08:30:00Z") }), null);
  assert.equal(screenshotRunMode({ ...base, now: new Date("2026-09-15T09:30:00Z"), windowStart: "10:00" }), null);
});

test("the end-of-day pass fires at shift end minus the lead", () => {
  assert.equal(screenshotRunMode({ ...base, now: new Date("2026-09-15T16:25:00Z") }), "hourly");
  assert.equal(screenshotRunMode({ ...base, now: new Date("2026-09-15T16:35:00Z") }), "eod");
  assert.equal(screenshotRunMode({ ...base, now: new Date("2026-09-15T18:00:00Z") }), "eod");
  assert.equal(screenshotRunMode({ ...base, eodLeadMinutes: 0, now: new Date("2026-09-15T17:00:00Z") }), "eod");
});

test("a completed end-of-day pass settles the day", () => {
  assert.equal(screenshotRunMode({ ...base, now: new Date("2026-09-15T16:40:00Z"), eodCompleted: true }), null);
  assert.equal(screenshotRunMode({ ...base, now: new Date("2026-09-15T18:00:00Z"), eodCompleted: true }), null);
});

test("an early clock-out triggers the end-of-day pass after a short grace", () => {
  const early = { ...base, now: new Date("2026-09-15T13:05:00Z"), clockedOutAt: "2026-09-15T13:00:00Z" };
  assert.equal(screenshotRunMode(early), "eod");
  assert.equal(screenshotRunMode({ ...early, now: new Date("2026-09-15T13:01:00Z") }), "hourly");
});

test("an explicit window end narrows the hourly runs", () => {
  assert.equal(screenshotRunMode({ ...base, windowEnd: "12:00", now: new Date("2026-09-15T12:30:00Z") }), null);
  assert.equal(screenshotRunMode({ ...base, windowEnd: "12:00", now: new Date("2026-09-15T11:30:00Z") }), "hourly");
});
