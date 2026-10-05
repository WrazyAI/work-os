import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AvatarPromptBubble } from "./AvatarPromptBubble";

const noop = () => undefined;

describe("AvatarPromptBubble", () => {
  it("renders the EOD prompt with its direct review action", () => {
    const markup = renderToStaticMarkup(createElement(AvatarPromptBubble, {
      kind: "eod",
      heading: "EOD review is due",
      compact: "Open EOD review to prepare and submit your report.",
      onOpen: noop,
      onAction: noop,
    }));
    expect(markup).toContain("EOD review is due");
    expect(markup).toContain("Open EOD review to prepare and submit your report.");
    expect(markup).toContain("avatar-prompt-action");
    expect(markup).toContain("avatar-prompt-open");
  });

  it("renders the agenda prompt with the goal action", () => {
    const markup = renderToStaticMarkup(createElement(AvatarPromptBubble, {
      kind: "agenda",
      heading: "What are you working on today?",
      compact: "Set today's focus.",
      onOpen: noop,
      onAction: noop,
    }));
    expect(markup).toContain("What are you working on today?");
    expect(markup).toContain("Set today");
    expect(markup).toContain("goal");
    expect(markup).toContain("avatar-prompt-action");
  });

  it("omits the action for prompts without a direct destination", () => {
    const markup = renderToStaticMarkup(createElement(AvatarPromptBubble, {
      kind: "check_in",
      heading: "Check-in due",
      compact: "Tell Work OS what changed.",
      onOpen: noop,
      onAction: noop,
    }));
    expect(markup).toContain("Check-in due");
    expect(markup).not.toContain("avatar-prompt-action");
  });
});
