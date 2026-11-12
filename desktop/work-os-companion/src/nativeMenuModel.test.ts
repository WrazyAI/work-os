import { describe, expect, it } from "vitest";
import type { AppMenuGroup } from "./AppMenuBar";
import { nativeMenuModel } from "./nativeMenuModel";

const groups: AppMenuGroup[] = [
  { label: "Workspace", items: [{ id: "workspace:organization", label: "Work OS workspace", checked: true, disabled: true }] },
  {
    label: "Go",
    items: [
      { id: "go:day", label: "My Day", checked: true, disabled: true, onSelect: () => undefined },
      { label: "Tasks", onSelect: () => undefined },
      { id: "go:settings", label: "Settings", shortcut: "⌘,", accelerator: "CmdOrCtrl+,", onSelect: () => undefined },
    ],
  },
  { label: "Help", items: [] },
  { items: [{ label: "Quit Work OS", onSelect: () => undefined }] },
];

describe("native macOS menu model", () => {
  it("keeps the labelled groups in the order the caption bar shows", () => {
    const model = nativeMenuModel(groups);
    expect(model.groups.map((group) => group.label)).toEqual(["Workspace", "Go"]);
  });

  it("maps destinations by stable id and falls back to position only when absent", () => {
    const model = nativeMenuModel(groups);
    expect(model.groups[1]?.items.map((item) => item.id)).toEqual(["menu:go:day", "menu:1:1", "menu:go:settings"]);
    expect(model.actions.size).toBe(2);
    expect(model.actions.has("menu:go:day")).toBe(false);
    expect(model.actions.has("menu:1:1")).toBe(true);
    expect(model.actions.has("menu:go:settings")).toBe(true);
  });

  it("carries check, disabled, and accelerator state into the native menu", () => {
    const model = nativeMenuModel(groups);
    expect(model.groups[1]?.items[0]).toMatchObject({ checked: true, enabled: false });
    expect(model.groups[1]?.items[2]?.accelerator).toBe("CmdOrCtrl+,");
  });

  it("leaves Quit to the native app menu", () => {
    const model = nativeMenuModel(groups);
    expect(model.groups.some((group) => group.items.some((item) => item.label === "Quit Work OS"))).toBe(false);
  });
});
