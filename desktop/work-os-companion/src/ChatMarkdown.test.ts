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

  it("renders safe links, fenced code, and tables", () => {
    const markup = renderToStaticMarkup(createElement(ChatMarkdown, {
      text: "[Open the runbook](https://example.com/runbook)\n\n```ts\nconst ready = true;\n```\n\n| State | Owner |\n| --- | --- |\n| Ready | Otto |",
    }));
    expect(markup).toContain('href="https://example.com/runbook"');
    expect(markup).toContain('class="chat-markdown-code"');
    expect(markup).toContain("const ready = true;");
    expect(markup).toContain('class="chat-markdown-table"');
    expect(markup).toContain("<th>State</th>");
  });

  it("rejects executable link protocols", () => {
    const markup = renderToStaticMarkup(createElement(ChatMarkdown, { text: "[Do not run](javascript:alert(1))" }));
    expect(markup).not.toContain("href=");
    expect(markup).toContain("Do not run");
  });
});
