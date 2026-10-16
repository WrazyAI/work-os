import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RECAP_SPEECH_MAX_CHARS,
  buildRecapSpeechLines,
} from "../src/lib/work-os-recap-speech.ts";
import { ACTIVITY_TIME_PREFIX_SOURCE, splitActivityTime } from "../src/lib/activity-time.ts";

test("speaks the lead line then each activity in order", () => {
  const lines = buildRecapSpeechLines({
    detail: "Software-development review across three repositories.",
    activities: ["7:21 PM Reviewed the cursor-pagination code", "Read the blocker notes"],
  });
  assert.deepEqual(lines, [
    { text: "Software-development review across three repositories.", time: null },
    { text: "Reviewed the cursor-pagination code", time: "7:21 PM" },
    { text: "Read the blocker notes", time: null },
  ]);
});

test("falls back to the headline when there is no detail", () => {
  const lines = buildRecapSpeechLines({ headline: "Reviewed work summaries", activities: [] });
  assert.deepEqual(lines, [{ text: "Reviewed work summaries", time: null }]);
});

test("an empty recap produces no lines at all", () => {
  assert.deepEqual(buildRecapSpeechLines({ detail: null, activities: [] }), []);
  // An empty detail is not an empty recap: the bubble shows the headline then,
  // so that is what Otto says.
  assert.deepEqual(buildRecapSpeechLines({ detail: "   ", headline: "Ready" }), [{ text: "Ready", time: null }]);
  assert.deepEqual(buildRecapSpeechLines({ activities: [null, "", "   "] }), []);
  assert.deepEqual(buildRecapSpeechLines({ activities: "not an array" }), []);
});

test("an old recap whose time trails the phrase keeps the line intact", () => {
  const [line] = buildRecapSpeechLines({ activities: ["Reviewed the task list at 7:38 PM"] });
  assert.deepEqual(line, { text: "Reviewed the task list at 7:38 PM", time: null });
});

test("a script past the cap is refused, not trimmed", () => {
  const activities = Array.from({ length: 12 }, (_, index) => `${"x".repeat(520)} ${index}`);
  assert.throws(
    () => buildRecapSpeechLines({ detail: "Lead line", activities }),
    /too long to read aloud/i,
  );
});

test("the cap admits a full-length recap", () => {
  const activities = Array.from({ length: 12 }, (_, index) => `Reviewed item ${index} and its follow-ups`);
  const lines = buildRecapSpeechLines({ detail: "A thread of work.", activities });
  assert.equal(lines.length, 13);
  assert.ok(lines.reduce((total, line) => total + line.text.length, 0) < RECAP_SPEECH_MAX_CHARS);
});

test("the companion splits activity times with the same rule", () => {
  const companion = readFileSync(
    new URL("../desktop/work-os-companion/src/ActivityIntervalCard.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(
    companion.includes(ACTIVITY_TIME_PREFIX_SOURCE),
    "the companion and the server must split activity times with the same expression",
  );
});

test("splitActivityTime reads the forms the prompt asks for", () => {
  assert.deepEqual(splitActivityTime("7:21 PM Reviewed the code"), { time: "7:21 PM", text: "Reviewed the code" });
  assert.deepEqual(splitActivityTime("2:17–3:17 PM Reviewed the plan"), { time: "2:17–3:17 PM", text: "Reviewed the plan" });
  assert.deepEqual(splitActivityTime("Reviewed the plan"), { time: null, text: "Reviewed the plan" });
});
