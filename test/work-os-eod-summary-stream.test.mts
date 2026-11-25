import assert from "node:assert/strict";
import test from "node:test";
import { streamEodSummary, type EodGrounding } from "../src/lib/aiEod";

const grounding: EodGrounding = {
  date: "2026-11-24",
  personName: "Amara Okafor",
  clockedInAt: "2026-11-24T14:04:00.000Z",
  clockedOutAt: "2026-11-24T22:08:00.000Z",
  updates: [],
  completed: ["Reconcile the Q4 supplier ledger"],
  carried: ["Finalize the December close checklist"],
  blockers: [],
  observed: [],
};

const composition = {
  completed: ["Closed the Q4 supplier reconciliation"],
  inProgress: ["Supplier scorecard v2"],
  next: ["Finalize the December close checklist"],
};

test("the summary stream is unavailable without an API key", async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    const result = await streamEodSummary(grounding, composition);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "ai_unconfigured");
  } finally {
    if (previous !== undefined) process.env.OPENROUTER_API_KEY = previous;
  }
});

test("the summary stream extracts provider text chunks", async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENROUTER_API_KEY = "test-key";
  const captured: { body: Record<string, unknown> | null } = { body: null };
  const encoder = new TextEncoder();
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    captured.body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"A steady "}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"day."},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2}}\n\n'));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }) as typeof fetch;
  try {
    const result = await streamEodSummary(grounding, composition);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const text = await new Response(result.stream).text();
    assert.equal(text, "A steady day.");
    const requestBody = captured.body;
    assert.ok(requestBody);
    assert.equal(requestBody.stream, true);
    const messages = requestBody.messages as Array<{ content: string }>;
    assert.match(messages[1].content, /Closed the Q4 supplier reconciliation/);
    assert.match(messages[1].content, /Supplier scorecard v2/);
    assert.match(messages[1].content, /Finalize the December close checklist/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey !== undefined) process.env.OPENROUTER_API_KEY = previousKey;
    else delete process.env.OPENROUTER_API_KEY;
  }
});

test("a provider failure is reported before any text is sent", async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENROUTER_API_KEY = "test-key";
  globalThis.fetch = (async () => new Response("nope", { status: 502 })) as typeof fetch;
  try {
    const result = await streamEodSummary(grounding, composition);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "ai_unavailable");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey !== undefined) process.env.OPENROUTER_API_KEY = previousKey;
    else delete process.env.OPENROUTER_API_KEY;
  }
});

test("CRLF-framed provider events are read", async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENROUTER_API_KEY = "test-key";
  const encoder = new TextEncoder();
  globalThis.fetch = (async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"A "}}]}\r\n\r\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"day."}}]}\r\n\r\n'));
        controller.enqueue(encoder.encode("data: [DONE]\r\n\r\n"));
        controller.close();
      },
    });
    return new Response(body, { status: 200 });
  }) as typeof fetch;
  try {
    const result = await streamEodSummary(grounding, composition);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(await new Response(result.stream).text(), "A day.");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey !== undefined) process.env.OPENROUTER_API_KEY = previousKey;
    else delete process.env.OPENROUTER_API_KEY;
  }
});

test("a provider error event fails the stream instead of looking complete", async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENROUTER_API_KEY = "test-key";
  const encoder = new TextEncoder();
  globalThis.fetch = (async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"error":{"message":"provider stopped"},"choices":[{"finish_reason":"error"}]}\n\n'));
        controller.close();
      },
    });
    return new Response(body, { status: 200 });
  }) as typeof fetch;
  try {
    const result = await streamEodSummary(grounding, composition);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    await assert.rejects(() => new Response(result.stream).text());
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey !== undefined) process.env.OPENROUTER_API_KEY = previousKey;
    else delete process.env.OPENROUTER_API_KEY;
  }
});
