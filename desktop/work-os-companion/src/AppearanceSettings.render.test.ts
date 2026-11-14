import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppearanceSettings } from "./AppearanceSettings";

describe("appearance settings", () => {
  it("renders the theme before reading and display, with the current choice checked", () => {
    const markup = renderToStaticMarkup(createElement(AppearanceSettings, {
      theme: "dark", textSize: "small", mascotSize: "large",
      onTheme: () => undefined, onTextSize: () => undefined, onMascotSize: () => undefined,
    }));
    expect(markup.indexOf("Appearance")).toBeLessThan(markup.indexOf("Reading &amp; display"));
    expect(markup).toContain('aria-label="Theme"');
    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain(">Dark<");
  });
});
