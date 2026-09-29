import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  conversationTurnFromHistory,
  formatMemoryContext,
  fuseMemoryRanks,
  memoryContentHash,
  memoryScopeKey,
  type MemoryItem,
} from "../src/lib/work-memory-core";
import { formatTodaySnapshot } from "../src/lib/work-memory-today";
import { factSourceId, normalizeFactDrafts } from "../src/lib/work-memory-facts";

function item(overrides: Partial<MemoryItem> & { id: string }): MemoryItem {
  return {
    kind: "check_in",
    content: "content",
    occurred_at: "2026-09-10T09:00:00.000Z",
    source_table: "work_check_ins",
    source_id: "1",
    ...overrides,
  } as MemoryItem;
}

test("memory content hash is stable and content-addressed", () => {
  assert.equal(memoryContentHash("hello"), memoryContentHash("hello"));
  assert.notEqual(memoryContentHash("hello"), memoryContentHash("hello "));
  assert.equal(memoryContentHash("hello").length, 64);
});

test("memory scope key namespaces org, person, and date", () => {
  assert.equal(memoryScopeKey("org", "person", "2026-09-11"), "org:person:2026-09-11");
});

test("reciprocal rank fusion prefers items found by both retrievers", () => {
  const vectorOnly = item({ id: "a", content: "vector only" });
  const both = item({ id: "b", content: "both" });
  const lexicalOnly = item({ id: "c", content: "lexical only" });
  const fused = fuseMemoryRanks({
    vector: [vectorOnly, both],
    lexical: [both, lexicalOnly],
    now: new Date("2026-09-11T00:00:00.000Z"),
  });
  assert.deepEqual(fused.map((entry) => entry.id), ["b", "a", "c"]);
  assert.equal(new Set(fused.map((entry) => entry.id)).size, fused.length);
});

test("recency decay ranks fresher items higher at equal rank", () => {
  const fresh = item({ id: "fresh", occurred_at: "2026-09-10T00:00:00.000Z" });
  const stale = item({ id: "stale", occurred_at: "2026-06-01T00:00:00.000Z" });
  const fused = fuseMemoryRanks({
    vector: [stale, fresh],
    lexical: [],
    now: new Date("2026-09-11T00:00:00.000Z"),
  });
  assert.deepEqual(fused.map((entry) => entry.id), ["fresh", "stale"]);
});

test("memory context labels recalled facts and respects the character budget", () => {
  const fact = item({ id: "f", kind: "profile_fact", content: "Prefers deep work before noon", local_date: "2026-09-01" });
  const recalled = item({ id: "r", content: "Closed the migration task", local_date: "2026-09-10", kind: "task_event" });
  const tentative = item({ id: "t", kind: "profile_fact", content: "May prefer implementation before status writing", local_date: "2026-09-11" });
  const block = formatMemoryContext({ items: [recalled], profileFacts: [fact], sameDayCandidates: [tentative] });
  assert.match(block, /Known about this person/);
  assert.match(block, /Working context inferred on this date/);
  assert.match(block, /unconfirmed/);
  assert.match(block, /never as completion evidence or a durable fact/);
  assert.match(block, /2026-09-11 · tentative/);
  assert.match(block, /Recalled history/);
  assert.match(block, /2026-09-10 · task_event/);
  const tiny = formatMemoryContext({ items: [recalled], profileFacts: [fact], sameDayCandidates: [tentative], maxChars: 40 });
  assert.ok(tiny.length <= 40);
});

test("empty memory context renders nothing", () => {
  assert.equal(formatMemoryContext({ items: [], profileFacts: [] }), "");
});

test("history normalization accepts web content and desktop text fields", () => {
  assert.deepEqual(conversationTurnFromHistory({ role: "user", content: "web turn" }), { role: "user", content: "web turn" });
  assert.deepEqual(conversationTurnFromHistory({ role: "assistant", text: "desktop turn" }), { role: "assistant", content: "desktop turn" });
  assert.equal(conversationTurnFromHistory({ role: "system", text: "ignored" }), null);
  assert.equal(conversationTurnFromHistory({ role: "user", text: "   " }), null);
  assert.equal(conversationTurnFromHistory(null), null);
});

test("today snapshot formats agenda, completions, updates, and shift", () => {
  const block = formatTodaySnapshot({
    date: "2026-09-11",
    focus: "Ship memory integration",
    commitments: [
      { title: "Inject snapshot context", status: "completed" },
      { title: "Enable flag", status: "selected" },
    ],
    completed: ["Fix login bug"],
    deferred: ["Write docs"],
    updates: [{ kind: "progress", text: "wired EOD context" }],
    session: { state: "active", clockedInAt: "2026-09-11T09:05:00.000Z", clockedOutAt: null },
  });
  assert.match(block, /Today so far \(2026-09-11\)/);
  assert.match(block, /Focus: Ship memory integration/);
  assert.match(block, /Inject snapshot context \[completed\]/);
  assert.match(block, /Completed today: Fix login bug/);
  assert.match(block, /Deferred today: Write docs/);
  assert.match(block, /\[progress\] wired EOD context/);
  assert.match(block, /on shift since 09:05 UTC/);
});

test("today snapshot with no activity still anchors the date", () => {
  const block = formatTodaySnapshot({ date: "2026-09-11", commitments: [], completed: [], deferred: [], updates: [] });
  assert.equal(block, "Today so far (2026-09-11) — live facts:");
});

test("fact drafts are normalized to stable keys and bounded values", () => {
  const drafts = normalizeFactDrafts({
    facts: [
      { key: "Prefers Deep Work!", value: "  Prefers   deep work before noon. " },
      { key: "x", value: "short" },
      { key: "empty_value", value: "   " },
      { key: "role", value: "Owns the checkout reporting surface." },
    ],
  });
  assert.deepEqual(drafts, [
    { key: "prefers_deep_work", value: "Prefers deep work before noon." },
    { key: "role", value: "Owns the checkout reporting surface." },
  ]);
  assert.equal(normalizeFactDrafts(null).length, 0);
});

test("fact source ids are deterministic per person and case-insensitive value", () => {
  const draft = { key: "role", value: "Owns checkout reporting." };
  assert.equal(factSourceId("p1", draft), factSourceId("p1", { key: "role", value: "owns checkout reporting." }));
  assert.notEqual(factSourceId("p1", draft), factSourceId("p2", draft));
});


test("semantic recall excludes profile facts and same-day candidates use an explicit date lane", () => {
  const source = readFileSync(new URL("../src/lib/work-memory.ts", import.meta.url), "utf8");
  assert.equal((source.match(/kind <> 'profile_fact'/g) ?? []).length, 2);
  assert.match(source, /\.eq\("review_status", "candidate"\)/);
  assert.match(source, /\.eq\("local_date", analysisLocalDate\)/);
  assert.match(source, /includeSameDayCandidates !== false/);
});

test("daily digests never absorb profile facts awaiting review", () => {
  const source = readFileSync(new URL("../src/lib/work-memory-digest.ts", import.meta.url), "utf8");
  assert.equal((source.match(/\.neq\("kind", "profile_fact"\)/g) ?? []).length, 2);
});

test("profile fact candidates use the employee-local workday instead of UTC date slicing", () => {
  const source = readFileSync(new URL("../src/lib/work-memory-facts.ts", import.meta.url), "utf8");
  assert.match(source, /work_employee_onboarding/);
  assert.match(source, /localDateForTimezone\(now, timezone\)/);
  assert.doesNotMatch(source, /const today = now\.toISOString\(\)\.slice\(0, 10\)/);
});
