import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatMemoryContext,
  fuseMemoryRanks,
  memoryContentHash,
  memoryScopeKey,
  type MemoryItem,
} from "../src/lib/work-memory-core";

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
  const block = formatMemoryContext({ items: [recalled], profileFacts: [fact] });
  assert.match(block, /Known about this person/);
  assert.match(block, /Recalled history/);
  assert.match(block, /2026-09-10 · task_event/);
  const tiny = formatMemoryContext({ items: [recalled], profileFacts: [fact], maxChars: 40 });
  assert.ok(tiny.length <= 40);
});

test("empty memory context renders nothing", () => {
  assert.equal(formatMemoryContext({ items: [], profileFacts: [] }), "");
});
