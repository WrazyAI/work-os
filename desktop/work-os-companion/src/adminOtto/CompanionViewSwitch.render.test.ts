import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CompanionViewMenu, CompanionViewSwitch } from "./CompanionViewSwitch";
import { placeViewPopover } from "./viewPopover";

const base = {
  mode: "employee" as const,
  employeeAvailable: true,
  adminAvailable: true,
  onSwitch: () => undefined,
};

describe("CompanionViewSwitch", () => {
  it("static_mark_for_non_admin", () => {
    const html = renderToStaticMarkup(createElement(CompanionViewSwitch, { ...base, switchable: false }));
    expect(html).toContain("otto-view-switch-static");
    expect(html).not.toContain("aria-haspopup");
    expect(html).not.toContain("data-view-menu");
  });

  it("button_names_current_view", () => {
    const html = renderToStaticMarkup(createElement(CompanionViewSwitch, base));
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-label="Otto view: Employee. Change view"');
    expect(html).toContain('data-mode="employee"');
  });

  it("menu_marks_current_choice_in_text_and_shape", () => {
    const html = renderToStaticMarkup(createElement(CompanionViewMenu, {
      ...base, onClose: () => undefined, open: true, mode: "admin", adminAvailable: true,
    }));
    expect(html).toContain('role="menu"');
    expect(html).toContain('role="menuitemradio"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("Current");
    expect(html).toContain("Employee");
    expect(html).toContain("Admin");
  });

  it("separates the trigger id from the menu id", () => {
    const html = renderToStaticMarkup(createElement(CompanionViewMenu, {
      ...base, onClose: () => undefined, open: true, menuId: "view-menu-1", labelledBy: "view-trigger-1",
    }));
    expect(html).toContain('id="view-menu-1"');
    expect(html).toContain('aria-labelledby="view-trigger-1"');
  });

  it("disabled_destination_explains_reason", () => {
    const html = renderToStaticMarkup(createElement(CompanionViewMenu, {
      ...base, onClose: () => undefined, open: true, employeeAvailable: false, employeeReason: "No personal workday is mapped.",
    }));
    expect(html).toContain("No personal workday is mapped.");
    expect(html).toContain('aria-disabled="true"');
  });

  it("pending_announces_once_and_disables_both", () => {
    const html = renderToStaticMarkup(createElement(CompanionViewMenu, {
      ...base, onClose: () => undefined, open: true, pending: "admin", onSwitch: () => undefined,
    }));
    expect(html.match(/Switching to Admin…/g)).toHaveLength(1);
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(2);
  });

  it("error_has_one_retry", () => {
    const retry = vi.fn();
    const html = renderToStaticMarkup(createElement(CompanionViewMenu, {
      ...base, onClose: () => undefined, open: true, error: "The view did not open.", onRetry: retry,
    }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("The view did not open.");
    expect(html.match(/>Try again</g)).toHaveLength(1);
  });

  it("places at all viewport edges", () => {
    expect(placeViewPopover({ anchor: { left: 2, right: 40, top: 80, bottom: 116 }, size: { width: 252, height: 214 }, viewport: { width: 390, height: 700 } }).left).toBe(8);
    expect(placeViewPopover({ anchor: { left: 360, right: 390, top: 80, bottom: 116 }, size: { width: 252, height: 214 }, viewport: { width: 390, height: 700 } }).left).toBe(130);
    expect(placeViewPopover({ anchor: { left: 20, right: 58, top: 640, bottom: 676 }, size: { width: 252, height: 214 }, viewport: { width: 390, height: 700 } }).placement).toBe("above");
  });
});
