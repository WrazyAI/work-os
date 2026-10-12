import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ChatTabs,
  WORK_OS_CHAT_SOURCES,
  WorkOsPromptBar,
  collapseConsecutiveAssistantDuplicates,
  isWideDraft,
  parseChatToken,
  workOsChatCommands,
} from "./WorkOsChat";

const noop = () => undefined;

describe("parseChatToken", () => {
  it("detects a trailing @ mention", () => {
    expect(parseChatToken("@task")).toEqual({ kind: "at", query: "task", start: 0 });
    expect(parseChatToken("show @Today")).toEqual({ kind: "at", query: "today", start: 5 });
  });

  it("detects a trailing / command", () => {
    expect(parseChatToken("/eod")).toEqual({ kind: "slash", query: "eod", start: 0 });
  });

  it("ignores tokens that are not being typed last", () => {
    expect(parseChatToken("hello @tasks today")).toBeNull();
    expect(parseChatToken("plain text")).toBeNull();
    expect(parseChatToken("@tasks ")).toBeNull();
  });
});

describe("Work OS chat catalogs", () => {
  it("names only data the assistant can already see", () => {
    const names = WORK_OS_CHAT_SOURCES.map((source) => source.name);
    expect(names).toEqual(
      expect.arrayContaining(["Today's tasks", "Today's focus", "EOD review", "Evidence", "Day summary"]),
    );
  });

  it("offers the Loom link as a mention that inserts the link prefix", () => {
    const loom = WORK_OS_CHAT_SOURCES.find((source) => source.key === "loom");
    expect(loom?.name).toBe("Loom link");
    expect(loom?.insert).toBe("Loom: ");
    expect(loom?.desc).toMatch(/recording/i);
  });

  it("prefaces text commands instead of claiming execution", () => {
    const commands = workOsChatCommands();
    expect(commands.find((command) => command.key === "progress")?.insert).toBe("Progress: ");
    expect(commands.find((command) => command.key === "tasks")?.insert).toBe(
      "Show my pending tasks ",
    );
  });

  it("attaches real navigation to /eod and /focus overrides", () => {
    const run = vi.fn();
    const commands = workOsChatCommands({ eod: run });
    expect(commands.find((command) => command.key === "eod")?.run).toBe(run);
  });
});

describe("isWideDraft", () => {
  it("stays in one compact row for single-line drafts without footer actions", () => {
    expect(isWideDraft("", false)).toBe(false);
    expect(isWideDraft("a long single line that will wrap visually", false)).toBe(false);
  });

  it("takes two rows only when the draft needs more room", () => {
    expect(isWideDraft("line one\nline two", false)).toBe(true);
    expect(isWideDraft("", true)).toBe(false);
    expect(isWideDraft("Progress: shipped the new flow", true)).toBe(true);
  });
});

describe("collapseConsecutiveAssistantDuplicates", () => {
  it("drops later repeats of the same assistant text", () => {
    const turns = [
      { role: "assistant", text: "Hi David — how can I help?" },
      { role: "user", text: "What's your name?" },
      { role: "assistant", text: "I'm your Work OS assistant." },
      { role: "assistant", text: "I'm your Work OS assistant." },
    ];
    const visible = collapseConsecutiveAssistantDuplicates(turns);
    expect(visible.map((turn) => turn.text)).toEqual([
      "Hi David — how can I help?",
      "What's your name?",
      "I'm your Work OS assistant.",
    ]);
  });

  it("keeps repeats separated by other turns and repeats with different cards", () => {
    const op = { op: "complete_task", statement: "Done.", taskId: "t-1" };
    const other = { op: "complete_task", statement: "Done.", taskId: "t-2" };
    const turns = [
      { role: "assistant", text: "Same words" },
      { role: "user", text: "ok" },
      { role: "assistant", text: "Same words" },
      { role: "assistant", text: "Same words", operations: [op] },
    ];
    // Separated by the user turn, then carrying cards the earlier copy lacks.
    expect(collapseConsecutiveAssistantDuplicates(turns)).toHaveLength(4);
    // Same sentence but different work stays visible too.
    expect(collapseConsecutiveAssistantDuplicates([
      { role: "assistant", text: "Review these", operations: [op] },
      { role: "assistant", text: "Review these", operations: [other] },
    ])).toHaveLength(2);
  });

  it("heals stored double-saves that carry identical cards", () => {
    const operations = [{ op: "display_pending_tasks", statement: "Show.", proposalId: "p-1" }];
    const toolResults = [{ op: operations[0], status: "recorded", message: "Loaded.", data: { provider_result: { view: "pending", tasks: [{ id: "t-1" }] } } }];
    const turns = [
      { role: "assistant", text: "Review the selected task completions before anything changes.", operations, toolResults },
      { role: "assistant", text: "Review the selected task completions before anything changes.", operations, toolResults },
    ];
    // The live turn and its persisted twin used to both render; the identical
    // card signature now collapses the repeat.
    expect(collapseConsecutiveAssistantDuplicates(turns)).toHaveLength(1);
  });

  it("keeps two different next-steps moments visible even with the same lead sentence", () => {
    const moment = (intervalId: string, status: "ready" | "done") => ({
      intervalId,
      label: "2:05–2:10 PM",
      status,
      items: [{ proposalId: `${intervalId}-1`, operation: "create_task", status: "applied", title: "Verify Console MCP enablement", rationale: "Reviewed.", taskId: null, editable: true }],
      states: status === "done" ? { [`${intervalId}-1`]: "applied" } : {},
      failures: {},
    });
    const lead = "Recap confirmed — while it's fresh, here's what could come next:";
    const turns = [
      { role: "assistant", text: lead, nextSteps: moment("interval-old", "done") },
      { role: "assistant", text: lead, nextSteps: moment("interval-new", "ready") },
    ];
    // The newer moment must never vanish behind the older card: the same lead
    // sentence is not a duplicate when the moment payload differs.
    expect(collapseConsecutiveAssistantDuplicates(turns)).toHaveLength(2);
  });

  it("still collapses the identical moment saved twice", () => {
    const moment = {
      intervalId: "interval-1",
      label: "2:05–2:10 PM",
      status: "ready" as const,
      items: [{ proposalId: "p-1", operation: "create_task" as const, status: "pending", title: "Verify Console MCP enablement", rationale: "Reviewed.", taskId: null, editable: true }],
      states: {},
      failures: {},
    };
    const lead = "Recap confirmed — while it's fresh, here's what could come next:";
    expect(collapseConsecutiveAssistantDuplicates([
      { role: "assistant", text: lead, nextSteps: moment },
      { role: "assistant", text: lead, nextSteps: moment },
    ])).toHaveLength(1);
  });

  it("keeps same prose when the rendered card payload differs", () => {
    const operations = [{ op: "display_pending_tasks", statement: "Show." }];
    const makeResult = (id: string) => [{
      op: { op: "display_pending_tasks", statement: "Show." },
      status: "recorded",
      data: { provider_result: { view: "pending", tasks: [{ id, title: "Same title" }] } },
    }];
    const turns = [
      { role: "assistant" as const, text: "Review these", operations, toolResults: makeResult("t-1") },
      { role: "assistant" as const, text: "Review these", operations, toolResults: makeResult("t-2") },
    ];
    expect(collapseConsecutiveAssistantDuplicates(turns)).toHaveLength(2);
  });
});

describe("ChatTabs", () => {
  it("marks the active view without relying on color alone", () => {
    const markup = renderToStaticMarkup(
      createElement(ChatTabs, {
        tabs: [
          { id: "update", label: "Update" },
          { id: "goal", label: "Focus" },
        ],
        active: "goal",
        onSelect: noop,
        ariaLabel: "Composer view",
      }),
    );
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain("Focus");
  });

  it("announces open-task counts on the avatar Tasks tab", () => {
    const markup = renderToStaticMarkup(
      createElement(ChatTabs, {
        tabs: [
          { id: "chat", label: "Chat" },
          { id: "tasks", label: "Tasks", count: 3 },
        ],
        active: "chat",
        onSelect: noop,
        ariaLabel: "Companion view",
      }),
    );
    expect(markup).toContain(">3<");
  });
});

describe("WorkOsPromptBar", () => {
  const base = {
    value: "",
    onChange: noop,
    onSend: noop,
    placeholder: "Share an update or add a task…",
    ariaLabel: "Share an update or add a task",
    canSend: false,
  };

  it("renders real controls with accessible names", () => {
    const markup = renderToStaticMarkup(createElement(WorkOsPromptBar, { ...base }));
    expect(markup).toContain("Add Work OS context and commands");
    expect(markup).toContain('aria-label="Send"');
    expect(markup).toContain("Share an update or add a task…");
    expect(markup).toContain("disabled");
  });

  it("arms the send control when the parent allows it", () => {
    const markup = renderToStaticMarkup(
      createElement(WorkOsPromptBar, { ...base, canSend: true, sendLabel: "Review update type" }),
    );
    expect(markup).toContain("bg-ink");
    expect(markup).toContain('aria-label="Review update type"');
    expect(markup).not.toContain('disabled=""');
  });

  it("keeps an empty composer compact even with the focus action", () => {
    const markup = renderToStaticMarkup(
      createElement(WorkOsPromptBar, {
        ...base,
        footerLeft: createElement("button", { className: "focus-dock-button" }, "Focus"),
      }),
    );
    expect(markup).toContain("focus-dock-button");
    expect(markup).toContain("grid-cols-[36px_minmax(0,1fr)_auto_36px]");
    expect(markup).not.toContain("grid-cols-[36px_auto_minmax(0,1fr)_36px]");
  });

  it("moves the focus action below a non-empty draft", () => {
    const markup = renderToStaticMarkup(
      createElement(WorkOsPromptBar, {
        ...base,
        value: "Progress: shipped the new flow",
        footerLeft: createElement("button", { className: "focus-dock-button" }, "Focus"),
      }),
    );
    expect(markup).toContain("grid-cols-[36px_auto_minmax(0,1fr)_36px]");
  });

  it("exposes combobox semantics and a replayable settle sweep", () => {
    const markup = renderToStaticMarkup(createElement(WorkOsPromptBar, { ...base, value: "/f" }));
    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('aria-autocomplete="list"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("aria-controls=");

    const swept = renderToStaticMarkup(createElement(WorkOsPromptBar, { ...base, sweepSignal: 2 }));
    expect(swept).toContain("chat-composer-sweep");
  });
});
