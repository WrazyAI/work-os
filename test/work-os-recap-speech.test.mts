import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_RECAP_VOICE,
  RECAP_SPEECH_MAX_CHARS,
  __resetRecapSpeechCache,
  buildRecapSpeechLines,
  recapSpeechFailureCopy,
  speakRecap,
  synthesizeRecapSpeech,
  type RecapSpeechLine,
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

/* ── Speaking them ─────────────────────────────────────────────────────── */

function stubProvider(options: {
  status?: number;
  body?: unknown;
  audioBytes?: number;
  fail?: Error;
  audioStatus?: number;
}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    calls.push({ url: href, init });
    if (options.fail && href.includes("/fal-ai-gemini-3.8-flash-tts")) throw options.fail;
    if (href.startsWith("https://fal.run/")) {
      if (options.fail) throw options.fail;
      return new Response(JSON.stringify(options.body ?? { audio: { url: "https://fal.media/out.wav" } }), {
        status: options.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(new Uint8Array(options.audioBytes ?? 2048), {
      status: options.audioStatus ?? 200,
      headers: { "content-type": "audio/wav" },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const spokenLines: RecapSpeechLine[] = [
  { text: "Software-development review across three repositories.", time: null },
  { text: "Reviewed the cursor-pagination code", time: "7:21 PM" },
];

test("asks the provider for a recap read with the recap's own words", async () => {
  process.env.FAL_API_KEY = "test-key";
  const { fetchImpl, calls } = stubProvider({});
  const result = await synthesizeRecapSpeech({ lines: spokenLines, voice: "Puck", fetchImpl });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.mimeType, "audio/wav");
  assert.equal(result.voice, "Puck");
  assert.equal(result.audio.byteLength, 2048);
  const request = calls[0];
  assert.equal(request.url, "https://fal.run/google/gemini-3.8-flash-tts");
  assert.equal((request.init?.headers as Record<string, string>).Authorization, "Key test-key");
  const body = JSON.parse(String(request.init?.body));
  assert.equal(body.voice, "Puck");
  assert.equal(body.prompt, "Software-development review across three repositories. Reviewed the cursor-pagination code.");
  assert.match(body.style_instructions, /Warm and unhurried/);
});

test("an unknown voice falls back to the default instead of failing", async () => {
  process.env.FAL_API_KEY = "test-key";
  const { fetchImpl, calls } = stubProvider({});
  const result = await synthesizeRecapSpeech({ lines: spokenLines, voice: "NotARealVoice", fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(JSON.parse(String(calls[0].init?.body)).voice, DEFAULT_RECAP_VOICE);
});

test("failures map to the employee's copy, never to provider wording", async () => {
  process.env.FAL_API_KEY = "test-key";
  const outOfCredit = await synthesizeRecapSpeech({
    lines: spokenLines,
    voice: "Kore",
    fetchImpl: stubProvider({ status: 402, body: { detail: "User is locked. Reason: TOP_UP." } }).fetchImpl,
  });
  assert.deepEqual(outOfCredit, { ok: false, reason: "provider_error" });
  assert.doesNotMatch(recapSpeechFailureCopy("provider_error"), /TOP_UP|402|locked/);

  const timedOut = await synthesizeRecapSpeech({
    lines: spokenLines,
    voice: "Kore",
    fetchImpl: stubProvider({ fail: Object.assign(new Error("aborted"), { name: "TimeoutError" }) }).fetchImpl,
  });
  assert.deepEqual(timedOut, { ok: false, reason: "timeout" });

  const malformed = await synthesizeRecapSpeech({
    lines: spokenLines,
    voice: "Kore",
    fetchImpl: stubProvider({ body: { something: true } }).fetchImpl,
  });
  assert.deepEqual(malformed, { ok: false, reason: "malformed" });

  const audioMissing = await synthesizeRecapSpeech({
    lines: spokenLines,
    voice: "Kore",
    fetchImpl: stubProvider({ audioStatus: 500 }).fetchImpl,
  });
  assert.deepEqual(audioMissing, { ok: false, reason: "provider_error" });
});

test("no key means not configured, and nothing is sent anywhere", async () => {
  const previous = process.env.FAL_API_KEY;
  delete process.env.FAL_API_KEY;
  const { fetchImpl, calls } = stubProvider({});
  const result = await synthesizeRecapSpeech({ lines: spokenLines, voice: "Kore", fetchImpl });
  assert.deepEqual(result, { ok: false, reason: "not_configured" });
  assert.equal(calls.length, 0);
  assert.match(recapSpeechFailureCopy("not_configured"), /not available in this workspace yet/);
  if (previous === undefined) delete process.env.FAL_API_KEY;
  else process.env.FAL_API_KEY = previous;
});

test("nothing to say is empty, and too long is refused before any request", async () => {
  process.env.FAL_API_KEY = "test-key";
  const { fetchImpl, calls } = stubProvider({});
  assert.deepEqual(await synthesizeRecapSpeech({ lines: [], voice: "Kore", fetchImpl }), { ok: false, reason: "empty" });
  const many: RecapSpeechLine[] = [{ text: "x".repeat(6500), time: null }];
  assert.deepEqual(await synthesizeRecapSpeech({ lines: many, voice: "Kore", fetchImpl }), { ok: false, reason: "too_long" });
  assert.equal(calls.length, 0);
  assert.match(recapSpeechFailureCopy("too_long"), /too long to read aloud/);
});

test("one clip per recap revision per voice, and a failure is never cached", async () => {
  process.env.FAL_API_KEY = "test-key";
  const { fetchImpl: okFetch, calls: okCalls } = stubProvider({});
  __resetRecapSpeechCache();
  const first = await speakRecap({ intervalId: "interval-1", revision: 2, voice: "Kore", lines: spokenLines, fetchImpl: okFetch });
  const second = await speakRecap({ intervalId: "interval-1", revision: 2, voice: "Kore", lines: spokenLines, fetchImpl: okFetch });
  assert.equal(first.ok && second.ok, true);
  assert.equal(okCalls.filter((call) => call.url.startsWith("https://fal.run/")).length, 1, "a replay is free");

  const { fetchImpl: otherFetch, calls: otherCalls } = stubProvider({});
  await speakRecap({ intervalId: "interval-1", revision: 3, voice: "Kore", lines: spokenLines, fetchImpl: otherFetch });
  assert.equal(otherCalls.filter((call) => call.url.startsWith("https://fal.run/")).length, 1, "a new revision reads again");

  const { fetchImpl: failing, calls: failingCalls } = stubProvider({ status: 500 });
  __resetRecapSpeechCache();
  await speakRecap({ intervalId: "interval-2", revision: 1, voice: "Kore", lines: spokenLines, fetchImpl: failing });
  await speakRecap({ intervalId: "interval-2", revision: 1, voice: "Kore", lines: spokenLines, fetchImpl: failing });
  assert.equal(failingCalls.filter((call) => call.url.startsWith("https://fal.run/")).length, 2, "a failure is retried");
});
