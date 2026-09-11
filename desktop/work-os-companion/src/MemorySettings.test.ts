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
