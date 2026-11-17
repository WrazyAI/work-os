import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)));
const read = (name: string) => readFileSync(resolve(root, name), "utf8").replace(/\r\n/g, "\n");
const theme = read("theme.css");
const dashboard = read("dashboard-overhaul.css");
const workspace = read("workspace-redesign.css");
const styles = read("styles.css");
const chat = read("chat/chat.css");
const workOsChat = read("work-os-chat.css");
const avatar = read("avatar.css");
const toolSurfaces = read("chat/tool-surfaces.css");

function rule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))?.[1] ?? "";
}

/** The dark material resolves these aliases to its own ink steps. */
describe("soft ash surface aliases", () => {
  it("defines the chat ink steps and every color alias the shared styles read", () => {
    const light = rule(theme, ":root");
    for (const token of [
      "ink-2", "ink-3", "color-ink-2", "color-ink-3", "color-muted",
      "color-raised", "color-ink-soft", "color-signal-deep", "color-warning",
      "color-observed", "color-observed-soft", "color-observed-ink",
    ]) {
      expect(light.includes(`--${token}:`), `--${token} is not defined for the light material`).toBe(true);
    }
    expect(light).toContain("--ink-2: var(--muted);");
    expect(light).toContain("--ink-3: var(--muted);");
  });
});

describe("dashboard and EOD hover surfaces", () => {
  it("paints a count hover with the theme inset, never a light block", () => {
    const body = rule(dashboard, ".band-fact:hover:not(.is-empty)");
    expect(body).toContain("var(--inset)");
    expect(body).not.toMatch(/#f[0-9a-f]{5}/i);
  });

  it("paints an earlier-EOD row hover with the theme inset", () => {
    const body = rule(workspace, ".eod-start-earlier li > button:hover");
    expect(body).toContain("var(--inset)");
    expect(body).not.toMatch(/#f[0-9a-f]{5}/i);
    expect(rule(workspace, ".eod-start-earlier header")).toContain("var(--line)");
    expect(rule(workspace, ".eod-start-earlier li + li")).toContain("var(--line)");
  });
});

describe("completion evidence dialog", () => {
  const block = dashboard.slice(
    dashboard.indexOf(".completion-evidence-modal"),
    dashboard.indexOf(".completion-evidence-provenance") + 400,
  );

  it("uses theme ink for its title, helper copy, labels, and fields", () => {
    expect(block).toContain("color: var(--ink)");
    expect(block).toContain("color: var(--muted)");
    expect(block).toContain("background: var(--white)");
    expect(block).toContain("border: 1px solid var(--line)");
    for (const lightOnly of ["#26351f", "#6f7d6c", "#43513f", "#849282", "#fffef9", "#30402c", "#7b8977"]) {
      expect(block, `${lightOnly} must not survive in the dark surface`).not.toContain(lightOnly);
    }
  });
});

describe("page guide and tour", () => {
  it("uses the companion ink steps instead of missing color aliases", () => {
    const rail = rule(styles, ".guide-tour-rail button");
    const badge = rule(styles, ".guide-tour-rail button > span");
    const currentBadge = rule(styles, ".guide-tour-rail button.is-current > span");
    expect(rail).toContain("color: var(--muted)");
    expect(badge).toContain("background: var(--white)");
    expect(badge).toContain("color: var(--muted)");
    expect(currentBadge).toContain("color: var(--ink-on-signal)");
    expect(rail).not.toContain("#687267");
  });

  it("keeps the film play control dark-on-white in both materials", () => {
    const play = rule(styles, ".guide-film-play");
    expect(play).toContain("color: var(--ink-on-signal)");
    expect(play).toContain("rgba(255, 255, 255, 0.94)");
  });

  it("uses the muted ink step for guide copy and quiet actions", () => {
    for (const [source, selector] of [
      [styles, ".task-modal.guide-modal > header p"],
      [styles, ".guide-step-copy small"],
      [styles, ".task-modal.guide-modal > footer .guide-quiet-action"],
      [styles, ".guide-auto-note"],
    ] as const) {
      expect(rule(source, selector), selector).toContain("var(--muted)");
    }
  });
});

describe("settings memory bands", () => {
  it("keeps the mascot tile and actions on theme surfaces", () => {
    const tile = rule(workspace, ".memory-summary-figure");
    const view = rule(workspace, ".memory-summary-view");
    const suggestion = rule(workspace, ".suggestion-summary-view");
    const primary = rule(workspace, ".suggestion-card-actions button.primary");
    expect(tile).toContain("var(--inset)");
    expect(tile).not.toContain("radial-gradient");
    for (const body of [view, suggestion, primary]) {
      expect(body).toContain("background: var(--ink)");
      expect(body).toContain("color: var(--white)");
      expect(body).not.toMatch(/#263026|#f7fbf5/);
    }
  });
});

describe("Otto chat cards", () => {
  it("keeps the composer placeholder on the theme muted step", () => {
    const body = rule(workOsChat, ".workos-input::placeholder");
    expect(body).toContain("var(--muted)");
    expect(body).not.toContain("#8a9288");
  });

  it("keeps the activity card action hover on a theme surface", () => {
    const body = rule(chat, ".chat-activity-view:hover");
    expect(body).not.toContain("#2b362b");
  });

  it("keeps the task-selection footer and disabled action on theme surfaces", () => {
    expect(rule(toolSurfaces, '[data-workos-tool-surface="task-selection"] .chat-task-footer')).toContain("var(--tool-inset)");
    const disabled = rule(toolSurfaces, '[data-workos-tool-surface="task-selection"] .task-selection-primary:disabled');
    expect(disabled).toContain("var(--tool-inset)");
    expect(disabled).toContain("var(--tool-muted)");
    expect(chat).not.toContain(".chat-task-card .task-selection-primary:not(:disabled) { color: #fff; }");
  });

  it("keeps agenda-review and context cards on theme surfaces", () => {
    for (const selector of [".agenda-review-card", ".avatar-context"]) {
      const body = rule(avatar, selector);
      expect(body, selector).toContain("background: var(--tool-success-soft)");
    }
    expect(rule(avatar, ".agenda-review-question input")).toContain("background: var(--white)");
    expect(rule(avatar, ".agenda-review-send")).toContain("background: var(--ink)");
    expect(rule(avatar, ".avatar-context.eod")).toContain("background: var(--warning-soft)");
  });

  it("keeps the floating window mode label on a theme ink", () => {
    const body = rule(avatar, ".avatar-head-mode");
    expect(body).toContain("var(--warning-ink)");
    expect(body).not.toContain("#7b6b45");
  });

  it("keeps the prompt-bubble action dark-on-signal in both materials", () => {
    const action = rule(avatar, ".avatar-prompt-action");
    expect(action).toContain("background: var(--signal, #a8f15b)");
    expect(action).toContain("color: var(--ink-on-signal, #182018)");
    expect(action).not.toContain("color: var(--ink, #182018)");
  });

  it("ships the employee masthead switch before the administration chunk loads", () => {
    const admin = read("admin/admin.css");
    expect(workspace).toContain(".admin-switch,\n.admin-switch-ghost {");
    expect(workspace).toContain("border-radius: 10px;");
    expect(admin).not.toContain(".admin-switch,\n.admin-switch-ghost {");
  });

  it("keeps the light tool paper light and its primaries paired", () => {
    expect(toolSurfaces).toContain("--tool-paper: #fbfaf5;");
    expect(toolSurfaces).toContain('[data-workos-tool-surface="batch"] .task-batch-foot button.primary {');
    expect(toolSurfaces).toContain("color: var(--tool-paper);");
    expect(toolSurfaces).not.toContain("--tool-paper: var(--ink-on-signal);");
  });
});

describe("tool card geometry", () => {
  it("defines the shared radius in the dark material, not only the light one", () => {
    const dark = rule(theme, ':root[data-theme="dark"]');
    expect(dark).toContain("--tool-radius: 16px;");
    expect(dark).toContain("--tool-shadow-hover:");
  });

  it("rounds both card surfaces with that token", () => {
    for (const selector of [
      '[data-workos-tool-surface="task-selection"].chat-task-card',
      '[data-workos-tool-surface="batch"].task-batch-card',
    ]) {
      expect(rule(toolSurfaces, selector), selector).toContain("border-radius: var(--tool-radius)");
    }
  });
});

describe("focus goal surfaces", () => {
  it("paints the saved goal card on the theme raised surface", () => {
    const card = rule(workspace, ".goal-card");
    expect(card).toContain("background: var(--surface-raised)");
    expect(card).toContain("border-radius: 12px");
    expect(card).not.toContain("background: #fff");
  });

  it("paints the editor on the theme inset with a muted placeholder", () => {
    const field = rule(workspace, ".goal-editor-field > textarea");
    expect(field).toContain("background: var(--inset)");
    expect(field).not.toContain("background: #fff");
    expect(rule(workspace, ".goal-editor-field > textarea::placeholder")).toContain("var(--muted)");
    expect(rule(workspace, ".goal-card-edit:hover")).toContain("var(--inset)");
  });

  it("keeps the editor's cancel action off a hardcoded white block", () => {
    const secondary = rule(workspace, ".goal-editor-actions button.secondary");
    expect(secondary).toContain("background: var(--white)");
    expect(secondary).not.toContain("background: #fff");
  });

  it("follows the material for the activity hairline and disclosure hover", () => {
    const stream = rule(workspace, ".goal-composer-panel .chat-activity-stream");
    expect(stream).toContain("border-top: 1px solid var(--line)");
    expect(stream).not.toContain("#e4e8e0");
    const disclosure = rule(workspace, ".focus-goal-disclosure:hover");
    expect(disclosure).toContain("background: var(--line)");
    expect(disclosure).not.toContain("rgba(24, 32, 24, 0.09)");
  });

  it("draws the textarea resize mark in theme ink", () => {
    const resizer = rule(workspace, ".goal-editor-field > textarea::-webkit-resizer");
    expect(resizer).toContain("var(--muted)");
    expect(resizer).not.toContain("#bcc5b6");
  });

  it("draws every Recaps panel hairline with the material line token", () => {
    expect(workspace).not.toContain("#e4e8e0");
    expect(rule(workspace, ".active-task-toolbar")).toContain("border-top: 1px solid var(--line)");
    expect(rule(workspace, ".progress-flyout .workos-chat-head")).toContain("border-bottom: 1px solid var(--line)");
  });
});

describe("activity stream view-in-app action", () => {
  it("keeps the light ink pill and swaps it for a raised chip in dark", () => {
    const view = rule(chat, ".chat-activity-view");
    expect(view).toContain("background: var(--ink)");
    expect(view).toContain("color: var(--white)");
    expect(view).not.toContain("--color-ink");

    const dark = theme.slice(theme.indexOf(':root[data-theme="dark"]'));
    const darkStart = dark.indexOf(".chat-activity-view {");
    expect(darkStart, "the dark material must re-material the view-in-app action").toBeGreaterThan(-1);
    const darkRule = dark.slice(darkStart);
    const body = darkRule.slice(0, darkRule.indexOf("}"));
    expect(body).toContain("background: var(--surface-raised)");
    expect(body).toContain("color: var(--ink)");
    expect(body).toContain("border-color: var(--line)");

    const hoverStart = darkRule.indexOf(".chat-activity-view:hover {");
    expect(hoverStart).toBeGreaterThan(-1);
    const hover = darkRule.slice(hoverStart);
    expect(hover.slice(0, hover.indexOf("}"))).toContain("background: var(--inset)");
  });
});
