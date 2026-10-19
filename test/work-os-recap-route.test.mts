import assert from "node:assert/strict";
import { test } from "node:test";
import { NextResponse } from "next/server";
import { handleRecapSpeech, type RecapSpeechRouteDeps } from "../src/lib/work-os-recap-route.ts";
import type { WorkOsAccess } from "../src/lib/work-os-api.ts";

const row = {
  id: "4d2a6c1e-7b3f-4a52-9c1d-8e5f0a6b7c21",
  revision: 4,
  headline: "Reviewed work summaries",
  ai_detail: "Software-development review across three repositories.",
  structured_summary: {
    activities: [
      { description: "7:21 PM Reviewed the cursor-pagination code", evidence_indexes: [1], possible_task_reference: null, confidence: 0.8 },
      { description: "Read the blocker notes", evidence_indexes: [2], possible_task_reference: null, confidence: 0.7 },
    ],
  },
};

function deps(overrides: Partial<RecapSpeechRouteDeps> = {}) {
  const spoken: Array<{ intervalId: string; revision: number; voice: string }> = [];
  const base: RecapSpeechRouteDeps = {
    authorize: async () => ({ access: { organizationId: "org-1", personId: "person-1", featureFlags: { voice_input: true } } as unknown as WorkOsAccess }),
    configured: () => true,
    loadInterval: async () => row,
    speak: (async (input) => {
      spoken.push({ intervalId: input.intervalId, revision: input.revision, voice: input.voice });
      return { ok: true, audio: new Uint8Array(1024), mimeType: "audio/wav", voice: input.voice };
    }) as RecapSpeechRouteDeps["speak"],
    ...overrides,
  };
  return { deps: base, spoken };
}

const request = (body: unknown, init: RequestInit = {}) => new Request("https://app.wrazyos.com/api/work-os/voice/recap", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer session", ...(init.headers ?? {}) },
  body: JSON.stringify(body),
  ...init,
});

test("an unauthenticated press is refused before anything else", async () => {
  const { deps: routeDeps } = deps({
    authorize: async () => ({ response: NextResponse.json({ error: "authentication required" }, { status: 401 }) }),
  });
  const response = await handleRecapSpeech(request({ intervalId: "4d2a6c1e-7b3f-4a52-9c1d-8e5f0a6b7c21" }), routeDeps);
  assert.equal(response.status, 401);
});

test("a workspace without the capability says so instead of failing later", async () => {
  const { deps: routeDeps } = deps({ configured: () => false });
  const response = await handleRecapSpeech(request({ intervalId: "4d2a6c1e-7b3f-4a52-9c1d-8e5f0a6b7c21" }), routeDeps);
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /not available in this workspace yet/);
});

test("the body carries an id, and anything else is a 404 rather than a read", async () => {
  const { deps: routeDeps, spoken } = deps();
  assert.equal((await handleRecapSpeech(request({}), routeDeps)).status, 404);
  assert.equal((await handleRecapSpeech(request({ intervalId: "  " }), routeDeps)).status, 404);
  assert.equal((await handleRecapSpeech(request({ intervalId: "4d2a6c1e-7b3f-4a52-9c1d-8e5f0a6b7c21" }), deps({ loadInterval: async () => null }).deps)).status, 404);
  assert.equal(spoken.length, 0);
});

test("a recap with nothing in it is refused, not spoken as silence", async () => {
  const { deps: routeDeps, spoken } = deps({
    loadInterval: async () => ({ id: "4d2a6c1e-7b3f-4a52-9c1d-8e5f0a6b7c21", revision: 2, headline: null, ai_detail: null, structured_summary: {} }),
  });
  const response = await handleRecapSpeech(request({ intervalId: "4d2a6c1e-7b3f-4a52-9c1d-8e5f0a6b7c21" }), routeDeps);
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /nothing in that recap to read yet/);
  assert.equal(spoken.length, 0);
});

test("a read answers with the audio and the words that were spoken", async () => {
  const { deps: routeDeps, spoken } = deps();
  const response = await handleRecapSpeech(request({ intervalId: "4d2a6c1e-7b3f-4a52-9c1d-8e5f0a6b7c21", revision: 4, voice: "Kore" }), routeDeps);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "audio/wav");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-work-os-recap-voice"), "Kore");
  assert.equal(response.headers.get("x-work-os-recap-revision"), "4");
  assert.equal(response.headers.get("x-work-os-recap-stale"), null);
  const lines = JSON.parse(decodeURIComponent(response.headers.get("x-work-os-recap-lines")!));
  assert.deepEqual(lines, [
    { text: "Software-development review across three repositories.", time: null },
    { text: "Reviewed the cursor-pagination code", time: "7:21 PM" },
    { text: "Read the blocker notes", time: null },
  ]);
  assert.equal((await response.arrayBuffer()).byteLength, 1024);
  assert.deepEqual(spoken, [{ intervalId: "4d2a6c1e-7b3f-4a52-9c1d-8e5f0a6b7c21", revision: 4, voice: "Kore" }]);
});

test("a stale revision is flagged so the card can be refreshed first", async () => {
  const { deps: routeDeps } = deps();
  const response = await handleRecapSpeech(request({ intervalId: "4d2a6c1e-7b3f-4a52-9c1d-8e5f0a6b7c21", revision: 2 }), routeDeps);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-work-os-recap-stale"), "1");
  assert.equal(response.headers.get("x-work-os-recap-revision"), "4");
});

test("provider failures answer the employee's copy with a status to match", async () => {
  for (const [reason, status] of [["provider_error", 502], ["timeout", 504], ["too_long", 422], ["malformed", 502]] as const) {
    const { deps: routeDeps } = deps({ speak: (async () => ({ ok: false, reason })) as RecapSpeechRouteDeps["speak"] });
    const response = await handleRecapSpeech(request({ intervalId: "4d2a6c1e-7b3f-4a52-9c1d-8e5f0a6b7c21" }), routeDeps);
    assert.equal(response.status, status, reason);
    const body = await response.json();
    assert.doesNotMatch(body.error, /TOP_UP|OSStatus|fal\.ai|502|504/);
  }
});

test("a malformed id is gone, not a database error", async () => {
  let queried = false;
  const response = await handleRecapSpeech(
    new Request("http://local/api/work-os/voice/recap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intervalId: "does-not-exist" }),
    }),
    {
      authorize: async () => ({ access: { organizationId: "org-1", personId: "person-1" } as WorkOsAccess }),
      configured: () => true,
      loadInterval: async () => { queried = true; return null; },
      speak: async () => { throw new Error("never reached"); },
    },
  );
  assert.equal(response.status, 404);
  assert.equal(queried, false);
  const body = await response.json() as { error?: string };
  assert.equal(body.error, "That recap is no longer available.");
});

test("a missing voice reads with the default, and an unknown one does too", async () => {
  const { deps: routeDeps, spoken } = deps();
  await handleRecapSpeech(request({ intervalId: "4d2a6c1e-7b3f-4a52-9c1d-8e5f0a6b7c21" }), routeDeps);
  await handleRecapSpeech(request({ intervalId: "4d2a6c1e-7b3f-4a52-9c1d-8e5f0a6b7c21", voice: "Nope" }), routeDeps);
  assert.equal(spoken[0].voice, "Kore");
  assert.equal(spoken[1].voice, "Nope", "the route passes it through; the synthesiser owns the fallback");
});
