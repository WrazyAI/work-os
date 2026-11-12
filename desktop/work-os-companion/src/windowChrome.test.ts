import { describe, expect, it } from "vitest";
import { isEditableTarget, isQuitShortcut, isSidebarShortcut, shortcutLabel } from "./windowChrome";

const press = (overrides: Partial<Parameters<typeof isQuitShortcut>[0]> = {}) => ({
  key: "q", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, ...overrides,
});

describe("window chrome shortcuts", () => {
  it("uses Ctrl+Q on Windows and Cmd+Q on macOS", () => {
    expect(isQuitShortcut(press({ ctrlKey: true }), false)).toBe(true);
    expect(isQuitShortcut(press({ metaKey: true }), true)).toBe(true);
    expect(isQuitShortcut(press({ ctrlKey: true }), true)).toBe(false);
    expect(isQuitShortcut(press({ metaKey: true }), false)).toBe(false);
    expect(isQuitShortcut(press({ key: "Q", ctrlKey: true }), false)).toBe(true);
    expect(isQuitShortcut(press({ ctrlKey: true, altKey: true }), false)).toBe(false);
    expect(isQuitShortcut(press({ ctrlKey: true, shiftKey: true }), false)).toBe(false);
  });

  it("uses the same platform modifier for the sidebar", () => {
    expect(isSidebarShortcut(press({ key: "b", ctrlKey: true }), false)).toBe(true);
    expect(isSidebarShortcut(press({ key: "b", metaKey: true }), true)).toBe(true);
    expect(isSidebarShortcut(press({ key: "b", ctrlKey: true }), true)).toBe(false);
    expect(isSidebarShortcut(press({ key: "q", ctrlKey: true }), false)).toBe(false);
  });

  it("names the shortcut exactly as the menu shows it", () => {
    expect(shortcutLabel("Q", false)).toBe("Ctrl Q");
    expect(shortcutLabel("Q", true)).toBe("⌘Q");
  });

  it("finds no editable target outside the DOM", () => {
    expect(isEditableTarget(null)).toBe(false);
  });
});
