import { describe, expect, it } from "vitest";
import { taskViewTabIndex } from "./taskViewTabs";

describe("task view tab keyboard contract", () => {
  it("moves right and wraps from the last view to the first", () => {
    expect(taskViewTabIndex(0, "ArrowRight", 4)).toBe(1);
    expect(taskViewTabIndex(2, "ArrowRight", 4)).toBe(3);
    expect(taskViewTabIndex(3, "ArrowRight", 4)).toBe(0);
  });

  it("moves left and wraps from the first view to the last", () => {
    expect(taskViewTabIndex(3, "ArrowLeft", 4)).toBe(2);
    expect(taskViewTabIndex(1, "ArrowLeft", 4)).toBe(0);
    expect(taskViewTabIndex(0, "ArrowLeft", 4)).toBe(3);
  });

  it("jumps to the ends and ignores unrelated keys", () => {
    expect(taskViewTabIndex(2, "Home", 4)).toBe(0);
    expect(taskViewTabIndex(1, "End", 4)).toBe(3);
    expect(taskViewTabIndex(1, "Tab", 4)).toBeNull();
    expect(taskViewTabIndex(1, "Escape", 4)).toBeNull();
  });

  it("refuses an empty or out-of-range tablist", () => {
    expect(taskViewTabIndex(0, "ArrowRight", 0)).toBeNull();
    expect(taskViewTabIndex(-1, "ArrowRight", 4)).toBeNull();
    expect(taskViewTabIndex(4, "ArrowLeft", 4)).toBeNull();
  });
});
