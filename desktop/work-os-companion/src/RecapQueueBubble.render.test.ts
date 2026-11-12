import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RecapQueueBubble } from "./RecapQueueBubble";

describe("RecapQueueBubble", () => {
  it("names the unapproved queue and offers the View recaps action", () => {
    let requested = false;
    const markup = renderToStaticMarkup(createElement(RecapQueueBubble, { onViewRecaps: () => { requested = true; } }));
    expect(markup).toContain("You have unapproved recaps");
    expect(markup).toContain("Open the recaps tab to review them.");
    expect(markup).toContain("View recaps");
    expect(markup).toContain("avatar-unapproved-bubble");
    expect(requested).toBe(false);
  });
});
