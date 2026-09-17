import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MemoryPanel, type MemoryFact, type MemoryRecent } from "./MemorySettings";

const noop = () => undefined;

const candidate: MemoryFact = {
  id: "f1",
  content: "Prefers deep work before noon.",
  review_status: "candidate",
  fact_key: "deep_work",
  local_date: "2026-09-11",
  occurred_at: "2026-09-11T09:00:00.000Z",
};

const confirmed: MemoryFact = {
  id: "f2",
  content: "Owns checkout reporting.",
  review_status: "confirmed",
  fact_key: "role",
  local_date: "2026-09-10",
  occurred_at: "2026-09-10T09:00:00.000Z",
};

const recent: MemoryRecent = {
  id: "r1",
  kind: "check_in",
  content: "Finished the migration.",
  summary: "Finished the migration.",
  local_date: "2026-09-11",
  occurred_at: "2026-09-11T10:00:00.000Z",
};

const instantCandidate: MemoryFact = {
  id: "f3",
  content: "Protects Friday afternoons for review.",
  review_status: "candidate",
  fact_key: "review_rhythm",
  local_date: "2026-09-17T00:00:00.000Z",
  occurred_at: "2026-09-17T09:00:00.000Z",
};

const manyRecent: MemoryRecent[] = Array.from({ length: 10 }, (_, index) => ({
  id: `r${index + 1}`,
  kind: "task_event",
  content: `Activity ${index + 1}`,
  summary: `Activity ${index + 1}`,
  local_date: `2026-09-${String(20 - index).padStart(2, "0")}`,
  occurred_at: `2026-09-${String(20 - index).padStart(2, "0")}T10:00:00.000Z`,
}));

describe("MemoryPanel sections", () => {
  it("keeps the three memory classes in one ordered, full-width column", () => {
    const html = renderToStaticMarkup(
      createElement(MemoryPanel, { facts: [candidate, confirmed], recent: [recent], busy: false, error: null, onReview: noop, onForget: noop }),
    );
    const review = html.indexOf("Waiting for your review");
    const facts = html.indexOf("Remembered facts");
    const activity = html.indexOf("Recent activity");
    expect(review).toBeGreaterThan(-1);
    expect(facts).toBeGreaterThan(review);
    expect(activity).toBeGreaterThan(facts);
    expect(html).toContain('class="memory-panel"');
    expect(html).not.toContain("settings-panel");
    expect(html).toContain('class="memory-section review"');
    expect(html).toContain('class="memory-section facts"');
    expect(html).toContain('class="memory-section activity"');
  });

  it("labels each section with its own count", () => {
    const html = renderToStaticMarkup(
      createElement(MemoryPanel, { facts: [candidate, instantCandidate, confirmed], recent: manyRecent, busy: false, error: null, onReview: noop, onForget: noop }),
    );
    expect(html).toContain('aria-label="2 waiting for review"');
    expect(html).toContain('aria-label="1 kept facts"');
    expect(html).toContain('aria-label="10 recent memories"');
    expect(html).toContain("2 waiting for review</span>");
  });

  it("formats memory dates as calendar days instead of raw instants", () => {
    const html = renderToStaticMarkup(
      createElement(MemoryPanel, { facts: [instantCandidate, confirmed], recent: [recent], busy: false, error: null, onReview: noop, onForget: noop }),
    );
    expect(html).toContain("Proposed September 17");
    expect(html).toContain("Kept September 10");
    expect(html).not.toContain("T00:00:00");
    expect(html).not.toContain("2026-09-17T");
  });

  it("caps the activity feed and explains what activity means", () => {
    const html = renderToStaticMarkup(
      createElement(MemoryPanel, { facts: [], recent: manyRecent, busy: false, error: null, onReview: noop, onForget: noop }),
    );
    expect((html.match(/class="memory-row"/g) ?? []).length).toBe(8);
    expect(html).toContain("Show all 10");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("never proof that work was completed");
    expect(html).toContain('class="memory-kind"');
  });

  it("orders review candidates newest first", () => {
    const oldest: MemoryFact = { ...candidate, id: "old", content: "Oldest proposal.", occurred_at: "2026-09-01T09:00:00.000Z" };
    const newest: MemoryFact = { ...candidate, id: "new", content: "Newest proposal.", occurred_at: "2026-09-20T09:00:00.000Z" };
    const html = renderToStaticMarkup(
      createElement(MemoryPanel, { facts: [oldest, candidate, newest], recent: [], busy: false, error: null, onReview: noop, onForget: noop }),
    );
    expect(html.indexOf("Newest proposal.")).toBeLessThan(html.indexOf("Prefers deep work before noon."));
    expect(html.indexOf("Prefers deep work before noon.")).toBeLessThan(html.indexOf("Oldest proposal."));
  });
});

describe("MemoryPanel", () => {
  it("shows candidates for review with keep and reject actions", () => {
    const html = renderToStaticMarkup(
      createElement(MemoryPanel, { facts: [candidate], recent: [], busy: false, error: null, onReview: noop, onForget: noop }),
    );
    expect(html).toContain("Prefers deep work before noon.");
    expect(html).toContain("Waiting for your review");
    expect(html).toContain("Keep");
    expect(html).toContain("Not true");
  });

  it("shows confirmed facts with a forget control and recent memories", () => {
    const html = renderToStaticMarkup(
      createElement(MemoryPanel, { facts: [confirmed], recent: [recent], busy: false, error: null, onReview: noop, onForget: noop }),
    );
    expect(html).toContain("Owns checkout reporting.");
    expect(html).toContain("Forget: Owns checkout reporting.");
    expect(html).toContain("Finished the migration.");
    expect(html).toContain("Check-in");
  });

  it("renders empty states and errors", () => {
    const html = renderToStaticMarkup(
      createElement(MemoryPanel, { facts: [], recent: [], busy: false, error: "Load failed", onReview: noop, onForget: noop }),
    );
    expect(html).toContain("No kept facts yet");
    expect(html).toContain("No memories recorded yet");
    expect(html).toContain("Load failed");
  });
});
