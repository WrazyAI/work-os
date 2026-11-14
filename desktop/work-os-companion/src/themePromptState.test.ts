import { describe, expect, it } from "vitest";
import { shouldOpenThemePrompt } from "./themePromptState";

describe("theme prompt gate", () => {
  it("opens only for a signed-in workspace with no other overlay", () => {
    expect(shouldOpenThemePrompt({ signedIn: true, themePromptSeen: false, workspaceOnScreen: true, otherOverlayOpen: false, hasSession: true })).toBe(true);
  });

  it("never reopens once seen, signed out, on a boot screen, or over another overlay", () => {
    const base = { signedIn: true, themePromptSeen: false, workspaceOnScreen: true, otherOverlayOpen: false, hasSession: true };
    expect(shouldOpenThemePrompt({ ...base, themePromptSeen: true })).toBe(false);
    expect(shouldOpenThemePrompt({ ...base, signedIn: false })).toBe(false);
    expect(shouldOpenThemePrompt({ ...base, workspaceOnScreen: false })).toBe(false);
    expect(shouldOpenThemePrompt({ ...base, otherOverlayOpen: true })).toBe(false);
    expect(shouldOpenThemePrompt({ ...base, hasSession: false })).toBe(false);
  });
});
