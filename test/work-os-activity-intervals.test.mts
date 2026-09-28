import assert from "node:assert/strict";
import test from "node:test";
import {
  activityIntervalConfig,
  activityIntervalSlotKey,
  formatIntervalRange,
  intervalHourStarts,
  intervalProvenanceLabel,
  intervalSourceHash,
  parseIntervalSynthesis,
  resolveActivityIntervalWindow,
  selectIntervalEvidence,
  type IntervalEvidenceEntry,
} from "../src/lib/work-os-activity-intervals";
import type { ScreenshotWindowCandidate } from "../src/lib/work-os-screenshots";

const candidate = (id: string, capturedAt: string, app: string | null, retained = true, confidence = 0.8): ScreenshotWindowCandidate => ({
  summaryId: `summary-${id}`,
  evidenceEventId: `event-${id}`,
  externalId: `screenshot:${id}`,
  capturedAt,
  summary: `Observation for ${id}.`,
  visibleApp: app,
  workContext: null,
  possibleTaskReference: null,
  confidence,
  retained,
});

test("a prompt slot has one deterministic identity", () => {
  const key = activityIntervalSlotKey("session-1", "2026-09-28T15:19:29.446Z");
  assert.equal(key, "session-1:2026-09-28T15:19:29.446Z");
  assert.equal(activityIntervalSlotKey("session-1", "2026-09-28T15:19:29.446Z"), key);
  assert.notEqual(activityIntervalSlotKey("session-2", "2026-09-28T15:19:29.446Z"), key);
  assert.notEqual(activityIntervalSlotKey("session-1", "2026-09-28T16:19:29.446Z"), key);
});

test("interval window starts at the latest boundary and is capped", () => {
  const input = {
    promptDueAt: "2026-09-28T16:00:00.000Z",
    clockedInAt: "2026-09-28T13:00:00.000Z",
    lastSubstantiveUpdateAt: "2026-09-28T15:05:00.000Z",
    planConfirmedAt: "2026-09-28T13:30:00.000Z",
    previousWindowEnd: "2026-09-28T15:00:00.000Z",
    dayStartIso: "2026-09-28T04:00:00.000Z",
    maxMinutes: 120,
  };
  assert.deepEqual(resolveActivityIntervalWindow(input), {
    startIso: "2026-09-28T15:05:00.000Z",
    endIso: "2026-09-28T16:00:00.000Z",
  });
  // The previous recap never overlaps even when it is the latest boundary.
  assert.deepEqual(resolveActivityIntervalWindow({ ...input, lastSubstantiveUpdateAt: "2026-09-28T14:00:00.000Z" }), {
    startIso: "2026-09-28T15:00:00.000Z",
    endIso: "2026-09-28T16:00:00.000Z",
  });
  // A long gap is capped at the configured maximum.
  assert.deepEqual(resolveActivityIntervalWindow({ ...input, lastSubstantiveUpdateAt: null, previousWindowEnd: null, planConfirmedAt: null, clockedInAt: null }), {
    startIso: "2026-09-28T14:00:00.000Z",
    endIso: "2026-09-28T16:00:00.000Z",
  });
  // The window never starts before the local workday.
  assert.deepEqual(resolveActivityIntervalWindow({ ...input, previousWindowEnd: null, dayStartIso: "2026-09-28T15:30:00.000Z" }), {
    startIso: "2026-09-28T15:30:00.000Z",
    endIso: "2026-09-28T16:00:00.000Z",
  });
  // A substantive update at the due instant leaves nothing worth reviewing.
  assert.equal(resolveActivityIntervalWindow({ ...input, lastSubstantiveUpdateAt: "2026-09-28T16:00:00.000Z" }), null);
  assert.equal(resolveActivityIntervalWindow({ ...input, promptDueAt: "not-a-date" }), null);
});

test("evidence sampling keeps edges, app transitions, and exact selected ids", () => {
  const candidates = Array.from({ length: 20 }, (_, index) => candidate(
    `frame-${index}`,
    new Date(Date.parse("2026-09-28T15:00:00.000Z") + index * 60_000).toISOString(),
    index < 8 ? "VS Code" : index < 14 ? "Windows Terminal" : "Google Chrome",
    index % 4 !== 3,
  ));
  const { selected, rawCount } = selectIntervalEvidence(candidates, { maxFrames: 8, maxRawFrames: 3 });
  assert.equal(selected.length, 8);
  assert.equal(selected[0].candidate.externalId, "screenshot:frame-0");
  assert.equal(selected[selected.length - 1].candidate.externalId, "screenshot:frame-19");
  assert.ok(selected.some((entry) => entry.selectionReason.startsWith("app_transition")), "an app transition is preserved");
  assert.equal(rawCount, 3);
  assert.ok(selected.filter((entry) => entry.rawImageShown).every((entry) => entry.candidate.retained));
  const again = selectIntervalEvidence(candidates, { maxFrames: 8, maxRawFrames: 3 });
  assert.deepEqual(again.selected.map((entry) => entry.candidate.externalId), selected.map((entry) => entry.candidate.externalId));
  assert.equal(selected.filter((entry) => entry.rawImageShown).length <= 3, true);
});

test("evidence sampling handles small and empty candidate sets", () => {
  assert.deepEqual(selectIntervalEvidence([], { maxFrames: 12, maxRawFrames: 5 }), { selected: [], rawCount: 0 });
  const one = selectIntervalEvidence([candidate("only", "2026-09-28T15:00:00.000Z", "VS Code")], { maxFrames: 12, maxRawFrames: 5 });
  assert.equal(one.selected.length, 1);
  assert.equal(one.selected[0].rawImageShown, true);
});

test("the source hash changes only when the selected evidence or prompt changes", () => {
  const first = selectIntervalEvidence([
    candidate("a", "2026-09-28T15:00:00.000Z", "VS Code"),
    candidate("b", "2026-09-28T15:30:00.000Z", "Google Chrome"),
  ], { maxFrames: 12, maxRawFrames: 5 });
  const second = selectIntervalEvidence([
    candidate("a", "2026-09-28T15:00:00.000Z", "VS Code"),
    candidate("c", "2026-09-28T15:30:00.000Z", "Google Chrome"),
  ], { maxFrames: 12, maxRawFrames: 5 });
  assert.equal(intervalSourceHash(first.selected, "model", "v1"), intervalSourceHash(first.selected, "model", "v1"));
  assert.notEqual(intervalSourceHash(first.selected, "model", "v1"), intervalSourceHash(second.selected, "model", "v1"));
  assert.notEqual(intervalSourceHash(first.selected, "model", "v1"), intervalSourceHash(first.selected, "model", "v2"));
});

test("synthesis parsing clamps indexes and rejects fabricated prose", () => {
  const parsed = parseIntervalSynthesis({
    headline: "Implementation and verification in the Work OS codebase",
    detail: "Worked across the editor and terminal, then checked the companion UI.",
    activities: [{ description: "Edited the tasks surface", evidence_indexes: [1, 2, 99, 0], possible_task_reference: "Tasks", confidence: 1.4 }],
    workflow: [{ phase: "implementation", evidence_indexes: [1] }],
    uncertainties: ["The screenshots do not establish whether the change was pushed."],
    apps: ["VS Code", "Terminal"],
    coverage: { first_observed_at: "2026-09-28T15:00:00.000Z", last_observed_at: "2026-09-28T15:59:00.000Z", analyzed_frames: 9, raw_frames_shown_to_model: 3 },
  }, 9);
  assert.deepEqual(parsed.activities[0].evidenceIndexes, [1, 2]);
  assert.equal(parsed.activities[0].confidence, 1);
  assert.equal(parsed.coverage.analyzedFrames, 9);
  assert.throws(() => parseIntervalSynthesis({ headline: "", detail: "" }, 3), /headline or detail/);
});

test("interval ranges read in plain 12-hour language", () => {
  assert.equal(formatIntervalRange("2026-09-28T14:17:00.000Z", "2026-09-28T15:17:00.000Z", "UTC"), "2:17–3:17 PM");
  assert.equal(formatIntervalRange("2026-09-28T11:30:00.000Z", "2026-09-28T12:30:00.000Z", "UTC"), "11:30 AM–12:30 PM");
  assert.equal(formatIntervalRange("2026-09-28T14:00:00.000Z", "2026-09-28T15:00:00.000Z", "UTC"), "2–3 PM");
  assert.equal(formatIntervalRange("not-a-date", "2026-09-28T15:00:00.000Z", "UTC"), "—");
});

test("interval hour coverage drives EOD deduplication", () => {
  assert.deepEqual(intervalHourStarts("2026-09-28T14:17:00.000Z", "2026-09-28T15:17:00.000Z", "UTC"), [14, 15]);
  assert.deepEqual(intervalHourStarts("2026-09-28T14:00:00.000Z", "2026-09-28T15:00:00.000Z", "UTC"), [14]);
  assert.deepEqual(intervalHourStarts("2026-09-28T23:30:00.000Z", "2026-09-29T00:30:00.000Z", "UTC"), [23, 0]);
  assert.deepEqual(intervalHourStarts("not-a-date", "2026-09-28T15:00:00.000Z", "UTC"), []);
});

test("provenance labels never present inference as employee-confirmed fact", () => {
  assert.equal(intervalProvenanceLabel("inferred"), "AI-inferred, not reviewed");
  assert.equal(intervalProvenanceLabel("confirmed"), "employee confirmed");
  assert.equal(intervalProvenanceLabel("amended"), "employee amended");
});

test("interval configuration is bounded and can be disabled", () => {
  const defaults = activityIntervalConfig({} as NodeJS.ProcessEnv);
  assert.equal(defaults.enabled, true);
  assert.equal(defaults.maxMinutes, 120);
  assert.equal(defaults.maxFrames, 12);
  assert.equal(defaults.maxRawFrames, 5);
  assert.equal(defaults.maxPerDay, 10);
  const disabled = activityIntervalConfig({ WORK_OS_ACTIVITY_INTERVALS_ENABLED: "0" } as NodeJS.ProcessEnv);
  assert.equal(disabled.enabled, false);
  const bounded = activityIntervalConfig({
    WORK_OS_ACTIVITY_INTERVAL_MAX_MINUTES: "9999",
    WORK_OS_ACTIVITY_INTERVAL_MAX_FRAMES: "-4",
    WORK_OS_ACTIVITY_INTERVAL_MAX_RAW_FRAMES: "40",
    WORK_OS_ACTIVITY_INTERVAL_MAX_PER_DAY: "0",
  } as NodeJS.ProcessEnv);
  assert.equal(bounded.maxMinutes, 120);
  assert.equal(bounded.maxFrames, 12);
  assert.equal(bounded.maxRawFrames, 5);
  assert.equal(bounded.maxPerDay, 10);
});

test("evidence entries keep raw flags only for the representative subset", () => {
  const entries: IntervalEvidenceEntry[] = selectIntervalEvidence([
    candidate("a", "2026-09-28T15:00:00.000Z", "VS Code", true),
    candidate("b", "2026-09-28T15:10:00.000Z", "VS Code", false),
    candidate("c", "2026-09-28T15:20:00.000Z", "Google Chrome", true),
  ], { maxFrames: 12, maxRawFrames: 1 }).selected;
  const raw = entries.filter((entry) => entry.rawImageShown);
  assert.equal(raw.length, 1);
  assert.equal(raw[0].candidate.retained, true);
});
