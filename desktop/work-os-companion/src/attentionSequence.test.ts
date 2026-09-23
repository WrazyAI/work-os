import { afterEach, describe, expect, it, vi } from "vitest";
import { ATTENTION_ANIMATION_MS, ATTENTION_COOLDOWN_MS, ATTENTION_PLAY_COUNT, startAttentionSequence } from "./attentionSequence";

describe("repeated attention sequence", () => {
  afterEach(() => vi.useRealTimers());

  it("plays three 5-second cycles with 1-second gaps and no trailing cooldown", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    startAttentionSequence(onChange);

    expect(ATTENTION_ANIMATION_MS).toBe(5_000);
    expect(ATTENTION_COOLDOWN_MS).toBe(1_000);
    expect(ATTENTION_PLAY_COUNT).toBe(3);
    expect(onChange.mock.calls).toEqual([[true, 1]]);

    vi.advanceTimersByTime(ATTENTION_ANIMATION_MS - 1);
    expect(onChange.mock.calls).toEqual([[true, 1]]);
    vi.advanceTimersByTime(1);
    expect(onChange.mock.calls.at(-1)).toEqual([false, 1]);

    vi.advanceTimersByTime(ATTENTION_COOLDOWN_MS - 1);
    expect(onChange.mock.calls.at(-1)).toEqual([false, 1]);
    vi.advanceTimersByTime(1);
    expect(onChange.mock.calls.at(-1)).toEqual([true, 2]);

    vi.advanceTimersByTime(ATTENTION_ANIMATION_MS + ATTENTION_COOLDOWN_MS);
    expect(onChange.mock.calls.slice(-2)).toEqual([[false, 2], [true, 3]]);
    vi.advanceTimersByTime(ATTENTION_ANIMATION_MS);
    expect(onChange.mock.calls.at(-1)).toEqual([false, 3]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels the active play when the attention state clears", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const cancel = startAttentionSequence(onChange);

    vi.advanceTimersByTime(2_000);
    cancel();
    vi.advanceTimersByTime(ATTENTION_ANIMATION_MS * ATTENTION_PLAY_COUNT + ATTENTION_COOLDOWN_MS * 2);

    expect(onChange.mock.calls).toEqual([[true, 1]]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
