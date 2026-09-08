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

  it("shows the live thinking trace while the interpretation is loading", () => {
    const markup = renderToStaticMarkup(createElement(ProgressComposer, {
      ...base,
      pending: "checking something",
      interpretation: { status: "loading", operations: [], taskOptions: [] },
      thinking: { stages: [{ label: "Sending your update" }, { label: "Filing proposals" }], active: 1, startedAt: Date.now() - 1800 },
    }));
    expect(markup).toContain("Thinking");
    expect(markup).toContain("Sending your update");
    expect(markup).toContain("Filing proposals");
    expect(markup).not.toContain("Reading your update…");
  });

  it("collapses consecutive duplicate assistant turns and echo replies", () => {
    const history = [
      { id: "h-1", role: "user" as const, text: "What's your name?", createdAt: "2026-09-08T00:00:00Z" },
      { id: "h-2", role: "assistant" as const, text: "I'm your Work OS assistant.", createdAt: "2026-09-08T00:01:00Z" },
      { id: "h-3", role: "assistant" as const, text: "I'm your Work OS assistant.", createdAt: "2026-09-08T00:02:00Z" },
    ];
    const markup = renderToStaticMarkup(createElement(ProgressComposer, {
      ...base,
      pending: "What's your name?",
      history,
      interpretation: { status: "ready", operations: [], taskOptions: [], reply: "I'm your Work OS assistant." },
    }));
    expect(markup.match(/I&#x27;m your Work OS assistant\./g)?.length ?? 0).toBe(1);
  });
});
