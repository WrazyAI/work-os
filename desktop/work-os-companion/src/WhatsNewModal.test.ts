import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WhatsNewModal } from "./WhatsNewModal";

describe("changelog modal", () => {
  it("renders the version with its bullets in a labelled dialog", () => {
    const markup = renderToStaticMarkup(createElement(WhatsNewModal, {
      displayVersion: "0.3.09",
      bullets: ["First launch announces itself.", "View changelog opens this modal."],
      onClose: () => undefined,
    }));
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("Version 0.3.09");
    expect(markup).toContain("First launch announces itself.");
    expect(markup).toContain("View changelog opens this modal.");
    expect(markup).toContain('aria-label="Close changelog"');
  });

  it("falls back to deliberate copy when the build shipped without notes", () => {
    const markup = renderToStaticMarkup(createElement(WhatsNewModal, {
      displayVersion: "0.3.09",
      bullets: [],
      onClose: () => undefined,
    }));
    expect(markup).toContain("No changelog notes shipped with this build.");
    expect(markup).not.toContain("<li>");
  });

  it("escapes bullet text instead of rendering markup", () => {
    const markup = renderToStaticMarkup(createElement(WhatsNewModal, {
      displayVersion: "0.3.09",
      bullets: ["<script>alert(1)</script>"],
      onClose: () => undefined,
    }));
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("&lt;script&gt;");
  });
});
