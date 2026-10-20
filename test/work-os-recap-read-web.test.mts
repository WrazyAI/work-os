// The web recap read: the same one-text rule as the companion, the same
// press-prime (a browser stops honouring the gesture while the clip is made),
// and a control that never appears when the workspace cannot read aloud.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { activeLineIndex, lineWeights, parseLines } from "../src/modules/work-os/employee/recapAudio";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the highlight follows longer lines slower, and lands on the last one", () => {
  const lines = [
    { text: "Software-development review across three repositories.", time: null },
    { text: "Reviewed the cursor-pagination code", time: "7:21 PM" },
  ];
  const weights = lineWeights(lines);
  assert.ok(weights[0] > weights[1]);
  assert.equal(activeLineIndex(0, weights), 0);
  assert.equal(activeLineIndex(0.5, weights), 0);
  assert.equal(activeLineIndex(1, weights), 1);
});

test("the spoken lines are decoded exactly as the server sent them", () => {
  const header = encodeURIComponent(JSON.stringify([{ text: "Lead", time: null }, { text: "Reviewed the queue", time: "7:23 PM" }]));
  assert.deepEqual(parseLines(header), [
    { text: "Lead", time: null },
    { text: "Reviewed the queue", time: "7:23 PM" },
  ]);
  assert.deepEqual(parseLines(null), []);
  assert.deepEqual(parseLines("not-json"), []);
});

test("the card offers Listen only when reading aloud is available", () => {
  const card = read("src/modules/work-os/employee/EmployeeActivityRecaps.tsx");
  assert.match(card, /voiceAvailable && !preparing && !unavailable/);
  assert.match(card, /Listen to the recap for/);
  assert.match(card, /Stop reading the recap for/);
  // Availability is the flag and the deployment capability, from the day.
  const today = read("src/modules/work-os/employee/EmployeeToday.tsx");
  assert.match(today, /voiceAvailable=\{voiceAvailable\}/);
  assert.match(today, /featureFlags\?\.voice_input === true/);
  assert.match(today, /capabilities\?\.voice_input === true/);
});

test("the web player opens its audio context inside the press, before it asks for the clip", () => {
  const source = read("src/modules/work-os/employee/recapAudio.ts");
  const open = source.indexOf("context = new Constructor()");
  const request = source.indexOf('await fetch("/api/work-os/voice/recap"');
  assert.ok(open > 0);
  assert.ok(request > open, "the context must be opened inside the press");
  // No media element and no blob URL: neither a gesture window nor media-src
  // policy can stop the clip from playing.
  assert.doesNotMatch(source, /createObjectURL|new Audio\(/);
  assert.match(source, /decodeAudioData/);
  // The route takes an id, never text.
  assert.match(source, /body: JSON\.stringify\(\{ intervalId: interval\.id, revision: interval\.revision \?\? null \}\)/);
  assert.doesNotMatch(source, /body: JSON\.stringify\([^)]*text/);
});
