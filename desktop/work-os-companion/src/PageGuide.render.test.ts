import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PageGuide from "./PageGuide";
import { GUIDE_VIEWS } from "./guideState";
import { PAGE_GUIDES } from "./guides";

describe("page guide modal", () => {
  it("renders dialog semantics, interactive steps, phased art, and one primary action", () => {
    const markup = renderToStaticMarkup(createElement(PageGuide, {
      view: "day",
      autoOpen: true,
      onClose: () => undefined,
      onDisableAutoOpen: () => undefined,
    }));
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-labelledby="page-guide-title"');
    expect(markup).toContain('aria-describedby="page-guide-promise"');
    expect(markup).toContain("How My Day works");
    expect(markup).toContain("Your workday in one place");
    expect(markup).toContain('id="page-guide-art"');
    expect(markup).toContain('data-guide-view="day"');
    expect(markup).toContain('data-active-step="0"');
    expect(markup).toContain("guide-phase");
    expect(markup).toContain('aria-hidden="true"');
    expect((markup.match(/class="guide-step-control/g) ?? []).length).toBe(PAGE_GUIDES.day.steps.length);
    expect(markup).toContain('aria-controls="page-guide-art"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("Start with a plan");
    expect(markup).toContain("Got it");
    expect(markup).toContain("show these automatically");
    expect(markup).toContain('aria-label="Close page guide"');
  });

  it("states the opt-out is active instead of offering it again", () => {
    const markup = renderToStaticMarkup(createElement(PageGuide, {
      view: "settings",
      autoOpen: false,
      onClose: () => undefined,
      onDisableAutoOpen: () => undefined,
    }));
    expect(markup).toContain("Automatic guides are off.");
    expect(markup).not.toContain("show these automatically");
  });

  it("renders every guided page without a fallback", () => {
    for (const view of GUIDE_VIEWS) {
      const markup = renderToStaticMarkup(createElement(PageGuide, {
        view,
        autoOpen: true,
        onClose: () => undefined,
        onDisableAutoOpen: () => undefined,
      }));
      expect(markup).toContain(PAGE_GUIDES[view].title);
      expect(markup).toContain(`data-guide-view="${view}"`);
      expect(markup).toContain("guide-phase");
    }
  });
});
