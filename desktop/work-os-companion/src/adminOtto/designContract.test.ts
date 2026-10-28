import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * Visual/layout regression for the administration refinement.
 *
 * The behavior suites prove state and data handling. These guards keep the
 * administration surface on the employee conversation material: one 480px
 * paper sheet, the shared header, the activity-card geometry, one correction
 * accent, and the shared Settings group. They are intentionally source-level:
 * a CSS token drift is invisible to a static markup assertion.
 */
describe("admin Otto design contract", () => {
  const css = read("./adminOtto.css");
  const chat = read("./AdminOttoChat.tsx");
  const inbox = read("./AdminRecapInbox.tsx");
  const recap = read("./AdminRecapView.tsx");
  const settings = read("./AdminOttoSettings.tsx");

  it("uses the employee 480x680 conversation sheet and one shared header", () => {
    expect(css).toContain("width: min(480px, calc(100vw - 48px))");
    expect(css).toContain("height: min(680px, calc(100dvh - 48px))");
    expect(css).toContain("background: var(--conversation-paper)");
    expect(css).toContain("background: var(--conversation-surface)");
    expect(css).toContain("box-shadow: var(--conversation-shadow)");
    expect(css).toContain("border-radius: 16px;");
    expect(chat).toContain("workos-chat-head admin-otto-head");
    expect(chat).toContain("conversation-pane-title");
    expect(chat).toContain("progress-header-actions");
    expect(chat).toContain("Administration, read-only");
    expect(chat).not.toContain("admin-otto-tabs-row");
    expect(chat).not.toContain("admin-otto-eyebrow");
    expect(chat).not.toContain("admin-otto-readonly-note");
  });

  it("keeps recap cards and the review detail on the employee card material", () => {
    expect(css).toMatch(
      /\.admin-otto-inbox-item \{[\s\S]*?padding: 12px 14px;[\s\S]*?border-radius: 16px;[\s\S]*?background: var\(--conversation-surface\)/,
    );
    expect(css).toMatch(
      /\.admin-otto-recap \{[\s\S]*?padding: 12px 14px;[\s\S]*?border-radius: 16px;[\s\S]*?background: var\(--conversation-surface\)/,
    );
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
