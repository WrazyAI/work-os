import { describe, expect, it } from "vitest";
import { createViewWorkFence } from "./viewWorkFence";

describe("view work fence", () => {
  it("invalidates the captured work and creates a fresh signal", () => {
    const fence = createViewWorkFence();
    const first = fence.capture();
    expect(first.isCurrent()).toBe(true);
    expect(first.signal.aborted).toBe(false);
    fence.invalidate();
    expect(first.signal.aborted).toBe(true);
    expect(first.isCurrent()).toBe(false);
    const second = fence.capture();
    expect(second.signal.aborted).toBe(false);
    expect(second.isCurrent()).toBe(true);
    second.release();
    expect(second.signal.aborted).toBe(true);
  });
});
