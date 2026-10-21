import assert from "node:assert/strict";
import { test } from "node:test";
import {
  __resetNextStepsSpeechCache,
  buildNextStepsSpeechLines,
  speakNextSteps,
} from "../src/lib/work-os-next-steps-speech.ts";
import { RECAP_SPEECH_MAX_CHARS, type RecapSpeechLine } from "../src/lib/work-os-recap-speech.ts";

const items = [
  { proposalId: "proposal-1", title: "Finish the recap card", rationale: "The evidence shows the card is finished." },
  { proposalId: "proposal-2", title: "Write the release note", rationale: "The recap mentions an unreleased change." },
];

test("speaks the lead line with the recap's label, then each suggestion in order", () => {
  const lines = buildNextStepsSpeechLines({ label: "2:17–3:17 PM", items });
  assert.deepEqual(lines, [
    { text: "Next steps from your 2:17–3:17 PM recap.", time: null, ref: "lead" },
    { text: "Finish the recap card", time: null, ref: "proposal-1:title" },
    { text: "The evidence shows the card is finished.", time: null, ref: "proposal-1:why" },
    { text: "Write the release note", time: null, ref: "proposal-2:title" },
    { text: "The recap mentions an unreleased change.", time: null, ref: "proposal-2:why" },
  ]);
});

test("an unlabelled recap still says what the list is", () => {
  const expected = [{ text: "Next steps from your approved recap.", time: null, ref: "lead" }];
  assert.deepEqual(buildNextStepsSpeechLines({ label: null, items: [] }), expected);
  assert.deepEqual(buildNextStepsSpeechLines({ label: "   ", items: [] }), expected);
});

test("an empty rationale is skipped, and text is collapsed like the card's", () => {
  const lines = buildNextStepsSpeechLines({
    label: "10:00–11:00 AM",
    items: [
      { proposalId: "proposal-1", title: "  Finish   the\nrecap card ", rationale: "   " },
      { proposalId: "proposal-2", title: "", rationale: "Only  the reason\nis here." },
    ],
  });
  assert.deepEqual(lines, [
    { text: "Next steps from your 10:00–11:00 AM recap.", time: null, ref: "lead" },
    { text: "Finish the recap card", time: null, ref: "proposal-1:title" },
    { text: "Only the reason is here.", time: null, ref: "proposal-2:why" },
  ]);
});

test("a script past the cap is refused, not trimmed", () => {
  const long = [
    { proposalId: "proposal-1", title: "x".repeat(2_100), rationale: "" },
    { proposalId: "proposal-2", title: "y".repeat(2_100), rationale: "" },
    { proposalId: "proposal-3", title: "z".repeat(2_100), rationale: "" },
  ];
  assert.throws(
    () => buildNextStepsSpeechLines({ label: "2:17–3:17 PM", items: long }),
    /too long to read aloud/i,
  );
});

test("the cap admits a full set of suggestions", () => {
  const realistic = [
    { proposalId: "proposal-1", title: "Finish the recap card", rationale: "r".repeat(400) },
    { proposalId: "proposal-2", title: "Write the release note", rationale: "w".repeat(400) },
    { proposalId: "proposal-3", title: "Push the branch", rationale: "p".repeat(400) },
  ];
  const lines = buildNextStepsSpeechLines({ label: "2:17–3:17 PM", items: realistic });
  assert.equal(lines.length, 7);
  assert.ok(lines.reduce((total, line) => total + line.text.length, 0) < RECAP_SPEECH_MAX_CHARS);
});

/* ── Speaking them ─────────────────────────────────────────────────────── */

function stubProvider(options: { status?: number; audioBytes?: number } = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    calls.push({ url: href, init });
    if (href.startsWith("https://fal.run/")) {
      return new Response(JSON.stringify({ audio: { url: "https://fal.media/out.wav" } }), {
        status: options.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(new Uint8Array(options.audioBytes ?? 2048), {
      status: 200,
      headers: { "content-type": "audio/wav" },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const synthesisCalls = (calls: Array<{ url: string }>) =>
  calls.filter((call) => call.url.startsWith("https://fal.run/")).length;

const spokenLines: RecapSpeechLine[] = [
  { text: "Next steps from your 2:17–3:17 PM recap.", time: null, ref: "lead" },
  { text: "Finish the recap card", time: null, ref: "proposal-1:title" },
];

test("asks the provider for a next-steps read with the suggestions' own words", async () => {
  process.env.FAL_API_KEY = "test-key";
  const { fetchImpl, calls } = stubProvider({});
  const result = await speakNextSteps({
    intervalId: "interval-1",
    signature: "proposal-1:complete_task:Finish the recap card:The evidence shows the card is finished.",
    voice: "Kore",
    lines: spokenLines,
    fetchImpl,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.mimeType, "audio/wav");
  assert.equal(result.voice, "Kore");
  assert.equal(result.audio.byteLength, 2048);
  const request = calls[0];
  assert.equal(request.url, "https://fal.run/google/gemini-3.8-flash-lite-tts");
  const body = JSON.parse(String(request.init?.body));
  assert.equal(body.voice, "Kore");
  assert.equal(body.prompt, "Next steps from your 2:17–3:17 PM recap. Finish the recap card.");
  assert.match(body.style_instructions, /Warm and unhurried/);
});

test("an unknown voice falls back to the default instead of failing", async () => {
  process.env.FAL_API_KEY = "test-key";
  const { fetchImpl, calls } = stubProvider({});
  const result = await speakNextSteps({
    intervalId: "interval-1",
    signature: "sig",
    voice: "NotARealVoice",
    lines: spokenLines,
    fetchImpl,
  });
  assert.equal(result.ok, true);
  assert.equal(JSON.parse(String(calls[0].init?.body)).voice, "Kore");
});

test("one clip per recap, suggestion set, and voice, and a failure is never cached", async () => {
  process.env.FAL_API_KEY = "test-key";
  __resetNextStepsSpeechCache();
  const { fetchImpl, calls } = stubProvider({});
  const base = { intervalId: "interval-1", signature: "sig-1", voice: "Kore", lines: spokenLines, fetchImpl };
  await speakNextSteps(base);
  await speakNextSteps(base);
  assert.equal(synthesisCalls(calls), 1, "a replay of the same set is free");

  await speakNextSteps({ ...base, signature: "sig-2" });
  assert.equal(synthesisCalls(calls), 2, "a regenerated set reads again");

  await speakNextSteps({ ...base, voice: "Leda" });
  assert.equal(synthesisCalls(calls), 3, "a different voice reads again");

  await speakNextSteps({ ...base, intervalId: "interval-2" });
  assert.equal(synthesisCalls(calls), 4, "another recap reads again");

  const { fetchImpl: failing, calls: failingCalls } = stubProvider({ status: 500 });
  __resetNextStepsSpeechCache();
  const failingInput = { ...base, fetchImpl: failing };
  const first = await speakNextSteps(failingInput);
  const second = await speakNextSteps(failingInput);
  assert.deepEqual(first, { ok: false, reason: "provider_error" });
  assert.deepEqual(second, { ok: false, reason: "provider_error" });
  assert.equal(synthesisCalls(failingCalls), 2, "a failure is retried");
});
