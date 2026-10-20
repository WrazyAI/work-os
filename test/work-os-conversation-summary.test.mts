import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { buildPrompt } from "../src/lib/aiInterpret";
import {
  CONVERSATION_FOLD_THRESHOLD,
  CONVERSATION_SUMMARY_PROMPT_VERSION,
  CONVERSATION_VERBATIM_TURNS,
} from "../src/lib/work-conversations-summary";

const root = new URL("../", import.meta.url);
const source = (path: string) => readFile(new URL(path, root), "utf8");

const TASKS = [{ id: "t-1", title: "Ship the debugger fix", completed: false }];
const TURNS = [
  { role: "user" as const, content: "What am I working on?" },
  { role: "assistant" as const, content: "The debugger fix." },
];

function prompt(context: Parameters<typeof buildPrompt>[4]) {
  return buildPrompt("I finished the debugger fix.", TASKS, null, "2026-10-20", context);
}

test("the running summary is carried, and it is labelled as conversation context", () => {
  const text = prompt({ conversation: TURNS, conversationSummary: "Earlier they discussed the debugger fix and the release checklist." });
  assert.match(text, /Earlier in this conversation/);
  assert.match(text, /Earlier they discussed the debugger fix/);
  assert.match(text, /never evidence of work/);
});

test("the summary sits before the verbatim turns, and the employee's words stay last", () => {
  const text = prompt({ conversation: TURNS, conversationSummary: "Earlier notes." });
  const summaryAt = text.indexOf("Earlier in this conversation");
  const recentAt = text.indexOf("Recent conversation:");
  const inputAt = text.indexOf('"""I finished the debugger fix."""');
  assert.ok(summaryAt >= 0 && recentAt > summaryAt, "the summary must precede the verbatim turns");
  assert.ok(inputAt > recentAt, "the employee's own words must stay last");
});

test("no summary means no block, so a fresh conversation reads exactly as before", () => {
  const text = prompt({ conversation: TURNS });
  assert.doesNotMatch(text, /Earlier in this conversation/);
  const empty = prompt({ conversation: TURNS, conversationSummary: null });
  assert.doesNotMatch(empty, /Earlier in this conversation/);
});

test("the verbatim window is smaller than the fold threshold, so no turn is skipped", () => {
  // The reader sends the last N turns; folding keeps exactly N. If the
  // threshold were at or below N, turns could fall between the two.
  assert.ok(CONVERSATION_VERBATIM_TURNS > 0);
  assert.ok(
    CONVERSATION_FOLD_THRESHOLD > CONVERSATION_VERBATIM_TURNS,
    "folding must not start before the verbatim window is full",
  );
  assert.equal(typeof CONVERSATION_SUMMARY_PROMPT_VERSION, "string");
});

test("the fold runs after the turn is persisted and after the response is flushed", async () => {
  const route = await source("src/app/api/work-os/me/interpret/route.ts");
  const persistedAt = route.indexOf("await persistInterpretHistory(");
  const foldedAt = route.indexOf("foldConversationSummary(conversationScope)");
  assert.ok(persistedAt >= 0, "the route must persist the turn");
  assert.ok(foldedAt > persistedAt, "the fold must see the persisted turn");
  assert.match(route, /after\(\(\) => foldConversationSummary/, "the fold must not delay the reply");
  assert.doesNotMatch(route, /await foldConversationSummary/, "the reply must not wait on the fold");
});

test("the reader and the folder share one window constant", async () => {
  const lib = await source("src/lib/work-conversations-summary.ts");
  // The reader defaults to the verbatim window and the folder leaves exactly
  // that many turns behind, so the two can never disagree.
  assert.match(lib, /loadConversationContext\(scope: ConversationScope, limit = CONVERSATION_VERBATIM_TURNS\)/);
  assert.match(lib, /turns\.length - CONVERSATION_VERBATIM_TURNS/);
});

test("folding is bounded and never blocks the chat when the provider fails", async () => {
  const lib = await source("src/lib/work-conversations-summary.ts");
  assert.match(lib, /if \(turns\.length <= CONVERSATION_FOLD_THRESHOLD\) return \{ folded: 0, reason: "not_due" \}/);
  assert.match(lib, /MAX_SUMMARY_CHARS/);
  assert.match(lib, /signal: AbortSignal\.timeout\(AI_TIMEOUTS\.conversationSummary\)/);
  assert.match(lib, /return \{ folded: 0, reason: "unavailable" \}/);
});

test("the fold is guarded against a concurrent fold of the same span", async () => {
  const lib = await source("src/lib/work-conversations-summary.ts");
  assert.match(lib, /update\.eq\("summarized_through", summarizedThrough\)/);
  assert.match(lib, /update\.is\("summarized_through", null\)/);
});
