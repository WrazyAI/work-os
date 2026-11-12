import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AppMenuBar, { withQuitGroup, type AppMenuGroup } from "./AppMenuBar";

const groups: AppMenuGroup[] = [{ label: "Go", items: [{ label: "Tasks", onSelect: () => undefined }] }];

describe("app menu bar", () => {
  it("appends one separate quit action with the platform shortcut", () => {
    const windows = withQuitGroup(groups, () => undefined, false);
    expect(windows.at(-1)?.items.at(-1)).toMatchObject({ label: "Quit Work OS", shortcut: "Ctrl Q", destructive: true });
    expect(windows).toHaveLength(2);
    const mac = withQuitGroup(groups, () => undefined, true);
    expect(mac.at(-1)?.items.at(-1)?.shortcut).toBe("⌘Q");
  });

  it("renders the caption bar, page context, and window controls", () => {
    const markup = renderToStaticMarkup(createElement(AppMenuBar, {
      pageLabel: "My Day",
      statusLabel: "On shift",
      menuGroups: groups,
      onQuit: () => undefined,
    }));
    expect(markup).toContain('class="wc-bar"');
    expect(markup).toContain("data-tauri-drag-region");
    expect(markup).toContain("Work OS");
    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("My Day");
    expect(markup).toContain("On shift");
    expect(markup).toContain('aria-label="Minimize"');
    expect(markup).toContain('aria-label="Maximize"');
    expect(markup).toContain('aria-label="Close window"');
    expect(markup).not.toContain('role="menu"');
  });

  it("drops empty groups before the quit action", () => {
    const result = withQuitGroup([{ label: "Empty", items: [] }], () => undefined, false);
    expect(result).toHaveLength(1);
    expect(result[0]?.items[0]?.label).toBe("Quit Work OS");
  });

  it("reserves the native traffic lights and drops window controls on macOS", () => {
    const markup = renderToStaticMarkup(createElement(AppMenuBar, {
      pageLabel: "My Day",
      statusLabel: "On shift",
      menuGroups: groups,
      onQuit: () => undefined,
      variant: "mac",
      showTrafficLights: false,
    }));
    expect(markup).toContain('data-variant="mac"');
    expect(markup).toContain("wc-bar--mac");
    expect(markup).toContain('class="wc-traffic is-native"');
    expect(markup).not.toContain('aria-label="Minimize"');
    expect(markup).not.toContain('aria-label="Close window"');
    expect(markup).toContain("On shift");
  });

  it("carries the admin status in the same trailing slot", () => {
    const markup = renderToStaticMarkup(createElement(AppMenuBar, {
      pageLabel: "People",
      statusLabel: "Admin mode",
      statusTone: "admin",
      menuGroups: groups,
      onQuit: () => undefined,
      variant: "mac",
      showTrafficLights: false,
    }));
    expect(markup).toContain("Admin mode");
    expect(markup).toContain("wc-mac-state is-admin");
    expect(markup).not.toContain("On shift");
  });
});
