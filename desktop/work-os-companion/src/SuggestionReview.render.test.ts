import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SuggestionCard, SuggestionReviewBand, SuggestionReviewModal, suggestionActions, suggestionCounts, suggestionStatusMeta, suggestionTitle } from "./SuggestionReview";
import type { PendingSuggestion } from "./types";

const noop = () => undefined;

function proposal(overrides: Partial<PendingSuggestion> = {}): PendingSuggestion {
  return {
    id: "p1",
    operation: "add_subtask",
    status: "pending",
    input_text: "Just do whatever man, I want it in batch.",
    proposed_change: { name: "Capture three takeaways", description: "Write down three useful things learned." },
    failure_reason: null,
    created_at: "2026-10-07T09:00:00.000Z",
    source_interval_id: null,
    task: null,
    ...overrides,
  };
}

describe("suggestion helpers", () => {
  it("labels each status and picks the one decision set", () => {
    expect(suggestionStatusMeta("pending").label).toBe("Waiting");
    expect(suggestionStatusMeta("failed").label).toBe("Didn't apply");
    expect(suggestionStatusMeta("stale").label).toBe("Outdated");
    expect(suggestionActions("pending")).toEqual({ reject: "Reject", accept: "Approve" });
    expect(suggestionActions("failed")).toEqual({ reject: "Dismiss", accept: "Try again" });
    expect(suggestionActions("stale")).toEqual({ reject: "Dismiss", accept: null });
  });

  it("titles a proposal from its change, falling back to the statement", () => {
    expect(suggestionTitle(proposal())).toBe("Capture three takeaways");
    expect(suggestionTitle(proposal({ proposed_change: {}, input_text: "Ship the fix" }))).toBe("Ship the fix");
  });

  it("counts waiting and attention items", () => {
    expect(suggestionCounts([proposal(), proposal({ id: "p2", status: "failed" }), proposal({ id: "p3", status: "stale" })])).toEqual({ waiting: 1, attention: 2 });
  });
});

describe("SuggestionReviewBand", () => {
  it("renders the counts and the one Review action", () => {
    const html = renderToStaticMarkup(createElement(SuggestionReviewBand, {
      suggestions: [proposal(), proposal({ id: "p2", status: "failed" })],
      loading: false,
      error: null,
      onOpen: noop,
      onRetry: noop,
    }));
    expect(html).toContain("Suggestions waiting for review");
    expect(html).toContain('aria-label="1 waiting, 1 need attention"');
    expect(html).toContain(">Review</button>");
    expect(html).not.toContain("settings-panel");
  });

  it("shows a loading state and an inline retry on failure", () => {
    const loading = renderToStaticMarkup(createElement(SuggestionReviewBand, { suggestions: [], loading: true, error: null, onOpen: noop, onRetry: noop }));
    expect(loading).toContain("Loading suggestions…");
    const failed = renderToStaticMarkup(createElement(SuggestionReviewBand, { suggestions: [], loading: false, error: "Load failed", onOpen: noop, onRetry: noop }));
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("Load failed");
  });
});

describe("SuggestionCard", () => {
  it("offers approve and reject on a waiting suggestion", () => {
    const html = renderToStaticMarkup(createElement(SuggestionCard, { proposal: proposal(), busy: false, onDecide: noop }));
    expect(html).toContain("Add subtask");
    expect(html).toContain("Capture three takeaways");
    expect(html).toContain("Just do whatever man");
    expect(html).toContain("Description");
    expect(html).toContain("Approve");
    expect(html).toContain("Reject");
  });

  it("offers a retry and the failure reason on a failed suggestion", () => {
    const html = renderToStaticMarkup(createElement(SuggestionCard, {
      proposal: proposal({ status: "failed", failure_reason: "The provider rejected the subtask." }),
      busy: false,
      onDecide: noop,
    }));
    expect(html).toContain("Didn&#x27;t apply");
    expect(html).toContain("Try again");
    expect(html).toContain("The provider rejected the subtask.");
  });

  it("dismisses an outdated suggestion without an approve", () => {
    const html = renderToStaticMarkup(createElement(SuggestionCard, { proposal: proposal({ status: "stale" }), busy: false, onDecide: noop }));
    expect(html).toContain("Outdated");
    expect(html).toContain("Dismiss");
    expect(html).not.toContain("Approve");
    expect(html).toContain("The task changed after this was drafted");
  });
});

describe("SuggestionReviewModal", () => {
  it("groups waiting and attention items under one dialog", () => {
    const html = renderToStaticMarkup(createElement(SuggestionReviewModal, {
      suggestions: [proposal(), proposal({ id: "p2", status: "failed", failure_reason: "The workspace was unreachable." })],
      busyId: null,
      error: null,
      onDecide: noop,
      onClose: noop,
    }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain("Suggestion review");
    expect(html).toContain("Waiting for your decision");
    expect(html).toContain("Couldn");
    expect(html).toContain("The workspace was unreachable.");
  });

  it("renders an honest empty state and keeps errors visible", () => {
    const empty = renderToStaticMarkup(createElement(SuggestionReviewModal, { suggestions: [], busyId: null, error: null, onDecide: noop, onClose: noop }));
    expect(empty).toContain("Nothing is waiting");
    const failed = renderToStaticMarkup(createElement(SuggestionReviewModal, { suggestions: [proposal()], busyId: null, error: "That suggestion could not be updated.", onDecide: noop, onClose: noop }));
    expect(failed).toContain('role="alert"');
  });
});
