import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppearanceSettings } from "./AppearanceSettings";

const noop = () => undefined;

describe("AppearanceSettings", () => {
  const markup = renderToStaticMarkup(createElement(AppearanceSettings, { textSize: "medium", mascotSize: "small", onTextSize: noop, onMascotSize: noop }));

  it("renders both preference rows in a Reading & display group", () => {
    expect(markup).toContain('aria-labelledby="settings-display-title"');
    expect(markup).toContain("Reading &amp; display");
    expect(markup).toContain("Text size");
    expect(markup).toContain("Mascot size");
  });

  it("exposes each preference as a labelled radio group of two options", () => {
    expect(markup.match(/role="radiogroup"/g) ?? []).toHaveLength(2);
    expect(markup.match(/role="radio"/g) ?? []).toHaveLength(4);
    expect(markup).toContain('aria-label="Text size"');
    expect(markup).toContain('aria-label="Mascot size"');
  });

  it("marks the selected option checked and keeps the other out of the tab order", () => {
    expect(markup).toMatch(/data-value="medium" aria-checked="true" tabindex="0"/);
    expect(markup).toMatch(/data-value="small" aria-checked="true" tabindex="0"/);
    expect(markup).toMatch(/data-value="small" aria-checked="false" tabindex="-1"/);
    expect(markup).toMatch(/data-value="large" aria-checked="false" tabindex="-1"/);
  });
});
