import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AvatarThinking } from "./AvatarThinking";

const stages = [{ label: "Reading today's context" }, { label: "Matching tasks", detail: "4 open" }];

describe("AvatarThinking", () => {
  it("shows only started stages while working", () => {
    const html = renderToStaticMarkup(
      createElement(AvatarThinking, { stages, active: 0, startedAt: Date.now() }),
    );
    expect(html).toContain("Thinking");
    expect(html).toContain('data-workos-tool-surface="thinking"');
    expect(html).toContain("Reading today&#x27;s context");
    expect(html).not.toContain("Matching tasks");
    expect(html).toContain("aria-expanded=\"true\"");
  });

  it("settles to a collapsed receipt with the honest outcome", () => {
    const html = renderToStaticMarkup(
      createElement(AvatarThinking, { stages, active: -1, startedAt: 0, settledMs: 2400, result: "Reviewed 4 tasks" }),
    );
    expect(html).toContain("Thought for 2.4s");
    expect(html).toContain("Reviewed 4 tasks");
    expect(html).toContain("aria-expanded=\"false\"");
  });
});
