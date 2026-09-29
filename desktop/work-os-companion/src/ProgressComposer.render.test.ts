import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { ProgressComposer } from "./App";
import { workOsKeys } from "./queryClient";
import type { ProposedOperation, ToolCallResult } from "./interpretation";
import type { ActivityInterval } from "./types";

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
      onClassify: noop, onApplyGoal: noop,
    }));
    expect(markup).toContain("Action results");
    expect(markup).toContain("Pending tasks");
    expect(markup).toContain("Work on the Work OS Review Page");
    expect(markup).toContain("Some random task");
  });

  it("renders one card when the assistant returns the same task view twice", () => {
    const firstDisplay: ProposedOperation = { op: "display_pending_tasks", statement: "Show.", enabled: false };
    const secondDisplay: ProposedOperation = { op: "display_pending_tasks", statement: "Show again.", enabled: false };
    const duplicated: ToolCallResult[] = [
      {
        op: firstDisplay,
        status: "recorded",
        message: "Loaded.",
        data: { provider_result: { view: "pending", tasks: [{ id: "t-9", title: "Work on the Work OS Review Page" }] } },
      },
      {
        op: secondDisplay,
        status: "recorded",
        message: "Loaded.",
        data: { provider_result: { view: "pending", tasks: [{ id: "t-9", title: "Work on the Work OS Review Page" }] } },
      },
    ];
    const markup = renderToStaticMarkup(createElement(ProgressComposer, {
      input: "", open: true, panel: "update", pending: "tool calls reviewed", receipt: null, history: [],
      busy: false, required: false, goal: "", goalProvenance: null, goalSuggestion: null, saveState: "saved",
      interpretation: { status: "ready", operations: [firstDisplay, secondDisplay], taskOptions: [], reply: "Here you go.", results: duplicated },
      toolContext: { shiftDate: null, personId: null, promptKind: "optional" },
      aiUnavailable: null,
      onInput: noop, onOpen: noop, onOpenGoal: noop, onClose: noop, onSubmit: noop,
      onClassify: noop, onApplyGoal: noop,
    }));
    expect((markup.match(/chat-task-card/g) ?? []).length).toBe(1);
  });
});

describe("ProgressComposer simplified chrome", () => {
  const base = {
    input: "", open: true, panel: "update" as const, pending: "", receipt: null, history: [],
    displayName: "David Zahemen",
    busy: false, required: false, goal: "", goalProvenance: null, goalSuggestion: null, saveState: "saved" as const,
    onInput: noop, onOpen: noop, onOpenGoal: noop, onClose: noop, onSubmit: noop,
    onClassify: noop, onApplyGoal: noop,
  };

  it("offers one new-chat action and no intent strip for a plain update", () => {
    const markup = renderToStaticMarkup(createElement(ProgressComposer, { ...base }));
    expect(markup).toContain("Start a new chat");
    expect(markup).not.toContain("Clear conversation");
    expect(markup).not.toContain("workos-chat-sub");
    expect(markup).not.toContain("Continue the conversation below.");
    expect(markup).toContain("chat-welcome-hero");
    expect(markup).toContain("David");
    expect(markup).not.toContain("chat-mascot-mark");
  });

  it("keeps the thread and composer in the shared bounded edge frame", () => {
    const markup = renderToStaticMarkup(createElement(ProgressComposer, { ...base }));
    expect(markup).toContain('class="conversation-scroll-region"');
  });

  it("renders a compact launcher instead of mounting the full composer when closed", () => {
    const markup = renderToStaticMarkup(createElement(ProgressComposer, { ...base, open: false }));
    expect(markup).toContain("data-conversation-launcher");
    expect(markup).toContain("Share an update");
    expect(markup).not.toContain("progress-input-shell");
    expect(markup).not.toContain("What would you like to record?");
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

describe("ProgressComposer focus panel goal card", () => {
  const focusBase = {
    input: "", open: true, panel: "goal" as const, pending: "", receipt: null, history: [],
    busy: false, required: false, goal: "", goalProvenance: null, goalSuggestion: null, saveState: "saved" as const,
    onInput: noop, onOpen: noop, onOpenGoal: noop, onClose: noop, onSubmit: noop,
    onClassify: noop, onApplyGoal: noop,
  };

  it("shows the editor with an explicit Apply goal when no goal is set", () => {
    const markup = renderToStaticMarkup(createElement(ProgressComposer, { ...focusBase }));
    expect(markup).toContain("daily-focus-input");
    expect(markup).toContain("Apply goal");
    expect(markup).not.toContain("goal-card");
    expect(markup).not.toContain(">Apply<");
  });

  it("shows a goal card with a pen instead of the editor once a goal is set", () => {
    const markup = renderToStaticMarkup(createElement(ProgressComposer, { ...focusBase, goal: "Ship the focus card." }));
    expect(markup).toContain("goal-card");
    expect(markup).toContain("Edit today’s focus");
    expect(markup).toContain("Ship the focus card.");
    expect(markup).not.toContain("daily-focus-input");
    expect(markup).not.toContain("Apply goal");
  });

  it("keeps the Focus panel in the shared scroll region so the goal and activity scroll under the edge fade", () => {
    const markup = renderToStaticMarkup(createElement(ProgressComposer, { ...focusBase }));
    expect(markup).toContain('class="conversation-scroll-region"');
    expect(markup).toContain('class="goal-composer-panel"');
    expect(markup.indexOf('class="conversation-scroll-region"')).toBeLessThan(markup.indexOf('class="goal-composer-panel"'));
  });

  it("keeps the task suggestion in the empty editor and hides it once a goal exists", () => {
    const suggestion = { text: "From today's tasks: ship the focus card.", taskIds: ["preview-task-1"] };
    const empty = renderToStaticMarkup(createElement(ProgressComposer, { ...focusBase, goalSuggestion: suggestion }));
    expect(empty).toContain("Suggested from today’s tasks");
    expect(empty).toContain("Use suggestion");
    expect(empty).toContain("Apply goal");
    const set = renderToStaticMarkup(createElement(ProgressComposer, { ...focusBase, goal: "Ship the focus card.", goalSuggestion: suggestion }));
    expect(set).not.toContain("Suggested from today’s tasks");
  });

  it("offers an inline retry when the goal save is offline or conflicted", () => {
    const markup = renderToStaticMarkup(createElement(ProgressComposer, {
      ...focusBase,
      goal: "Ship the focus card.",
      saveState: "offline" as const,
      onRetryGoalSave: noop,
    }));
    expect(markup).toContain("Retry saving the goal");
    expect(markup).toContain("Queued offline");
  });

  it("lists interval check-ins beneath the goal card when a date is available", () => {
    const interval: ActivityInterval = {
      id: "preview-interval-1",
      windowStart: "2026-09-28T14:17:00.000Z",
      windowEnd: "2026-09-28T15:17:00.000Z",
      label: "2:17–3:17 PM",
      promptKind: "hourly_fallback",
      generationStatus: "ready",
      reviewStatus: "inferred",
      headline: "Implementation and verification in the Work OS codebase",
      detail: "Worked in VS Code with terminal verification.",
      employeeFeedback: null,
      failureReason: null,
      generatedAt: "2026-09-28T15:18:00.000Z",
      reviewedAt: null,
      evidenceExpired: false,
      evidenceCount: 0,
      evidence: [],
    };
    const queryClient = new QueryClient();
    queryClient.setQueryData(workOsKeys.activityIntervals("2026-09-28"), { date: "2026-09-28", intervals: [interval] });
    const markup = renderToStaticMarkup(createElement(QueryClientProvider, { client: queryClient },
      createElement(ProgressComposer, {
        ...focusBase,
        goal: "Ship the focus card.",
        activityDate: "2026-09-28",
        activityTimezone: "UTC",
      }),
    ));
    expect(markup).toContain("Ship the focus card.");
    expect(markup).toContain("Recent activity");
    expect(markup).toContain("Implementation and verification in the Work OS codebase");
    expect(markup.indexOf("Ship the focus card.")).toBeLessThan(markup.indexOf("Recent activity"));
  });
});
