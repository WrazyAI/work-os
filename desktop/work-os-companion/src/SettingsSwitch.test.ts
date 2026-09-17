import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsSwitch } from "./App";

describe("SettingsSwitch", () => {
  it("reports its state to assistive tech and in words", () => {
    const on = renderToStaticMarkup(createElement(SettingsSwitch, { checked: true, onChange: () => undefined, label: "Automatic update checks" }));
    expect(on).toContain('role="switch"');
    expect(on).toContain('aria-checked="true"');
    expect(on).toContain('aria-label="Automatic update checks"');
    expect(on).toContain("On");
    expect(on).not.toContain(">Off<");
  });

  it("renders the off state without a checked marker", () => {
    const off = renderToStaticMarkup(createElement(SettingsSwitch, { checked: false, onChange: () => undefined, label: "Start with Windows" }));
    expect(off).toContain('aria-checked="false"');
    expect(off).toContain("Off");
    expect(off).not.toContain('aria-checked="true"');
  });
});
