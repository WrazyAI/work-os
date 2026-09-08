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

  it("takes two rows for multi-line drafts or the labeled Focus action", () => {
    expect(isWideDraft("line one\nline two", false)).toBe(true);
    expect(isWideDraft("", true)).toBe(true);
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

  it("keeps repeats separated by other turns and turns carrying proposals", () => {
    const op = { op: "complete_task", statement: "Done." };
    const turns = [
      { role: "assistant", text: "Same words" },
      { role: "user", text: "ok" },
      { role: "assistant", text: "Same words" },
      { role: "assistant", text: "Same words", operations: [op] },
    ];
    // Separated by the user turn, then shielded by attached proposals.
    expect(collapseConsecutiveAssistantDuplicates(turns)).toHaveLength(4);
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
    expect(markup).toContain("workos-send ready");
    expect(markup).toContain('aria-label="Review update type"');
    expect(markup).not.toContain("disabled");
  });

  it("keeps the focus action inside the composer grid", () => {
    const markup = renderToStaticMarkup(
      createElement(WorkOsPromptBar, {
        ...base,
        footerLeft: createElement("button", { className: "focus-dock-button" }, "Focus"),
      }),
    );
    expect(markup).toContain("focus-dock-button");
    expect(markup).toContain("has-footer");
  });
});
