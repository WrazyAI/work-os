import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LOOM_TRANSCRIPT_MAX_STORED,
  findLoomReference,
  formatLoomDuration,
  loomMetadataEnabled,
  normalizeLoomTranscript,
  parseLoomReference,
} from "../src/lib/work-os-loom";

const ID = "912e89a68ccc42c5ab5096fec7cd63d6";

test("accepts only canonical Loom share links and bare video ids", () => {
  assert.deepEqual(parseLoomReference(`https://www.loom.com/share/${ID}`), { videoId: ID, url: `https://www.loom.com/share/${ID}` });
  assert.deepEqual(parseLoomReference(`https://loom.com/share/${ID}?sid=2e96ab06-46c4-4f14-b425-8944e89fb9e2`), { videoId: ID, url: `https://www.loom.com/share/${ID}` });
  assert.deepEqual(parseLoomReference(`https://www.loom.com/embed/${ID}/`), { videoId: ID, url: `https://www.loom.com/share/${ID}` });
  assert.deepEqual(parseLoomReference(ID.toUpperCase()), { videoId: ID, url: `https://www.loom.com/share/${ID}` });
  assert.equal(parseLoomReference(""), null);
  assert.equal(parseLoomReference("not a url"), null);
});

test("rejects schemes, hosts, and paths that would widen the server-side fetch", () => {
  assert.equal(parseLoomReference(`http://www.loom.com/share/${ID}`), null);
  assert.equal(parseLoomReference(`https://loom.com.evil.example/share/${ID}`), null);
  assert.equal(parseLoomReference(`https://evil.example/share/${ID}`), null);
  assert.equal(parseLoomReference(`https://loom.com@evil.example/share/${ID}`), null);
  assert.equal(parseLoomReference(`https://www.loom.com:8443/share/${ID}`), null);
  assert.equal(parseLoomReference(`https://www.loom.com/watch/${ID}`), null);
  assert.equal(parseLoomReference("https://www.loom.com/share/abc123"), null);
  assert.equal(parseLoomReference("https://www.loom.com/share/912e89a68ccc42c5ab5096fec7cd63d6/extra"), null);
});

test("detects a Loom link inside an ordinary update", () => {
  const reference = findLoomReference(`Recorded my EOD here: https://www.loom.com/share/${ID}. Thanks!`);
  assert.equal(reference?.videoId, ID);
  assert.equal(findLoomReference("No recording today, just text."), null);
  assert.equal(findLoomReference("See https://example.com/share/912e89a68ccc42c5ab5096fec7cd63d6"), null);
});

test("normalizes WebVTT and SRT pastes into readable text", () => {
  const vtt = [
    "WEBVTT",
    "",
    "1",
    "00:00:04.774 --> 00:00:07.704",
    "<v Speaker>Walked through the settlement dashboard.",
    "",
    "2",
    "00:00:07.964 --> 00:00:10.124",
    "Two approvals are still pending.",
  ].join("\n");
  assert.equal(normalizeLoomTranscript(vtt), "Walked through the settlement dashboard. Two approvals are still pending.");
  const srt = "1\n00:00:01,154 --> 00:00:04,774\nThe report is ready.\n";
  assert.equal(normalizeLoomTranscript(srt), "The report is ready.");
  assert.equal(normalizeLoomTranscript("Plain notes from the recording."), "Plain notes from the recording.");
  assert.equal(normalizeLoomTranscript("   "), "");
});

test("bounds the stored transcript", () => {
  const transcript = "word ".repeat(30_000);
  assert.equal(normalizeLoomTranscript(transcript).length, LOOM_TRANSCRIPT_MAX_STORED);
});

test("formats recording lengths for evidence copy", () => {
  assert.equal(formatLoomDuration(326), "5:26");
  assert.equal(formatLoomDuration(3726), "1:02:06");
  assert.equal(formatLoomDuration(0), null);
  assert.equal(formatLoomDuration(null), null);
});

test("the Loom flag is opt-in per organization", () => {
  assert.equal(loomMetadataEnabled({ loom_updates: true }), true);
  assert.equal(loomMetadataEnabled({ loom_updates: false }), false);
  assert.equal(loomMetadataEnabled({}), false);
  assert.equal(loomMetadataEnabled(null), false);
});

console.log("Work OS Loom tests passed.");
