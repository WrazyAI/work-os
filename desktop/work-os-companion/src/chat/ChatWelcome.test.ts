import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatWelcome, firstNameFromDisplayName, getChatWelcomeCopy } from "./ChatWelcome";

describe("ChatWelcome", () => {
  it("uses the employee's first name and keeps copy stable for a seed", () => {
    expect(firstNameFromDisplayName("  David Zahemen ")).toBe("David");
    const first = getChatWelcomeCopy({ displayName: "David Zahemen", seed: "in-app:2026-09-20" });
    const second = getChatWelcomeCopy({ displayName: "David Zahemen", seed: "in-app:2026-09-20" });
    expect(first).toEqual(second);
    expect(first.title).toContain("David");
  });

  it("renders a text-only hero and falls back cleanly without a name", () => {
    const named = renderToStaticMarkup(createElement(ChatWelcome, { displayName: "Jamie Mensah", seed: "floating:2026-09-20" }));
    const anonymous = renderToStaticMarkup(createElement(ChatWelcome, { displayName: "  ", seed: "floating:2026-09-20" }));
    expect(named).toContain("Jamie");
    expect(named).toContain("chat-welcome-hero");
    expect(named).not.toContain("chat-mascot-mark");
    expect(anonymous).not.toContain("undefined");
    expect(anonymous).not.toContain(", ?");
  });

  it("uses planning language for agenda mode", () => {
    const markup = renderToStaticMarkup(createElement(ChatWelcome, { displayName: "Jamie Mensah", mode: "agenda", seed: "in-app:2026-09-20" }));
    expect(markup).toContain("agenda-welcome");
    expect(markup).toContain("Jamie");
    expect(markup).not.toContain("blocked");
  });
});
