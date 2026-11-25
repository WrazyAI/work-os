import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import DebugWindow from "./DebugWindow";
import { NotificationProvider } from "./NotificationFlyouts";
import { DEBUG_SECTIONS } from "./debugSections";

function render() {
  return renderToStaticMarkup(createElement(NotificationProvider, null, createElement(DebugWindow)));
}

describe("debugger category workspace", () => {
  it("renders one rail destination per category instead of a tab strip", () => {
    const html = render();
    expect(html).toContain("Work OS debugger");
    expect(html).toContain('aria-label="Debugger views"');
    expect(html).not.toContain('role="tablist"');
    for (const section of DEBUG_SECTIONS) {
      expect(html).toContain(`id="debug-section-${section.id}"`);
      expect(html).toContain(`data-debug-section="${section.id}"`);
    }
    expect(html.match(/data-debug-section=/g)?.length).toBe(DEBUG_SECTIONS.length);
  });

  it("lands on Overview with the master switch and a route into every category", () => {
    const html = render();
    expect(html).toMatch(/<h1 id="debug-page-title"[^>]*>Overview<\/h1>/);
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("Enable debug scenario");
    expect(html).toContain("Current scenario");
    for (const label of ["Preset", "Session", "Workday", "Companion", "Reach"]) {
      expect(html).toContain(`<strong>${label}</strong>`);
    }
  });

  it("keeps scenario actions persistent and the narrow section picker available", () => {
    const html = render();
    expect(html).toContain("Copy scenario JSON");
    expect(html).toContain("Reset all overrides");
    expect(html).toContain('aria-label="Debugger section"');
    expect(html).toContain("Active preset");
  });

  it("uses the header as the window caption with its own controls", () => {
    const html = render();
    expect(html).toContain("data-tauri-drag-region");
    expect(html).toContain('aria-label="Minimize"');
    expect(html).toContain('aria-label="Maximize"');
    expect(html).toContain('aria-label="Close window"');
    expect(html).not.toContain('class="debug-close"');
  });

  it("swaps in macOS traffic lights and reserved track on a mac", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15" });
    try {
      const html = render();
      expect(html).toContain('data-platform="mac"');
      expect(html).toContain('class="debug-traffic"');
      expect(html).toContain("debug-traffic-close");
      expect(html).toContain("debug-traffic-min");
      expect(html).toContain("debug-traffic-zoom");
      // The Windows caption buttons must not double up beside the native ones.
      expect(html).not.toContain('aria-label="Minimize"');
      expect(html).not.toContain('aria-label="Maximize"');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
