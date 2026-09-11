import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatSection, StreamingText } from "./chat/StreamingText";
import { GlideMenu } from "./chat/GlideMenu";
import { ChatTabs } from "./chat/ChatTabs";

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
