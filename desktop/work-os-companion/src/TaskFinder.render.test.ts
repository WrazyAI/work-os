import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TaskFinderResults } from "./TaskFinderResults";

describe("task finder results", () => {
  const base = { tasks: [], currentDate: "2026-11-11", loading: false, error: false, filtered: false, total: 0, hasMore: false, loadingMore: false, loadMoreError: false, onRetry: () => {}, onReset: () => {}, onLoadMore: () => {}, onOpen: () => {} };
  it("distinguishes initial load, no matches, and failure with usable recovery", () => {
    expect(renderToStaticMarkup(React.createElement(TaskFinderResults, { ...base, loading: true }))).toContain('aria-label="Loading tasks"');
    expect(renderToStaticMarkup(React.createElement(TaskFinderResults, { ...base, filtered: true }))).toContain("Reset filters");
    expect(renderToStaticMarkup(React.createElement(TaskFinderResults, { ...base, error: true }))).toContain("Try again");
  });
  it("renders task opening separately from editing and states the full filtered count", () => {
    const html = renderToStaticMarkup(React.createElement(TaskFinderResults, { ...base, total: 73, hasMore: true, tasks: [{ id: "1", title: "Integration evidence", due_date: "2026-11-10", workflow_status: "in_progress" }] }));
    expect(html).toContain("Integration evidence");
    expect(html).toContain("Overdue");
    expect(html).toContain("Showing 1 of 73");
    expect(html).toContain("Load more");
    expect(html).not.toContain("Mark complete");
  });
});
