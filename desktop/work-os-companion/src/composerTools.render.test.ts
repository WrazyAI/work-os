import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ProgressComposer } from "./App";

const base = {
  input: "",
  open: true,
  panel: "update" as const,
  pending: "show my tasks",
  receipt: null,
  history: [],
  onClearChat: () => undefined,
  busy: false,
  required: false,
  goal: "",
  goalProvenance: null as null,
  goalSuggestion: null,
  saveState: "saved" as const,
  onInput: () => undefined,
  onOpen: () => undefined,
  onOpenGoal: () => undefined,
  onClose: () => undefined,
  onSubmit: () => undefined,
  onClassify: () => undefined,
  onGoal: () => undefined,
  onAcceptSuggestion: () => undefined,
};

describe("ProgressComposer tool rendering", () => {
  it("renders mixed approval-free and approval-gated ops without going blank", () => {
    const markup = renderToStaticMarkup(createElement(ProgressComposer, {
      ...base,
      interpretation: {
        status: "ready",
        taskOptions: [],
        reply: "Here are your tasks.",
        operations: [
          { op: "display_pending_tasks", statement: "Show pending.", limit: 5, enabled: false },
          { op: "navigate_to_page", statement: "Open review.", page: "review", enabled: false },
          { op: "complete_task", statement: "Finish it.", taskId: "t-1", proposalId: "p-1", enabled: true },
        ],
      },
    }));
    expect(markup.length).toBeGreaterThan(500);
    expect(markup).toContain("Review assistant tool calls");
    expect(markup).not.toContain("Assistant shortcuts");
    expect(markup).toContain("navigate-button");
    expect(markup).toContain("Open Review &amp; EOD");
    expect(markup).toContain("Review assistant tool calls");
  });

  it("renders fetched task selections inline with results", () => {
    const displayOp = { op: "display_pending_tasks" as const, statement: "Show pending.", limit: 5, enabled: false };
    const markup = renderToStaticMarkup(createElement(ProgressComposer, {
      ...base,
      interpretation: {
        status: "ready",
        taskOptions: [],
        reply: "Here are your tasks.",
        operations: [displayOp],
        results: [{
          op: displayOp,
          status: "recorded",
          message: "Pending tasks loaded.",
          data: { provider_result: { view: "pending", tasks: [{ id: "t-1", title: "Fix the crash", due_date: null }] } },
        }],
      },
    }));
    expect(markup).toContain("Pending tasks");
    expect(markup).toContain("Fix the crash");
    expect(markup).toContain("Mark selected done");
    expect(markup).toContain("Select one or more tasks to continue.");
    expect(markup).not.toContain("tool-approval-card");
  });

  it("surfaces display fetch failures without blanking", () => {
    const displayOp = { op: "display_overdue_tasks" as const, statement: "Show overdue.", enabled: false };
    const markup = renderToStaticMarkup(createElement(ProgressComposer, {
      ...base,
      interpretation: {
        status: "ready",
        taskOptions: [],
        operations: [displayOp],
        results: [{ op: displayOp, status: "failed", message: "The task list could not be loaded." }],
      },
    }));
    expect(markup).toContain("The task list could not be loaded.");
  });
});
