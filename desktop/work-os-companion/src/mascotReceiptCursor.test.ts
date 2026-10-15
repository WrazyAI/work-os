import { describe, expect, it } from "vitest";
import { createMascotReceiptCursor } from "./mascotReceiptCursor";

describe("consumed mascot outcomes", () => {
  it("does not replay an outcome when a ready lease expires or a heartbeat repeats", () => {
    const cursor = createMascotReceiptCursor();
    expect(cursor.observe("avatar-instance", 2)).toBe(1);
    expect(cursor.observe("avatar-instance", 2)).toBe(1);
    expect(cursor.observe("avatar-instance", 0)).toBe(1);
    expect(cursor.observe("avatar-instance", 1)).toBe(1);
    expect(cursor.observe("avatar-instance", 3)).toBe(2);
  });
  it("recognizes a new window instance without replaying old instance revisions", () => {
    const cursor = createMascotReceiptCursor();
    expect(cursor.observe("old-instance", 20)).toBe(1);
    expect(cursor.observe("new-instance", 1)).toBe(2);
    expect(cursor.observe("old-instance", 20)).toBe(2);
    expect(cursor.observe("new-instance", NaN)).toBe(2);
  });
});
