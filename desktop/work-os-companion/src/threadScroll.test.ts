import { describe, expect, it } from "vitest";
import { isThreadNearBottom, threadScrollTarget } from "./chat/core";

/* newestTop is the newest turn's top relative to the thread's visible top. */
const base = {
  clientHeight: 400,
  scrollTop: 600,
  scrollHeight: 1000,
  newestHeight: 120,
  newestTop: 280,
  wasAtBottom: true,
};

describe("threadScrollTarget", () => {
  it("treats a floating chat's visible card footer as near the latest turn", () => {
    expect(isThreadNearBottom({ scrollHeight: 502, scrollTop: 0, clientHeight: 429, thresholdPx: 96 })).toBe(true);
    expect(isThreadNearBottom({ scrollHeight: 502, scrollTop: 0, clientHeight: 429, thresholdPx: 48 })).toBe(false);
    expect(isThreadNearBottom({ scrollHeight: 700, scrollTop: 0, clientHeight: 429, thresholdPx: 96 })).toBe(false);
  });

  it("pins to the end for a turn that fits while the reader is at the bottom", () => {
    expect(threadScrollTarget(base)).toBe(600);
  });

  it("leaves a reader who scrolled up exactly where they are", () => {
    expect(threadScrollTarget({ ...base, scrollTop: 200, wasAtBottom: false })).toBeNull();
  });

  it("reveals a tall turn's first lines instead of dumping the reader at its end", () => {
    // A 520px card is appended while the reader sits at the pre-growth bottom;
    // the card's top is exactly at the bottom edge of the visible thread.
    const target = threadScrollTarget({
      clientHeight: 400,
      scrollTop: 500,
      scrollHeight: 1420,
      newestHeight: 520,
      newestTop: 400,
      wasAtBottom: true,
    });
    // The turn's top lands 96px above the bottom edge of the thread.
    expect(target).toBe(500 + 400 - (400 - 96));
  });

  it("clamps a tall turn's reveal inside the scroller", () => {
    const target = threadScrollTarget({
      clientHeight: 400,
      scrollTop: 1000,
      scrollHeight: 1400,
      newestHeight: 700,
      newestTop: 380,
      wasAtBottom: true,
    });
    expect(target).toBe(1000);
  });

  it("reveals the start of a turn that nearly fills the thread", () => {
    expect(threadScrollTarget({
      clientHeight: 429,
      scrollTop: 0,
      scrollHeight: 825,
      newestHeight: 426,
      newestTop: 365,
      wasAtBottom: true,
    })).toBe(32);
  });

  it("never asks for a negative or past-the-end position", () => {
    expect(
      threadScrollTarget({ clientHeight: 400, scrollTop: 0, scrollHeight: 500, newestHeight: 420, newestTop: 80, wasAtBottom: true }),
    ).toBe(0);
    expect(threadScrollTarget({ ...base, forceBottom: true })).toBe(600);
  });

  it("forceBottom wins even for a tall turn (dock just opened)", () => {
    expect(
      threadScrollTarget({ clientHeight: 400, scrollTop: 0, scrollHeight: 1420, newestHeight: 520, newestTop: 1420, wasAtBottom: false, forceBottom: true }),
    ).toBe(1020);
  });

  it("treats a thread that only holds the history block as a small arrival", () => {
    expect(threadScrollTarget({ ...base, newestHeight: 0, newestTop: 0 })).toBe(600);
    expect(threadScrollTarget({ ...base, newestHeight: 0, newestTop: 0, wasAtBottom: false })).toBeNull();
  });
});
