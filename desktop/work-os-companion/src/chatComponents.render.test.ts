import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatSection, StreamingText } from "./chat/StreamingText";
import { GlideMenu } from "./chat/GlideMenu";
import { ChatTabs } from "./chat/ChatTabs";
import { ChatTurn } from "./chat/ChatTurn";
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
});

describe("HistoryTurn", () => {
  it("renders persisted cards, approvals, and a copy payload", () => {
    const turn = {
      id: "a-1",
      role: "assistant" as const,
      text: "Review these before anything changes.",
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
});
