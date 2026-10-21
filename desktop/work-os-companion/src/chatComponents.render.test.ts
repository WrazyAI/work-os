import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatSection, StreamingText } from "./chat/StreamingText";
import { GlideMenu } from "./chat/GlideMenu";
import { ChatTabs } from "./chat/ChatTabs";
import { ChatTimeDivider, ChatTurn } from "./chat/ChatTurn";
import { HistoryTurn } from "./chat/HistoryTurn";

const noop = () => undefined;

describe("ChatSection", () => {
  it("renders a meta line only from the real data it is given", () => {
    const markup = renderToStaticMarkup(
      createElement(ChatSection, {
        label: "Tool call",
        sub: "Progress on",
        time: "2.4s",
        children: createElement("p", null, "Body"),
      }),
    );
    expect(markup).toContain("Tool call");
    expect(markup).toContain("Progress on");
    expect(markup).toContain("2.4s");
    expect(markup).toContain("Body");
  });
});

describe("StreamingText", () => {
  it("exposes the full reply to assistive tech on the first render", () => {
    const markup = renderToStaticMarkup(
      createElement(StreamingText, { text: "Hello there friend", stream: true }),
    );
    expect(markup).toContain("Hello there friend");
    expect(markup).toContain('aria-live="polite"');
    expect(markup).not.toContain("Copy reply");
  });

  it("renders the full reply inline when streaming is off", () => {
    const markup = renderToStaticMarkup(
      createElement(StreamingText, { text: "Settled copy.", stream: false }),
    );
    expect(markup).toContain("Settled copy.");
  });
});

describe("GlideMenu", () => {
  it("shows a specific empty state and the footer hint", () => {
    const markup = renderToStaticMarkup(
      createElement(GlideMenu, {
        rows: [],
        active: 0,
        engaged: false,
        label: "Commands",
        emptyText: "No matches",
        footText: "Type to filter",
        onHoverRow: noop,
        onPick: noop,
      }),
    );
    expect(markup).toContain("No matches");
    expect(markup).toContain("Type to filter");
    expect(markup).toContain('role="listbox"');
  });

  it("connects listbox options to the combobox active descendant", () => {
    const markup = renderToStaticMarkup(
      createElement(GlideMenu, {
        id: "command-menu",
        optionIdPrefix: "command-option",
        rows: [{ key: "focus", name: "/focus", desc: "Open focus" }],
        active: 0,
        engaged: true,
        label: "Commands",
        onHoverRow: noop,
        onPick: noop,
      }),
    );
    expect(markup).toContain('id="command-menu"');
    expect(markup).toContain('id="command-option-0"');
    expect(markup).toContain('role="option"');
  });
});

describe("ChatTabs", () => {
  it("keeps keyboard semantics and the open count", () => {
    const markup = renderToStaticMarkup(
      createElement(ChatTabs, {
        tabs: [
          { id: "chat", label: "Chat" },
          { id: "tasks", label: "Tasks", count: 2 },
        ],
        active: "tasks",
        onSelect: noop,
        ariaLabel: "Companion view",
      }),
    );
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain(">2<");
  });
});

describe("ChatTurn copy and mascot", () => {
  it("reveals a labelled copy control on text bubbles", () => {
    const user = renderToStaticMarkup(createElement(ChatTurn, { role: "user", text: "Show my tasks" }));
    expect(user).toContain("chat-turn-shell is-user");
    expect(user).toContain("chat-copy-row");
    expect(user).toContain('aria-label="Copy message"');
    expect(user).toContain(">Copy<");

    const assistant = renderToStaticMarkup(createElement(ChatTurn, { role: "assistant", text: "Here you go." }));
    expect(assistant).toContain("chat-copy-row");
    expect(assistant).toContain("chat-mascot-mark");
    expect(assistant).not.toContain("lucide-sparkles");

    const clustered = renderToStaticMarkup(createElement(ChatTurn, { role: "assistant", text: "A follow-up.", showMark: false }));
    expect(clustered).toContain("chat-turn-mark is-hidden");
    expect(clustered).not.toContain("chat-mascot-mark");
  });

  it("lets a tool surface own the full turn without the mascot column", () => {
    const tool = renderToStaticMarkup(createElement(ChatTurn, { role: "assistant", variant: "tool" },
      createElement("span", { className: "avatar-thinking" }, "Working card")));
    expect(tool).toContain("chat-turn-shell is-tool");
    expect(tool).toContain("avatar-thinking");
    expect(tool).not.toContain("chat-mascot-mark");
  });

  it("copies card summaries for card-only turns and skips system notices", () => {
    const cardOnly = renderToStaticMarkup(createElement(ChatTurn, {
      role: "assistant",
      copySource: {
        role: "assistant",
        toolResults: [{ op: { op: "complete_task", taskTitle: "Ship the composer" }, status: "recorded", message: "Recorded." }],
      },
    }));
    expect(cardOnly).toContain("chat-copy-row");

    const empty = renderToStaticMarkup(createElement(ChatTurn, { role: "assistant" }));
    expect(empty).not.toContain("chat-copy-row");

    const system = renderToStaticMarkup(createElement(ChatTurn, { role: "system", text: "Offline" }));
    expect(system).not.toContain("chat-copy-row");
  });

  it("keeps a receipt copyable", () => {
    const receipt = renderToStaticMarkup(createElement(ChatTurn, { role: "assistant", receipt: true, text: "Update recorded." }));
    expect(receipt).toContain("chat-receipt");
    expect(receipt).toContain("chat-copy-row");
  });

  it("renders turn-specific actions beside copy, and alone when there is nothing to copy", () => {
    const action = createElement("button", { type: "button", className: "chat-turn-action" }, "All recaps");
    const withCopy = renderToStaticMarkup(createElement(ChatTurn, { role: "assistant", text: "Here is your recap.", actions: action }));
    expect(withCopy).toContain("chat-copy-row");
    expect(withCopy).toContain('aria-label="Copy message"');
    expect(withCopy).toContain("chat-turn-action");
    expect(withCopy).toContain("All recaps");

    const actionOnly = renderToStaticMarkup(createElement(ChatTurn, { role: "assistant", actions: action }));
    expect(actionOnly).toContain("chat-copy-row");
    expect(actionOnly).toContain("All recaps");
    expect(actionOnly).not.toContain('aria-label="Copy message"');

    const plain = renderToStaticMarkup(createElement(ChatTurn, { role: "assistant", text: "Just text." }));
    expect(plain).not.toContain("chat-turn-action");
  });
});

describe("ChatTurn timing", () => {
  it("reveals the agent's local time rightmost in the hover row", () => {
    const markup = renderToStaticMarkup(createElement(ChatTurn, {
      role: "assistant",
      text: "Here you go.",
      actions: createElement("button", { type: "button", className: "chat-turn-action" }, "All recaps"),
      timestamp: "2026-10-12T17:48:00Z",
    }));
    expect(markup).toContain('class="chat-turn-time"');
    expect(markup).toContain('dateTime="2026-10-12T17:48:00Z"');
    expect(markup.indexOf("chat-turn-time")).toBeGreaterThan(markup.indexOf("chat-turn-action"));
    expect(markup).toMatch(/>(?:1[0-2]|[1-9]):[0-5]\d(?: |\u202f)(?:AM|PM)</);
  });

  it("never times an employee bubble, even when it carries a recorded time", () => {
    const markup = renderToStaticMarkup(createElement(ChatTurn, { role: "user", text: "Show my tasks", timestamp: "2026-10-12T17:48:00Z" }));
    expect(markup).toContain("chat-copy-row");
    expect(markup).not.toContain("chat-turn-time");
  });

  it("shows no clock when the turn has no recorded time", () => {
    const markup = renderToStaticMarkup(createElement(ChatTurn, { role: "assistant", text: "Settled copy." }));
    expect(markup).not.toContain("chat-turn-time");
  });

  it("renders the centered session divider from the recorded time", () => {
    const markup = renderToStaticMarkup(createElement(ChatTimeDivider, { at: "2026-10-12T17:48:00Z", now: new Date("2026-10-12T20:00:00Z") }));
    expect(markup).toContain('class="chat-time-divider"');
    expect(markup).toContain('dateTime="2026-10-12T17:48:00Z"');
    expect(markup).toMatch(/(?:AM|PM)</);
    expect(renderToStaticMarkup(createElement(ChatTimeDivider, { at: null }))).toBe("");
  });
});

describe("HistoryTurn", () => {
  it("renders persisted cards, approvals, and a copy payload", () => {
    const turn = {
      id: "a-1",
      role: "assistant" as const,
      text: "Review these before anything changes.",
      createdAt: "2026-10-12T17:48:00Z",
      operations: [{ op: "complete_task" as const, statement: "Done.", taskTitle: "Repair provider sync", proposalId: "p-1", enabled: false }],
      toolResults: [{
        op: { op: "display_pending_tasks" as const, statement: "Show.", enabled: false },
        status: "recorded" as const,
        message: "Loaded.",
        data: { provider_result: { view: "pending" as const, tasks: [{ id: "t-1", title: "Harden task fallback copy", state: "pending" }] } },
      }],
    };
    const markup = renderToStaticMarkup(createElement(HistoryTurn, { turn }));
    // The card survives in history (this is what vanished on reload before).
    expect(markup).toContain("Pending tasks");
    expect(markup).toContain("Harden task fallback copy");
    // The approval action is reachable from the persisted turn.
    expect(markup).toContain("Action 1 of 1");
    // And the copy control carries prose plus the card summary.
    expect(markup).toContain("chat-copy-row");
    expect(markup).toContain("Review these before anything changes.");
    // The persisted createdAt feeds the hover clock.
    expect(markup).toContain("chat-turn-time");
  });

  it("never renders a task card for a recorded result's provider row", () => {
    // Production shape: a filed completion returns the proposal row, whose
    // provider_result is an object (jsonb default '{}'). Treating that as a
    // task view rendered an empty "No pending tasks" card after every record.
    const turn = {
      id: "a-2",
      role: "assistant" as const,
      text: "Recorded your update.",
      operations: [{ op: "complete_task" as const, statement: "Done.", taskTitle: "Repair provider sync", proposalId: "p-2", enabled: false }],
      toolResults: [{
        op: { op: "complete_task" as const, statement: "Done.", proposalId: "p-2", enabled: false },
        status: "recorded" as const,
        message: "Recorded. Provider confirmation follows the normal sync state.",
        data: { provider_result: {} },
      }],
    };
    const markup = renderToStaticMarkup(createElement(HistoryTurn, { turn }));
    expect(markup).not.toContain("Pending tasks");
    expect(markup).not.toContain("No pending tasks");
    // Exactly one summary: ApprovalFlow must not fall back to a second
    // ApprovalResults now that every mutating operation has a result.
    expect(markup.match(/class="approval-results"/g) ?? []).toHaveLength(1);
  });

  it("renders the recap next-steps moment from the shared conversation", () => {
    const turn = {
      id: "next-steps-interval-1",
      role: "assistant" as const,
      text: "Recap confirmed — while it's fresh, here's what could come next:",
      nextSteps: {
        intervalId: "interval-1",
        label: "2:17–3:17 PM",
        status: "ready" as const,
        items: [
          { proposalId: "p-1", operation: "complete_task" as const, status: "pending", title: "Wire GitHub context", rationale: "The tests pass.", taskId: "task-1", editable: false },
          { proposalId: "p-2", operation: "create_task" as const, status: "pending", title: "Deploy the recap release", rationale: "A concrete deliverable.", taskId: null, editable: true },
        ],
        states: {},
        failures: {},
      },
    };
    const markup = renderToStaticMarkup(createElement(HistoryTurn, { turn }));
    expect(markup).toContain("chat-next-steps");
    expect(markup).toContain("From your 2:17–3:17 PM recap");
    expect(markup).toContain("Wire GitHub context");
    expect(markup).toContain("Mark done");
    expect(markup).toContain("Add task");
    expect(markup).toContain("Edit");
  });
});
