import assert from "node:assert/strict";
import { test } from "node:test";
import { NextResponse } from "next/server";
import { handleNextStepsSpeech, type NextStepsSpeechRouteDeps } from "../src/lib/work-os-next-steps-speech-route.ts";
import type { WorkOsAccess } from "../src/lib/work-os-api.ts";

const intervalId = "4d2a6c1e-7b3f-4a52-9c1d-8e5f0a6b7c21";

const view = {
  status: "ready",
  label: "2:17–3:17 PM",
  items: [
    {
      proposalId: "proposal-1",
      operation: "complete_task",
      status: "pending",
      title: "Finish the recap card",
      rationale: "The evidence shows the card is finished.",
      taskId: "task-1",
      editable: false,
    },
    {
      proposalId: "proposal-2",
      operation: "create_task",
      status: "pending",
      title: "Write the release note",
      rationale: "The recap mentions an unreleased change.",
      taskId: null,
      editable: true,
    },
  ],
};

function deps(overrides: Partial<NextStepsSpeechRouteDeps> = {}) {
  const spoken: Array<{ intervalId: string; signature: string; voice: string; lines: unknown[] }> = [];
  const base: NextStepsSpeechRouteDeps = {
    authorize: async () => ({ access: { organizationId: "org-1", personId: "person-1", featureFlags: { voice_input: true } } as unknown as WorkOsAccess }),
    configured: () => true,
    loadMoment: async () => view,
    speak: (async (input) => {
      spoken.push({ intervalId: input.intervalId, signature: input.signature, voice: input.voice, lines: input.lines });
      return { ok: true, audio: new Uint8Array(1024), mimeType: "audio/wav", voice: input.voice };
    }) as NextStepsSpeechRouteDeps["speak"],
    ...overrides,
  };
  return { deps: base, spoken };
}

const request = (body: unknown) => new Request("https://app.wrazyos.com/api/work-os/voice/next-steps", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer session" },
  body: JSON.stringify(body),
});

test("an unauthenticated press is refused before anything else", async () => {
  const { deps: routeDeps, spoken } = deps({
    authorize: async () => ({ response: NextResponse.json({ error: "authentication required" }, { status: 401 }) }),
  });
  const response = await handleNextStepsSpeech(request({ intervalId }), routeDeps);
  assert.equal(response.status, 401);
  assert.equal(spoken.length, 0);
});

test("a workspace without the capability says so instead of failing later", async () => {
  const { deps: routeDeps, spoken } = deps({ configured: () => false });
  const response = await handleNextStepsSpeech(request({ intervalId }), routeDeps);
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /not available in this workspace yet/);
  assert.equal(spoken.length, 0);
});

test("the body carries an id, and anything else is a 404 rather than a read", async () => {
  let queried = false;
  const loadMoment = async () => { queried = true; return view; };
  assert.equal((await handleNextStepsSpeech(request({}), deps({ loadMoment }).deps)).status, 404);
  assert.equal((await handleNextStepsSpeech(request({ intervalId: "  " }), deps({ loadMoment }).deps)).status, 404);
  assert.equal((await handleNextStepsSpeech(request({ intervalId: "does-not-exist" }), deps({ loadMoment }).deps)).status, 404);
  assert.equal(queried, false);
  const body = await (await handleNextStepsSpeech(request({ intervalId: "nope" }), deps({ loadMoment }).deps)).json() as { error?: string };
  assert.equal(body.error, "That recap is no longer available.");
});

test("an unknown recap and someone else's recap are both gone", async () => {
  for (const message of ["activity interval not found", "forbidden"]) {
    const { deps: routeDeps, spoken } = deps({
      loadMoment: async () => { throw new Error(message); },
    });
    const response = await handleNextStepsSpeech(request({ intervalId }), routeDeps);
    assert.equal(response.status, 404, message);
    const body = await response.json() as { error?: string };
    assert.equal(body.error, "That recap is no longer available.");
    assert.equal(spoken.length, 0);
  }
});

test("an unexpected read failure is rethrown to the shared error handler", async () => {
  const { deps: routeDeps } = deps({
    loadMoment: async () => { throw new Error("database is down"); },
  });
  const response = await handleNextStepsSpeech(request({ intervalId }), routeDeps);
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /database is down/);
});

test("a recap with no decided suggestions is refused, not spoken as silence", async () => {
  for (const status of ["pending", "generating", "skipped", "failed", "none"]) {
    const { deps: routeDeps, spoken } = deps({ loadMoment: async () => ({ ...view, status }) });
    const response = await handleNextStepsSpeech(request({ intervalId }), routeDeps);
    assert.equal(response.status, 422, status);
    assert.match((await response.json()).error, /nothing in that recap to read yet/);
    assert.equal(spoken.length, 0);
  }
  const { deps: emptyDeps, spoken: emptySpoken } = deps({ loadMoment: async () => ({ ...view, items: [] }) });
  const response = await handleNextStepsSpeech(request({ intervalId }), emptyDeps);
  assert.equal(response.status, 422);
  assert.equal(emptySpoken.length, 0);
});

test("a read answers with the audio, the voice, and the words that were spoken", async () => {
  const { deps: routeDeps, spoken } = deps();
  const response = await handleNextStepsSpeech(request({ intervalId, voice: "Kore" }), routeDeps);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "audio/wav");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-work-os-next-steps-voice"), "Kore");
  assert.equal(response.headers.get("x-work-os-recap-revision"), null);
  assert.equal(response.headers.get("x-work-os-recap-stale"), null);
  const lines = JSON.parse(decodeURIComponent(response.headers.get("x-work-os-next-steps-lines")!));
  assert.deepEqual(lines, [
    { text: "Next steps from your 2:17–3:17 PM recap.", time: null, ref: "lead" },
    { text: "Finish the recap card", time: null, ref: "proposal-1:title" },
    { text: "The evidence shows the card is finished.", time: null, ref: "proposal-1:why" },
    { text: "Write the release note", time: null, ref: "proposal-2:title" },
    { text: "The recap mentions an unreleased change.", time: null, ref: "proposal-2:why" },
  ]);
  assert.equal((await response.arrayBuffer()).byteLength, 1024);
  assert.deepEqual(spoken.map(({ intervalId: id, voice, signature }) => ({ intervalId: id, voice, signature })), [{
    intervalId,
    voice: "Kore",
    signature: [
      "proposal-1:complete_task:Finish the recap card:The evidence shows the card is finished.",
      "proposal-2:create_task:Write the release note:The recap mentions an unreleased change.",
    ].join("|"),
  }]);
});

test("a missing voice reads with the default, and an unknown one does too", async () => {
  const { deps: routeDeps, spoken } = deps();
  await handleNextStepsSpeech(request({ intervalId }), routeDeps);
  await handleNextStepsSpeech(request({ intervalId, voice: "Nope" }), routeDeps);
  await handleNextStepsSpeech(request({ intervalId, voice: "Leda" }), routeDeps);
  assert.deepEqual(spoken.map((entry) => entry.voice), ["Kore", "Kore", "Leda"]);
});

test("provider failures answer the employee's copy with a status to match", async () => {
  for (const [reason, status] of [["provider_error", 502], ["timeout", 504], ["malformed", 502], ["too_long", 422]] as const) {
    const { deps: routeDeps } = deps({ speak: (async () => ({ ok: false, reason })) as NextStepsSpeechRouteDeps["speak"] });
    const response = await handleNextStepsSpeech(request({ intervalId }), routeDeps);
    assert.equal(response.status, status, reason);
    const body = await response.json();
    assert.doesNotMatch(body.error, /TOP_UP|OSStatus|fal\.ai|502|504/);
  }
});

test("the clip is the WAV itself, and the lines header is the only transcript", async () => {
  const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00]);
  const { deps: routeDeps } = deps({
    speak: (async (input) => ({ ok: true, audio: bytes, mimeType: "audio/wav", voice: input.voice })) as NextStepsSpeechRouteDeps["speak"],
  });
  const response = await handleNextStepsSpeech(request({ intervalId }), routeDeps);
  assert.equal(response.status, 200);
  const audio = new Uint8Array(await response.arrayBuffer());
  assert.deepEqual([...audio], [...bytes]);
});
