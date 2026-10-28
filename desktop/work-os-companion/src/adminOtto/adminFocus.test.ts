import { describe, expect, it, vi } from "vitest";
import { adminEscapeAction, adminRecapOpenFocus, chooseAdminRecapReturnFocus, type AdminFocusTarget } from "./adminFocus";

function target(connected = true) {
  const focus = vi.fn();
  return {
    focus,
    isConnected: connected,
  } satisfies AdminFocusTarget & { focus: ReturnType<typeof vi.fn> };
}

describe("admin sheet focus and Escape", () => {
  it("Escape closes the recap first, then the sheet, and never two surfaces", () => {
    expect(adminEscapeAction({ key: "Escape", recapOpen: true, topmostModalOpen: false })).toBe("close-recap");
    expect(adminEscapeAction({ key: "Escape", recapOpen: false, topmostModalOpen: false })).toBe("close-surface");
    // A profile/memory modal owns Escape while it is open.
    expect(adminEscapeAction({ key: "Escape", recapOpen: true, topmostModalOpen: true })).toBe(null);
    expect(adminEscapeAction({ key: "Enter", recapOpen: true, topmostModalOpen: false })).toBe(null);
  });

  it("opening a recap focuses its Back control, never the removed row", () => {
    const back = target();
    expect(adminRecapOpenFocus(back)).toBe(back);
  });

  it("closing a recap returns focus to the exact View control that opened it", () => {
    const row = target();
    const lookup = vi.fn(() => target());
    expect(chooseAdminRecapReturnFocus({ trigger: row, recapId: "interval-1", lookup, back: target() })).toBe(row);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("recovers the row by recap id after a refresh, then falls back to Back", () => {
    const replacement = target();
    const lookup = vi.fn((id: string) => id === "interval-1" ? replacement : null);
    expect(chooseAdminRecapReturnFocus({
      trigger: target(false),
      recapId: "interval-1",
      lookup,
      back: target(),
    })).toBe(replacement);

    const back = target();
    expect(chooseAdminRecapReturnFocus({
      trigger: null,
      recapId: "interval-2",
      lookup: () => null,
      back,
    })).toBe(back);
  });
});
