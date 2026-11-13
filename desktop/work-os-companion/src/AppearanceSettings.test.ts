import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppearanceSettings } from "./AppearanceSettings";

const noop = () => undefined;

describe("AppearanceSettings", () => {
  const markup = renderToStaticMarkup(createElement(AppearanceSettings, { theme: "system", textSize: "medium", mascotSize: "small", onTheme: noop, onTextSize: noop, onMascotSize: noop }));

  it("renders the appearance group before reading and display", () => {
    expect(markup).toContain('aria-labelledby="settings-appearance-title"');
    expect(markup.indexOf("Appearance")).toBeLessThan(markup.indexOf("Reading &amp; display"));
    expect(markup).toContain('aria-labelledby="settings-display-title"');
    expect(markup).toContain("Text size");
    expect(markup).toContain("Mascot size");
  });

  it("exposes each preference as a labelled radio group", () => {
    expect(markup.match(/role="radiogroup"/g) ?? []).toHaveLength(3);
    expect(markup.match(/role="radio"/g) ?? []).toHaveLength(7);
    expect(markup).toContain('aria-label="Theme"');
    expect(markup).toContain('aria-label="Text size"');
    expect(markup).toContain('aria-label="Mascot size"');
  });

  it("marks the selected option checked and keeps the others out of the tab order", () => {
    expect(markup).toMatch(/data-value="system" aria-checked="true" tabindex="0"/);
    expect(markup).toMatch(/data-value="light" aria-checked="false" tabindex="-1"/);
    expect(markup).toMatch(/data-value="dark" aria-checked="false" tabindex="-1"/);
    expect(markup).toMatch(/data-value="medium" aria-checked="true" tabindex="0"/);
    expect(markup).toMatch(/data-value="small" aria-checked="true" tabindex="0"/);
    expect(markup).toMatch(/data-value="large" aria-checked="false" tabindex="-1"/);
  });
});
