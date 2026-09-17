import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChangelogHistory, WhatsNewModal } from "./WhatsNewModal";
import type { ChangelogHistoryEntry } from "./whatsNew";

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

const history: ChangelogHistoryEntry[] = Array.from({ length: 12 }, (_, index) => ({
  version: `0.4.${String(12 - index).padStart(2, "0")}`,
  bullets: [`Note for 0.4.${12 - index}.`],
  installed: index === 0,
}));

describe("changelog history", () => {
  it("shows the ten newest releases first and caps the rest behind Show all", () => {
    const markup = renderToStaticMarkup(createElement(ChangelogHistory, { entries: history, showAll: false, onShowAll: () => undefined }));
    expect((markup.match(/class="whats-new-release"/g) ?? []).length).toBe(10);
    expect(markup).toContain("Show all 12 updates");
    expect(markup).toContain("This version");
    // Newest first: the highest version precedes the next one down.
    expect(markup.indexOf("Version 0.4.12")).toBeLessThan(markup.indexOf("Version 0.4.11"));
    expect(markup).not.toContain("Version 0.4.01");
  });

  it("reveals every logged release when expanded and can collapse again", () => {
    const markup = renderToStaticMarkup(createElement(ChangelogHistory, { entries: history, showAll: true, onShowAll: () => undefined }));
    expect((markup.match(/class="whats-new-release"/g) ?? []).length).toBe(12);
    expect(markup).toContain("Version 0.4.01");
    expect(markup).toContain("Show 10 newest");
    expect(markup).not.toContain("Show all 12 updates");
  });

  it("names the gap when a logged release shipped without notes", () => {
    const markup = renderToStaticMarkup(createElement(ChangelogHistory, {
      entries: [{ version: "0.4.0", bullets: [], installed: false }],
      showAll: false,
      onShowAll: () => undefined,
    }));
    expect(markup).toContain("No notes were logged for this build.");
  });
});
