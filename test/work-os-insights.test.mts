import assert from "node:assert/strict";
import test from "node:test";
import { deterministicInsightBrief, effectiveBreakObservation, insightDateWindow } from "../src/lib/work-os-insights";

test("personal insight ranges are inclusive and deterministic", () => {
  assert.deepEqual(insightDateWindow("day", "2026-08-20"), { from: "2026-08-20", through: "2026-08-20", count: 1 });
  assert.deepEqual(insightDateWindow("7d", "2026-08-20"), { from: "2026-08-14", through: "2026-08-20", count: 7 });
  assert.deepEqual(insightDateWindow("30d", "2026-08-20"), { from: "2026-07-22", through: "2026-08-20", count: 30 });
});

test("deterministic insight brief keeps activity separate from outcomes", () => {
  const brief = deterministicInsightBrief([{ tasksCompleted: 0, plannedCompleted: 0, carryOver: 1, outputEvidence: 0, planned: 2 }], [{ id: "plan-1" }]);
  assert.match(brief.summary, /record is still forming/i);
  assert.match(brief.attention.join(" "), /activity context alone does not prove an outcome/i);
  assert.doesNotMatch(JSON.stringify(brief), /productivity score/i);
  assert.deepEqual(brief.referenceIds, ["plan-1"]);
});

test("authoritative insights use provider breaks and expose stale or unknown provenance", () => {
  const now = new Date("2026-08-21T12:00:00Z");
  assert.deepEqual(effectiveBreakObservation({ paused_seconds: 99, provider_break_seconds: 600, provider_break_observed_at: "2026-08-21T11:58:00Z" }, now, true), { seconds: 600, freshness: "observed" });
  assert.deepEqual(effectiveBreakObservation({ paused_seconds: 99, provider_break_seconds: 600, provider_break_observed_at: "2026-08-21T11:00:00Z" }, now, true), { seconds: 600, freshness: "stale" });
  assert.deepEqual(effectiveBreakObservation({ paused_seconds: 99 }, now, true), { seconds: 0, freshness: "unknown" });
  assert.deepEqual(effectiveBreakObservation({ paused_seconds: 99 }, now, false), { seconds: 99, freshness: "manual" });
});
