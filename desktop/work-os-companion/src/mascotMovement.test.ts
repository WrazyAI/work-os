import { afterEach, describe, expect, it, vi } from "vitest";
import { createMascotMovement } from "./mascotMovement";

describe("native mascot movement", () => {
  afterEach(() => vi.useRealTimers());
  it("ignores programmatic moves, reacts to a drag, and settles when moves stop", () => {
    vi.useFakeTimers();
    const states: Array<string | null> = [];
    const movement = createMascotMovement(value => states.push(value));
    movement.move(100);
    movement.move(200);
    expect(states).toEqual([]);
    movement.start();
    movement.move(220);
    expect(states.at(-1)).toBe("right");
    movement.move(180);
    expect(states.at(-1)).toBe("left");
    vi.advanceTimersByTime(250);
    expect(states.at(-1)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cannot leave a pending animation after cancellation", () => {
    vi.useFakeTimers();
    const states: Array<string | null> = [];
    const movement = createMascotMovement(value => states.push(value));
    movement.move(0); movement.start(); movement.move(30); movement.stop();
    vi.advanceTimersByTime(500);
    movement.move(100);
    expect(states).toEqual(["right", null]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("resumes travel after pausing a held native drag", () => {
    vi.useFakeTimers();
    const states: Array<string | null> = [];
    const movement = createMascotMovement(value => states.push(value));
    movement.move(0); movement.start(); movement.move(30);
    vi.advanceTimersByTime(300);
    movement.move(60);
    expect(states).toEqual(["right", null, "right"]);
    movement.stop();
  });
});
