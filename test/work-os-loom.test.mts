import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LOOM_TRANSCRIPT_MAX_STORED,
  findLoomReference,
  formatLoomDuration,
  loomMetadataEnabled,
  loomTemporal,
  loomUsableForDay,
  normalizeLoomTranscript,
  parseLoomReference,
} from "../src/lib/work-os-loom";

const ID = "912e89a68ccc42c5ab5096fec7cd63d6";

test("accepts canonical, scheme-less, and http Loom links plus bare ids", () => {
  assert.deepEqual(parseLoomReference(`https://www.loom.com/share/${ID}`), { videoId: ID, url: `https://www.loom.com/share/${ID}` });
  assert.deepEqual(parseLoomReference(`https://loom.com/share/${ID}?sid=2e96ab06-46c4-4f14-b425-8944e89fb9e2`), { videoId: ID, url: `https://www.loom.com/share/${ID}` });
  assert.deepEqual(parseLoomReference(`https://www.loom.com/embed/${ID}/`), { videoId: ID, url: `https://www.loom.com/share/${ID}` });
  assert.deepEqual(parseLoomReference(ID.toUpperCase()), { videoId: ID, url: `https://www.loom.com/share/${ID}` });
  // People paste links without a scheme, or with the old http prefix.
  assert.deepEqual(parseLoomReference(`www.loom.com/share/${ID}`), { videoId: ID, url: `https://www.loom.com/share/${ID}` });
  assert.deepEqual(parseLoomReference(`loom.com/embed/${ID}`), { videoId: ID, url: `https://www.loom.com/share/${ID}` });
  assert.deepEqual(parseLoomReference(`http://www.loom.com/share/${ID}`), { videoId: ID, url: `https://www.loom.com/share/${ID}` });
  assert.equal(parseLoomReference(""), null);
  assert.equal(parseLoomReference("not a url"), null);
});

test("rejects hosts, schemes, and paths that would widen the server-side fetch", () => {
  assert.equal(parseLoomReference(`ftp://www.loom.com/share/${ID}`), null);
  assert.equal(parseLoomReference(`loom.com.evil.example/share/${ID}`), null);
  assert.equal(parseLoomReference(`evil.example/share/${ID}`), null);
  assert.equal(parseLoomReference(`loom.com@evil.example/share/${ID}`), null);
  assert.equal(parseLoomReference(`www.loom.com:8443/share/${ID}`), null);
  assert.equal(parseLoomReference(`www.loom.com/watch/${ID}`), null);
  assert.equal(parseLoomReference("www.loom.com/share/abc123"), null);
  assert.equal(parseLoomReference(`www.loom.com/share/${ID}/extra`), null);
});

test("detects a Loom link inside an ordinary update, with or without a scheme", () => {
  const reference = findLoomReference(`Recorded my EOD here: https://www.loom.com/share/${ID}. Thanks!`);
  assert.equal(reference?.videoId, ID);
  assert.equal(findLoomReference(`Recorded my EOD here: www.loom.com/share/${ID}`)?.videoId, ID);
  assert.equal(findLoomReference(`loom.com/embed/${ID}`)?.videoId, ID);
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

test("the recording's own day decides whether it can be used for the day", () => {
  const same = loomTemporal("2026-09-17T14:00:00.000Z", "2026-09-17", "UTC");
  assert.equal(same.verdict, "same_day");
  assert.equal(same.createdLocalDate, "2026-09-17");
  assert.equal(loomUsableForDay(same), true);

  const prior = loomTemporal("2026-09-16T14:00:00.000Z", "2026-09-17", "UTC");
  assert.equal(prior.verdict, "prior_day");
  assert.equal(prior.createdLocalDate, "2026-09-16");
  assert.equal(loomUsableForDay(prior), false);

  const future = loomTemporal("2026-09-18T14:00:00.000Z", "2026-09-17", "UTC");
  assert.equal(future.verdict, "future");
  assert.equal(loomUsableForDay(future), false);

  const unknown = loomTemporal(null, "2026-09-17", "UTC");
  assert.equal(unknown.verdict, "unknown");
  assert.equal(unknown.createdAt, null);
  assert.equal(loomUsableForDay(unknown), true);

  // The employee's timezone decides which local day the recording belongs to.
  const boundary = loomTemporal("2026-09-17T02:30:00.000Z", "2026-09-16", "America/New_York");
  assert.equal(boundary.verdict, "same_day");
  assert.equal(boundary.createdLocalDate, "2026-09-16");

  // A prior-day EOD keeps working: the rule is relative to the target day.
  const priorDayEod = loomTemporal("2026-09-04T18:00:00.000Z", "2026-09-04", "UTC");
  assert.equal(priorDayEod.verdict, "same_day");
  assert.equal(loomUsableForDay(priorDayEod), true);
});

console.log("Work OS Loom tests passed.");
