import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/** One plain CSS rule, scoped to its selector block. */
function ruleBlock(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  expect(start, `missing rule ${selector}`).toBeGreaterThan(-1);
  const end = source.indexOf("}", start);
  return source.slice(start, end + 1);
}

/** One media-query block, including nested rules. */
function mediaBlock(source: string, query: string): string {
  const start = source.indexOf(query);
  expect(start, `missing media query ${query}`).toBeGreaterThan(-1);
  const open = source.indexOf("{", start);
  let depth = 1;
  let index = open + 1;
  while (index < source.length && depth > 0) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") depth -= 1;
    index += 1;
  }
  return source.slice(start, index);
}

/**
 * Visual/layout regression for the administration refinement.
 *
 * The behavior suites prove state and data handling. These guards keep the
 * administration surface on the employee conversation material and cover the
 * two regressions that static render assertions cannot see: the compact
 * desktop sheet must clear the standing notification band, and every narrow
 * touch action must keep the 40px blueprint minimum. They are intentionally
 * scoped to the rule blocks that own the contract.
 */
describe("admin Otto design contract", () => {
  const css = read("./adminOtto.css");
  const styles = read("../styles.css");
  const chat = read("./AdminOttoChat.tsx");
  const inbox = read("./AdminRecapInbox.tsx");
  const recap = read("./AdminRecapView.tsx");
  const settings = read("./AdminOttoSettings.tsx");

  it("uses the employee conversation sheet and one shared header", () => {
    const surface = ruleBlock(css, ".admin-otto-surface");
    expect(surface).toContain("width: min(480px, calc(100vw - 48px))");
    expect(surface).toContain("height: min(680px, calc(100dvh - 160px))");
    expect(surface).toContain("max-height: calc(100dvh - 160px)");
    const sheet = ruleBlock(css, ".admin-otto-surface .admin-otto-sheet");
    expect(sheet).toContain("border-radius: 16px");
    expect(sheet).toContain("background: var(--conversation-paper)");
    expect(sheet).toContain("box-shadow: var(--conversation-shadow)");
    expect(chat).toContain("workos-chat-head admin-otto-head");
    expect(chat).toContain("conversation-pane-title");
    expect(chat).toContain("progress-header-actions");
    expect(chat).toContain("Administration, read-only");
    expect(chat).not.toContain("admin-otto-tabs-row");
    expect(chat).not.toContain("admin-otto-eyebrow");
    expect(chat).not.toContain("admin-otto-readonly-note");
  });

  it("keeps the compact desktop sheet clear of the standing notification band", () => {
    const surface = ruleBlock(css, ".admin-otto-surface");
    expect(surface).toContain("height: min(680px, calc(100dvh - 160px))");
    expect(surface).toContain("max-height: calc(100dvh - 160px)");
    // The 1024px inset adjustment must not restore a taller sheet and re-cover
    // the standing notification card.
    const compactDesktop = mediaBlock(css, "@media (max-width: 1024px)");
    expect(compactDesktop).toContain("right: 12px");
    expect(compactDesktop).toContain("bottom: 12px");
    expect(compactDesktop).not.toMatch(/(^|\n)\s*(height|max-height):/);
  });

  it("keeps every narrow touch action at the 40px minimum", () => {
    const narrow = mediaBlock(css, "@media (max-width: 700px)");
    for (const selector of [
      ".admin-otto-close",
      ".admin-otto-secondary",
      ".admin-otto-listen",
      ".admin-otto-refresh",
      ".admin-otto-back",
      ".admin-otto-inbox-inline-error button",
      ".admin-otto-inbox-error button",
    ]) {
      expect(narrow).toContain(selector);
    }
    expect(narrow).toMatch(/min-height: 40px;/);
    expect(narrow).toMatch(/\[data-conversation-surface="in-app"\] \.admin-otto-head \.admin-otto-close \{ width: 40px; height: 40px; \}/);
    expect(narrow).toMatch(/\.admin-otto-head \.chat-tab \{\s*min-height: 40px;/);
    expect(narrow).toContain(".admin-otto-recap-actions .admin-otto-record-link");

    const settingsNarrow = mediaBlock(styles, "@media (max-width: 700px)");
    expect(settingsNarrow).toContain(".settings-follow .settings-choice button { min-width: 40px; min-height: 40px; }");
    expect(settingsNarrow).toContain(".settings-follow-search input { min-height: 40px; }");
    expect(settingsNarrow).toContain(".settings-follow-person { min-height: 40px; }");
    expect(settingsNarrow).toContain(".settings-panel .settings-follow-save { min-height: 40px; }");
  });

  it("keeps the chat and follow scales on whole pixels", () => {
    expect(css).not.toMatch(/font-size:\s*\d+\.\d+px/);
    expect(mediaBlock(css, "@media (max-width: 700px)")).toContain("font-size: 10px");
    expect(ruleBlock(css, ".admin-otto-refresh")).toContain("font-size: 11px");
    expect(settings).not.toMatch(/font-size:\s*\d+\.\d+px/);
    const followCss = styles.slice(styles.indexOf(".settings-follow {"), styles.indexOf("/* Profile settings use"));
    expect(followCss).not.toMatch(/font-size:\s*\d+\.\d+px/);
  });

  it("keeps recap cards and the review detail on the employee card material", () => {
    const card = ruleBlock(css, ".admin-otto-inbox-item");
    expect(card).toContain("padding: 12px 14px");
    expect(card).toContain("border-radius: 16px");
    expect(card).toContain("background: var(--conversation-surface)");
    const detail = ruleBlock(css, ".admin-otto-recap");
    expect(detail).toContain("padding: 12px 14px");
    expect(detail).toContain("border-radius: 16px");
    expect(detail).toContain("background: var(--conversation-surface)");
    expect(css).toContain(".admin-otto-review-status::before");
    expect(css).toContain(".admin-otto-recap-section.is-correction");
    expect(css).not.toContain(".admin-otto-eyebrow");
    expect(inbox).toContain("admin-otto-inbox-actions");
    expect(inbox).toContain("Not listened");
    expect(recap).toContain("admin-otto-recap-kicker");
    expect(recap).toContain("Getting your recap…");
    expect(recap).toContain("Otto is reading");
    expect(recap).toContain("Taking longer than usual");
    expect(recap).toContain("Read complete");
    expect(recap).toContain("Listen again");
  });

  it("renders follow settings as the shared group, not a nested form", () => {
    expect(settings).toContain("<Setting");
    expect(settings).toContain("<SettingsChoice");
    expect(settings).toContain('className="settings-group"');
    expect(settings).toContain("settings-follow-list");
    expect(settings).toContain("settings-follow-state");
    expect(settings).not.toContain("settings-follow-option");
    expect(settings).not.toContain("settings-follow-list-wrap");
  });
});
