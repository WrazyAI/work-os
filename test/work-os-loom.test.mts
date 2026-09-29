import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LOOM_TRANSCRIPT_MAX_STORED,
  collectLoomBundle,
  findLoomReference,
  formatLoomDuration,
  loomMetadataEnabled,
  loomTemporal,
  loomTranscriptTextFromJson,
  loomUsableForDay,
  normalizeLoomTranscript,
  parseLoomReference,
  parseLoomTranscriptRecord,
} from "../src/lib/work-os-loom";

const ID = "912e89a68ccc42c5ab5096fec7cd63d6";
const ID_RECORDED = "4d65fd6181c94c7ba75a31c9c700d3e2";
const ID_PENDING = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ID_PASTED = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function loomPageHtml(id: string, status = "success") {
  const cdn = "https://cdn.loom.com/mediametadata";
  return [
    "<!doctype html><html><head>",
    `<script type="application/json">{"video_id":"${id}","uploadDate":"2026-09-29T14:11:45.488Z","processing_service":"instant_whisper","transcription_status":"${status}","source_url":"${cdn}/transcription/${id}-3.json?Policy=abc&Signature=def","captions_source_url":"${cdn}/captions/${id}-3.vtt?Policy=abc&Signature=def"}</script>`,
    "</head><body></body></html>",
  ].join("");
}

function requestUrl(input: Parameters<typeof fetch>[0]) {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

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

test("reads Loom's own transcript record out of the public share page", () => {
  const record = parseLoomTranscriptRecord(loomPageHtml(ID_RECORDED));
  assert.equal(record?.status, "success");
  assert.equal(record?.sourceUrl, `https://cdn.loom.com/mediametadata/transcription/${ID_RECORDED}-3.json?Policy=abc&Signature=def`);
  assert.equal(record?.captionsUrl, `https://cdn.loom.com/mediametadata/captions/${ID_RECORDED}-3.vtt?Policy=abc&Signature=def`);
  assert.equal(parseLoomTranscriptRecord("<html><body>No recording record here.</body></html>"), null);
});

test("refuses transcript URLs outside Loom's own CDN", () => {
  const record = parseLoomTranscriptRecord('{"transcription_status":"success","source_url":"https://evil.example/transcript.json","captions_source_url":"http://cdn.loom.com/captions.vtt"}');
  assert.equal(record?.status, "success");
  assert.equal(record?.sourceUrl, null);
  assert.equal(record?.captionsUrl, null);
});

test("flattens Loom's JSON transcript into readable, bounded text", () => {
  assert.equal(
    loomTranscriptTextFromJson({ phrases: [{ value: "Continuing work on the templates." }, { value: "Two approvals are still pending." }, { ts: 9 }] }),
    "Continuing work on the templates. Two approvals are still pending.",
  );
  assert.equal(loomTranscriptTextFromJson(null), "");
  assert.equal(loomTranscriptTextFromJson({ phrases: "not an array" }), "");
  assert.equal(loomTranscriptTextFromJson({ phrases: [{ value: "word ".repeat(30_000) }] }).length, LOOM_TRANSCRIPT_MAX_STORED);
});

test("collects the recording's own transcript when the employee pasted none", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = requestUrl(input);
    calls.push(url);
    if (url.includes("/v1/oembed")) return new Response(JSON.stringify({ title: "Daily update", duration: 180 }), { status: 200 });
    if (url === `https://www.loom.com/share/${ID_RECORDED}`) return new Response(loomPageHtml(ID_RECORDED), { status: 200 });
    if (url.startsWith(`https://cdn.loom.com/mediametadata/transcription/${ID_RECORDED}`)) {
      return new Response(JSON.stringify({ phrases: [{ value: "Shipped the settlement dashboard." }, { value: "Two approvals are still pending." }] }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
  try {
    const bundle = await collectLoomBundle({ url: `https://www.loom.com/share/${ID_RECORDED}`, targetDate: "2026-09-29", timezone: "UTC" });
    assert.equal(bundle?.transcript.present, true);
    assert.equal(bundle?.transcript.source, "loom");
    assert.equal(bundle?.transcript.text, "Shipped the settlement dashboard. Two approvals are still pending.");
    assert.equal(bundle?.temporal.verdict, "same_day");
    assert.ok(calls.some((call) => call.startsWith("https://cdn.loom.com/mediametadata/transcription/")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an update sentence beside the link never replaces the recording's own transcript", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = requestUrl(input);
    if (url.includes("/v1/oembed")) return new Response("{}", { status: 200 });
    if (url === `https://www.loom.com/share/${ID_RECORDED}`) return new Response(loomPageHtml(ID_RECORDED), { status: 200 });
    if (url.startsWith(`https://cdn.loom.com/mediametadata/transcription/${ID_RECORDED}`)) {
      return new Response(JSON.stringify({ phrases: [{ value: "The recording's own words." }] }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
  try {
    const bundle = await collectLoomBundle({
      url: `https://www.loom.com/share/${ID_RECORDED}`,
      updateText: "Recorded my daily update here",
      targetDate: "2026-09-29",
      timezone: "UTC",
    });
    assert.equal(bundle?.transcript.source, "loom");
    assert.equal(bundle?.transcript.text, "The recording's own words.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("falls back to the text beside the link only when Loom has no transcript", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = requestUrl(input);
    if (url.includes("/v1/oembed")) return new Response("{}", { status: 200 });
    if (url === `https://www.loom.com/share/${ID_PENDING}`) return new Response(loomPageHtml(ID_PENDING, "in_progress"), { status: 200 });
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
  try {
    const bundle = await collectLoomBundle({
      url: `https://www.loom.com/share/${ID_PENDING}`,
      updateText: "Here is the recording: I shipped the settlement dashboard today.",
      targetDate: "2026-09-29",
      timezone: "UTC",
    });
    assert.equal(bundle?.transcript.source, "update_text");
    assert.equal(bundle?.transcript.text, "Here is the recording: I shipped the settlement dashboard today.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keeps the employee paste and never needs Loom's CDN for it", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = requestUrl(input);
    calls.push(url);
    if (url.includes("/v1/oembed")) return new Response("{}", { status: 200 });
    if (url === `https://www.loom.com/share/${ID_PASTED}`) return new Response(loomPageHtml(ID_PASTED), { status: 200 });
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
  try {
    const bundle = await collectLoomBundle({ url: `https://www.loom.com/share/${ID_PASTED}`, transcript: "My own notes.", targetDate: "2026-09-29", timezone: "UTC" });
    assert.equal(bundle?.transcript.source, "employee_paste");
    assert.equal(bundle?.transcript.text, "My own notes.");
    assert.ok(!calls.some((call) => call.startsWith("https://cdn.loom.com/")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not transcribe a recording that cannot be used for the target day", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = requestUrl(input);
    calls.push(url);
    if (url.includes("/v1/oembed")) return new Response("{}", { status: 200 });
    if (url === `https://www.loom.com/share/${ID}`) return new Response(loomPageHtml(ID), { status: 200 });
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
  try {
    const bundle = await collectLoomBundle({ url: `https://www.loom.com/share/${ID}`, targetDate: "2026-09-30", timezone: "UTC" });
    assert.equal(bundle?.temporal.verdict, "prior_day");
    assert.equal(bundle?.transcript.present, false);
    assert.ok(!calls.some((call) => call.startsWith("https://cdn.loom.com/")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("waits for Loom's own transcription instead of guessing", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = requestUrl(input);
    if (url.includes("/v1/oembed")) return new Response(JSON.stringify({ title: "Daily update" }), { status: 200 });
    if (url === `https://www.loom.com/share/${ID_PENDING}`) return new Response(loomPageHtml(ID_PENDING, "in_progress"), { status: 200 });
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
  try {
    const bundle = await collectLoomBundle({ url: `https://www.loom.com/share/${ID_PENDING}`, targetDate: "2026-09-29", timezone: "UTC" });
    assert.equal(bundle?.transcript.present, false);
    assert.equal(bundle?.transcript.source, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

console.log("Work OS Loom tests passed.");
