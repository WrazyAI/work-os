import { test } from "node:test";
import assert from "node:assert/strict";
import { observedSecondsForSession, timeSeriesFromSessions } from "../src/lib/work-os-admin-time-series";

const DATES = ["2026-09-28", "2026-09-29", "2026-09-30"];
const NOW = new Date("2026-09-30T18:00:00Z");

/** `shift_date` is a local-midnight Date on purpose: that is how pg returns a
 * DATE column, and the bucketing must go through the canonical dateOnly
 * helper instead of string slicing. */
function session(overrides: Record<string, unknown> = {}) {
  return {
    id: "s-1",
    person_id: "p-1",
    shift_date: new Date(2026, 8, 29),
    clocked_in_at: "2026-09-29T09:00:00.000Z",
    clocked_out_at: "2026-09-29T17:00:00.000Z",
    paused_seconds: 3600,
    ...overrides,
  };
}

test("observed session seconds subtract pauses, use now while open, and never go negative", () => {
  assert.equal(observedSecondsForSession(session(), NOW), 7 * 3600);
  assert.equal(observedSecondsForSession(session({ paused_seconds: 24 * 3600 }), NOW), 0);
  assert.equal(observedSecondsForSession(session({ clocked_out_at: null }), new Date("2026-09-29T12:00:00Z")), 2 * 3600);
  assert.equal(observedSecondsForSession({ clocked_in_at: null }, NOW), 0);
  assert.equal(observedSecondsForSession({ clocked_in_at: "not-a-date", clocked_out_at: null }, NOW), 0);
});

test("time series buckets whole minutes per day and person and keeps every window day", () => {
  const series = timeSeriesFromSessions(
    [
      session(),
      // A second session for the same person on the same day adds up.
      session({ id: "s-2", clocked_in_at: "2026-09-29T17:00:00.000Z", clocked_out_at: "2026-09-29T17:30:00.000Z", paused_seconds: 0 }),
      // Another teammate on the 28th.
      session({ id: "s-3", person_id: "p-2", shift_date: new Date(2026, 8, 28), clocked_in_at: "2026-09-28T10:00:00.000Z", clocked_out_at: "2026-09-28T14:00:00.000Z", paused_seconds: 0 }),
      // Outside the requested window: ignored.
      session({ id: "s-4", person_id: "p-2", shift_date: new Date(2026, 8, 20), clocked_in_at: "2026-09-20T10:00:00.000Z", clocked_out_at: "2026-09-20T14:00:00.000Z", paused_seconds: 0 }),
    ],
    DATES,
    NOW,
    (personId) => (personId === "p-1" ? "Ada" : personId === "p-2" ? "Luis" : null),
  );
  assert.deepEqual(series.map((point) => point.date), DATES);
  const [day28, day29, day30] = series;
  assert.deepEqual(day28, { date: "2026-09-28", totalMinutes: 240, people: [{ personId: "p-2", name: "Luis", minutes: 240 }] });
  assert.deepEqual(day29, { date: "2026-09-29", totalMinutes: 450, people: [{ personId: "p-1", name: "Ada", minutes: 450 }] });
  assert.deepEqual(day30, { date: "2026-09-30", totalMinutes: 0, people: [] });
});

test("days sort people strongest first and unlisted people fall back honestly", () => {
  const series = timeSeriesFromSessions(
    [
      session({ id: "s-1", person_id: "p-2", clocked_in_at: "2026-09-29T09:00:00.000Z", clocked_out_at: "2026-09-29T10:00:00.000Z", paused_seconds: 0 }),
      session({ id: "s-2", person_id: "p-1", clocked_in_at: "2026-09-29T09:00:00.000Z", clocked_out_at: "2026-09-29T11:00:00.000Z", paused_seconds: 0 }),
    ],
    DATES,
    NOW,
    (personId) => (personId === "p-1" ? "Ada" : null),
  );
  assert.deepEqual(series[1].people.map((person) => [person.name, person.minutes]), [["Ada", 120], ["Former teammate", 60]]);
  assert.equal(series[1].totalMinutes, 180);
});

test("string shift dates work and short sessions round to whole minutes", () => {
  const series = timeSeriesFromSessions(
    [session({ shift_date: "2026-09-29", clocked_in_at: "2026-09-29T09:00:00.000Z", clocked_out_at: "2026-09-29T09:01:30.000Z", paused_seconds: 0 })],
    DATES,
    NOW,
    () => "Ada",
  );
  assert.deepEqual(series[1].people, [{ personId: "p-1", name: "Ada", minutes: 2 }]);
  assert.equal(series[1].totalMinutes, 2);
});
