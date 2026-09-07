import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatMarkdown } from "./ChatMarkdown";

describe("ChatMarkdown", () => {
  it("renders headings, lists, and inline emphasis without HTML parsing", () => {
    const markup = renderToStaticMarkup(createElement(ChatMarkdown, {
      text: "## Today\n- **Fix** the crash\n- Ship `build`",
    }));
    expect(markup).toContain("<ul>");
    expect(markup).toContain("<li>");
    expect(markup).toContain("<strong>Fix</strong>");
    expect(markup).toContain("<code>build</code>");
    expect(markup).not.toContain("<script>");
  });

  it("keeps hostile markup as inert text", () => {
    const markup = renderToStaticMarkup(createElement(ChatMarkdown, { text: "<script>alert(1)</script>" }));
    expect(markup).toContain("&lt;script&gt;");
  });
});
