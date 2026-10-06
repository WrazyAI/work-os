import { describe, expect, it } from "vitest";
import { isSettingsHotkey } from "./settingsHotkey";

const press = (overrides: Partial<KeyboardEvent> = {}) => ({
  key: ",", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...overrides,
}) as KeyboardEvent;

describe("settings hotkey", () => {
  it("opens on Ctrl+, and Cmd+,", () => {
    expect(isSettingsHotkey(press({ ctrlKey: true }))).toBe(true);
    expect(isSettingsHotkey(press({ metaKey: true }))).toBe(true);
  });

  it("leaves typing, modified chords, and other shortcuts untouched", () => {
    // A bare comma is text, not a command.
    expect(isSettingsHotkey(press())).toBe(false);
    expect(isSettingsHotkey(press({ shiftKey: true }))).toBe(false);
    expect(isSettingsHotkey(press({ ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isSettingsHotkey(press({ ctrlKey: true, altKey: true }))).toBe(false);
    expect(isSettingsHotkey(press({ ctrlKey: true, key: "m" }))).toBe(false);
  });
});
