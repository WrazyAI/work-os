import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ThemePrompt from "./ThemePrompt";

describe("theme prompt", () => {
  it("renders three named choices, the live preview, and one commit action", () => {
    const markup = renderToStaticMarkup(createElement(ThemePrompt, {
      selected: "system", onSelect: () => undefined, onUse: () => undefined, onDismiss: () => undefined,
    }));
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain("How should Work OS look?");
    expect(markup).toContain("Light");
    expect(markup).toContain("Dark");
    expect(markup).toContain("System");
    expect(markup).toContain("Previewing System");
    expect(markup).toContain("This device is set to");
    expect(markup).toContain("Use System");
    expect(markup.match(/role="radio"/g)).toHaveLength(3);
    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain("theme-prompt");
  });

  it("states an error and disables the commit while saving", () => {
    const markup = renderToStaticMarkup(createElement(ThemePrompt, {
      selected: "dark", saving: true, error: "The theme could not be saved.",
      onSelect: () => undefined, onUse: () => undefined, onDismiss: () => undefined,
    }));
    expect(markup).toContain("The theme could not be saved.");
    expect(markup).toContain("Saving");
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("disabled");
  });
});
