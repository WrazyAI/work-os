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

const history: ChangelogHistoryEntry[] = Array.from({ length: 45 }, (_, index) => ({
  version: `0.6.${45 - index}`,
  date: index % 3 === 0 ? "2026-10-12" : null,
  bullets: [`Note for 0.6.${45 - index}.`],
  installed: index === 0,
}));

const renderHistory = (visibleCount: number) =>
  renderToStaticMarkup(createElement(ChangelogHistory, { entries: history, visibleCount, onShowMore: () => undefined }));

describe("changelog history", () => {
  it("shows the twenty newest releases first and pages the rest behind Show more", () => {
    const markup = renderHistory(20);
    expect((markup.match(/class="whats-new-release"/g) ?? []).length).toBe(20);
    expect(markup).toContain("Show more");
    expect(markup).not.toContain("Show all");
    expect(markup).toContain("This version");
    // Newest first: the highest version precedes the next one down.
    expect(markup.indexOf("Version 0.6.45")).toBeLessThan(markup.indexOf("Version 0.6.44"));
    expect(markup).not.toContain("Version 0.6.25");
  });

  it("appends the next page until the end of the list", () => {
    const middle = renderHistory(40);
    expect((middle.match(/class="whats-new-release"/g) ?? []).length).toBe(40);
    expect(middle).toContain("Version 0.6.25");
    expect(middle).toContain("Show more");
    const all = renderHistory(45);
    expect((all.match(/class="whats-new-release"/g) ?? []).length).toBe(45);
    expect(all).toContain("Version 0.6.01");
    expect(all).not.toContain("Show more");
  });

  it("shows the ship date beside each version that logged one", () => {
    const markup = renderHistory(20);
    expect(markup).toContain('class="whats-new-date"');
    expect(markup).toContain('dateTime="2026-10-12"');
    expect(markup).toContain("October 12, 2026");
  });

  it("keeps a logged release readable when no ship date was recorded", () => {
    const markup = renderToStaticMarkup(createElement(ChangelogHistory, {
      entries: [{ version: "0.4.0", date: null, bullets: [], installed: false }],
      visibleCount: 20,
      onShowMore: () => undefined,
    }));
    expect(markup).toContain("Version 0.4.00");
    expect(markup).not.toContain("whats-new-date");
    expect(markup).toContain("No notes were logged for this build.");
  });
});
