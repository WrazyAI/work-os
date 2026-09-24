import { afterEach, describe, expect, it, vi } from "vitest";
import { ATTENTION_ANIMATION_MS, ATTENTION_COOLDOWN_MS, ATTENTION_PLAY_COUNT, startAttentionSequence } from "./attentionSequence";

describe("bounded attention sequence", () => {
  afterEach(() => vi.useRealTimers());

  it("plays one 1-second gesture and then settles", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    startAttentionSequence(onChange);

    expect(ATTENTION_ANIMATION_MS).toBe(1_000);
    expect(ATTENTION_COOLDOWN_MS).toBe(0);
    expect(ATTENTION_PLAY_COUNT).toBe(1);
    expect(onChange.mock.calls).toEqual([[true, 1]]);

    vi.advanceTimersByTime(ATTENTION_ANIMATION_MS - 1);
    expect(onChange.mock.calls).toEqual([[true, 1]]);
    vi.advanceTimersByTime(1);
    expect(onChange.mock.calls).toEqual([[true, 1], [false, 1]]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels the active play when the attention state clears", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const cancel = startAttentionSequence(onChange);

    vi.advanceTimersByTime(500);
    cancel();
    vi.advanceTimersByTime(ATTENTION_ANIMATION_MS * ATTENTION_PLAY_COUNT + ATTENTION_COOLDOWN_MS * 2);

    expect(onChange.mock.calls).toEqual([[true, 1]]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
