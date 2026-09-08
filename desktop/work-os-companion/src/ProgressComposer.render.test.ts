import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProgressComposer } from "./App";
import type { ProposedOperation, ToolCallResult } from "./interpretation";

const operations: ProposedOperation[] = [
  { op: "complete_task", statement: "Done.", taskId: "t-1", taskTitle: "T", proposalId: "p-1", enabled: false },
  { op: "display_pending_tasks", statement: "Show.", enabled: false },
];

const results: ToolCallResult[] = [
  { op: operations[0]!, status: "recorded", message: "Recorded." },
  {
    op: operations[1]!, status: "recorded", message: "Loaded.",
    data: { provider_result: { view: "pending", tasks: [
      { id: "t-9", title: "Work on the Work OS Review Page", description: "Added from the Work OS daily composer." },
      { id: "t-10", title: "Some random task", description: "Just testing to see if it works" },
    ] } },
  },
];

const noop = () => undefined;

describe("ProgressComposer post-approve state", () => {
  it("renders filed results and selection cards instead of blank content", () => {
    const markup = renderToStaticMarkup(createElement(ProgressComposer, {
      input: "", open: true, panel: "update", pending: "tool calls reviewed", receipt: null, history: [],
      busy: false, required: false, goal: "", goalProvenance: null, goalSuggestion: null, saveState: "saved",
      interpretation: { status: "ready", operations, taskOptions: [], reply: "Done.", results },
      toolContext: { shiftDate: null, personId: null, promptKind: "optional" },
      aiUnavailable: null,
      onInput: noop, onOpen: noop, onOpenGoal: noop, onClose: noop, onSubmit: noop,
      onClassify: noop, onGoal: noop, onAcceptSuggestion: noop,
    }));
    expect(markup).toContain("Tool call results");
    expect(markup).toContain("Pending tasks");
    expect(markup).toContain("Work on the Work OS Review Page");
    expect(markup).toContain("Some random task");
  });
});

describe("ProgressComposer simplified chrome", () => {
  const base = {
    input: "", open: true, panel: "update" as const, pending: "", receipt: null, history: [],
    busy: false, required: false, goal: "", goalProvenance: null, goalSuggestion: null, saveState: "saved" as const,
    onInput: noop, onOpen: noop, onOpenGoal: noop, onClose: noop, onSubmit: noop,
    onClassify: noop, onGoal: noop, onAcceptSuggestion: noop,
  };

  it("offers one new-chat action and no intent strip for a plain update", () => {
    const markup = renderToStaticMarkup(createElement(ProgressComposer, { ...base }));
    expect(markup).toContain("Start a new chat");
    expect(markup).not.toContain("Clear conversation");
    expect(markup).not.toContain("workos-chat-sub");
    expect(markup).not.toContain("Continue the conversation below.");
    expect(markup).toContain("What would you like to record?");
  });

  it("still surfaces the due state when an update is required", () => {
    const markup = renderToStaticMarkup(createElement(ProgressComposer, { ...base, required: true }));
    expect(markup).toContain("An update is due");
  });
});
