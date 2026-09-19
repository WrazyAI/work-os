import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConversationSurface } from "./ConversationSurface";

describe("ConversationSurface", () => {
  it("provides one semantic root for each delivery surface", () => {
    const markup = renderToStaticMarkup(createElement(ConversationSurface, {
      surface: "floating",
      open: false,
      ariaLabel: "Otto companion",
      className: "preview-shell",
      children: createElement("span", null, "Conversation"),
    }));

    expect(markup).toContain('data-conversation-surface="floating"');
    expect(markup).toContain('data-conversation-open="false"');
    expect(markup).toContain('aria-label="Otto companion"');
    expect(markup).toContain("preview-shell");
    expect(markup).toContain("Conversation");
  });
});
