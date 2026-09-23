import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorktivityControlNotice } from "./WorktivityControlNotice";

describe("Worktivity control notice", () => {
  it("announces each live control phase without claiming attendance changed", () => {
    const markup = renderToStaticMarkup(createElement(WorktivityControlNotice, {
      state: { status: "starting", phase: "desktop" },
    }));

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("Preparing Worktivity; it will open or restart if needed");
    expect(markup).toContain('aria-busy="true"');
  });

  it("keeps an ambiguous result pending with a read-only status action", () => {
    const markup = renderToStaticMarkup(createElement(WorktivityControlNotice, {
      state: { status: "pending", message: "Worktivity has not confirmed the change yet." },
      onCheckStatus: () => undefined,
    }));

    expect(markup).toContain('role="status"');
    expect(markup).toContain("Worktivity has not confirmed the change yet.");
    expect(markup).toContain("Check Worktivity status");
    expect(markup).not.toContain("aria-busy=\"true\"");
  });
});
