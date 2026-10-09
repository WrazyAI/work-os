import { describe, expect, it } from "vitest";
import type { PagedDiagnosticEvent } from "./debugDiagnostics";
import { TRACE_FIXTURE_CAPACITY, TRACE_FIXTURE_GENERATED, createTraceFixture, selectTracePage } from "./debugTraceFixture";

function history(count: number): PagedDiagnosticEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    seq: index + 1,
    id: `h-${index + 1}`,
    timestamp: new Date(Date.UTC(2026, 9, 9) + index * 1000).toISOString(),
    level: index % 7 === 0 ? "error" : "info",
    source: index % 2 === 0 ? "sync" : "frontend",
    category: index % 5 === 0 ? "api.request.completed" : `cat.${index + 1}`,
    message: `message ${index + 1}`,
    sessionId: "s",
  }));
}

const seqs = (events: PagedDiagnosticEvent[]) => events.map((event) => event.seq);

describe("selectTracePage", () => {
  it("returns the newest page, newest first, with older history flagged", () => {
    const page = selectTracePage(history(120), { limit: 50 });
    expect(seqs(page.events)[0]).toBe(120);
    expect(seqs(page.events).at(-1)).toBe(71);
    expect(page.hasOlder).toBe(true);
    expect(page.hasNewer).toBe(false);
    expect(page.matchingTotal).toBe(120);
    expect(page.headSeq).toBe(120);
    expect(page.matchingAfter).toBeNull();
  });

  it("steps backward from a cursor without holes", () => {
    const page = selectTracePage(history(120), { before: 71, limit: 50 });
    expect(seqs(page.events)[0]).toBe(70);
    expect(seqs(page.events).at(-1)).toBe(21);
    expect(page.hasNewer).toBe(true);
    expect(page.hasOlder).toBe(true);
  });

  it("returns the nearest entries above an after cursor and counts everything newer", () => {
    const page = selectTracePage(history(300), { after: 100, limit: 50 });
    expect(seqs(page.events)[0]).toBe(150);
    expect(seqs(page.events).at(-1)).toBe(101);
    expect(page.hasNewer).toBe(true);
    expect(page.matchingAfter).toBe(200);
  });

  it("applies filters across the whole history, not only the returned page", () => {
    const page = selectTracePage(history(1000), { level: "error", limit: 50 });
    expect(page.events.every((event) => event.level === "error")).toBe(true);
    expect(page.matchingTotal).toBe(Math.ceil(1000 / 7));
    expect(page.headSeq).toBe(1000);
    expect(page.events).toHaveLength(50);
  });

  it("matches the query against category, message, and correlation id", () => {
    const events = history(20).map((event) => (event.seq === 3 ? { ...event, correlationId: "c-8841" } : event));
    expect(seqs(selectTracePage(events, { query: "C-8841" }).events)).toEqual([3]);
    expect(seqs(selectTracePage(events, { query: "api.request" }).events)).toEqual([16, 11, 6, 1]);
  });

  it("caps the page at the loaded maximum", () => {
    expect(selectTracePage(history(500), { limit: 10_000 }).events).toHaveLength(100);
  });

  it("keeps a clear-view cursor as the lower bound for every page", () => {
    const events = history(1000);
    const newest = selectTracePage(events, { since: 900, limit: 50 });
    expect(seqs(newest.events)[0]).toBe(1000);
    expect(seqs(newest.events).at(-1)).toBe(951);
    expect(newest.hasOlder).toBe(true);
    const older = selectTracePage(events, { since: 900, before: 951, limit: 50 });
    expect(seqs(older.events)[0]).toBe(950);
    expect(seqs(older.events).at(-1)).toBe(901);
    expect(older.events.every((event) => event.seq > 900)).toBe(true);
    expect(older.hasOlder).toBe(false);
  });
});

describe("trace fixture", () => {
  it("generates the full burst but keeps only the ring's capacity", async () => {
    const fixture = createTraceFixture();
    const page = await fixture.page({ limit: 50 });
    expect(page.matchingTotal).toBe(TRACE_FIXTURE_CAPACITY);
    expect(page.events[0].seq).toBe(TRACE_FIXTURE_GENERATED);
    expect(page.events.at(-1)?.seq).toBe(TRACE_FIXTURE_GENERATED - 49);
  });

  it("serves request spans with inline method and path", async () => {
    const page = await createTraceFixture().page({ query: "api.request", limit: 50 });
    const span = page.events.find((event) => event.category === "api.request.completed");
    expect(span?.metadata).toEqual(expect.objectContaining({ path: expect.stringMatching(/^\/api\//), method: expect.any(String) }));
  });

  it("searches request paths across the retained history", async () => {
    const page = await createTraceFixture().page({ query: "/api/work-os/attendance/observe", limit: 50 });
    expect(page.events.length).toBeGreaterThan(0);
    expect(page.events.every((event) => String(event.metadata?.path).includes("/attendance/observe"))).toBe(true);
    expect(page.matchingTotal).toBeGreaterThan(page.events.length);
  });

  it("pages through the same contiguous windows as the host", async () => {
    const fixture = createTraceFixture();
    const first = await fixture.page({ limit: 50 });
    const second = await fixture.page({ before: first.events.at(-1)?.seq, limit: 50 });
    expect(second.events[0].seq).toBe((first.events.at(-1)?.seq ?? 0) - 1);
    const counted = await fixture.page({ after: first.events[0].seq - 10, limit: 0 });
    expect(counted.matchingAfter).toBe(10);
  });
});
