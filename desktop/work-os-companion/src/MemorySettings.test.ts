import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MemoryActivitySection, MemoryFactsSection, MemoryModal, MemoryReviewSection, MemorySummary, type MemoryFact, type MemoryRecent } from "./MemorySettings";

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

describe("MemorySummary", () => {
  it("renders the mascot band with counts and the View action", () => {
    const html = renderToStaticMarkup(
      createElement(MemorySummary, { facts: [candidate, instantCandidate, confirmed], loading: false, error: null, onOpen: noop, onRetry: noop }),
    );
    expect(html).toContain('class="memory-summary"');
    expect(html).toContain("What Otto remembers");
    expect(html).toContain('class="memory-summary-figure"');
    expect(html).toContain('aria-label="1 remembered, 2 waiting for review"');
    expect(html).toContain(">View</button>");
    expect(html).not.toContain("settings-panel");
  });

  it("shows a loading state and an inline retry on failure", () => {
    const loading = renderToStaticMarkup(
      createElement(MemorySummary, { facts: [], loading: true, error: null, onOpen: noop, onRetry: noop }),
    );
    expect(loading).toContain("Loading memory…");
    expect(loading).toContain(">View</button>");
    const failed = renderToStaticMarkup(
      createElement(MemorySummary, { facts: [], loading: false, error: "Load failed", onOpen: noop, onRetry: noop }),
    );
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("Load failed");
    expect(failed).toContain("Retry");
  });
});

describe("MemoryModal", () => {
  it("opens on the review tab with peer tab semantics and the keep decision", () => {
    const html = renderToStaticMarkup(
      createElement(MemoryModal, { facts: [candidate, confirmed], recent: [recent], busy: false, error: null, onReview: noop, onForget: noop, onClose: noop }),
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('id="memory-tab-review"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("Needs review");
    expect(html).toContain("Remembered");
    expect(html).toContain("Waiting for your review");
    expect(html).toContain("Keep");
    expect(html).toContain("Not true");
  });

  it("keeps errors visible inside the dialog", () => {
    const html = renderToStaticMarkup(
      createElement(MemoryModal, { facts: [], recent: [], busy: false, error: "That fact could not be updated.", onReview: noop, onForget: noop, onClose: noop }),
    );
    expect(html).toContain('class="memory-modal-body"');
    expect(html).toContain('role="alert"');
  });
});

describe("Memory sections", () => {
  it("shows candidates for review with keep and reject actions, newest first", () => {
    const oldest: MemoryFact = { ...candidate, id: "old", content: "Oldest proposal.", occurred_at: "2026-09-01T09:00:00.000Z" };
    const newest: MemoryFact = { ...candidate, id: "new", content: "Newest proposal.", occurred_at: "2026-09-20T09:00:00.000Z" };
    const html = renderToStaticMarkup(
      createElement(MemoryReviewSection, { facts: [oldest, candidate, newest], busy: false, onReview: noop }),
    );
    expect(html).toContain('class="memory-section review"');
    expect(html).toContain("Prefers deep work before noon.");
    expect(html).toContain('aria-label="3 waiting for review"');
    expect(html.indexOf("Newest proposal.")).toBeLessThan(html.indexOf("Prefers deep work before noon."));
    expect(html.indexOf("Prefers deep work before noon.")).toBeLessThan(html.indexOf("Oldest proposal."));
    expect(html).not.toContain("settings-panel");
  });

  it("shows confirmed facts with a forget control and calendar-day dates", () => {
    const html = renderToStaticMarkup(
      createElement(MemoryFactsSection, { facts: [confirmed, instantCandidate], busy: false, onForget: noop }),
    );
    expect(html).toContain('class="memory-section facts"');
    expect(html).toContain("Owns checkout reporting.");
    expect(html).toContain("Forget: Owns checkout reporting.");
    expect(html).toContain("Kept September 10");
    expect(html).not.toContain("T00:00:00");
  });

  it("caps the activity feed and explains what activity means", () => {
    const html = renderToStaticMarkup(
      createElement(MemoryActivitySection, { recent: manyRecent, busy: false, onForget: noop }),
    );
    expect(html).toContain('class="memory-section activity"');
    expect((html.match(/class="memory-row"/g) ?? []).length).toBe(8);
    expect(html).toContain("Show all 10");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("never proof that work was completed");
    expect(html).toContain('class="memory-kind"');
  });

  it("renders empty states for every class", () => {
    const review = renderToStaticMarkup(createElement(MemoryReviewSection, { facts: [], busy: false, onReview: noop }));
    expect(review).toContain("Nothing is waiting for your review.");
    const facts = renderToStaticMarkup(createElement(MemoryFactsSection, { facts: [], busy: false, onForget: noop }));
    expect(facts).toContain("No kept facts yet");
    const activity = renderToStaticMarkup(createElement(MemoryActivitySection, { recent: [], busy: false, onForget: noop }));
    expect(activity).toContain("No memories recorded yet");
  });
});
