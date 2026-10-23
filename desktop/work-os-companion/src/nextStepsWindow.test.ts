import { describe, expect, it } from "vitest";
import {
  NEXT_STEPS_MAX_HEIGHT,
  NEXT_STEPS_WAIT_HEIGHT,
  nextStepsBubbleHeight,
  nextStepsWindow,
} from "./nextStepsWindow";
import type { RecapNextStepsMoment } from "./RecapNextStepsCard";

const item = (index: number) => ({
  proposalId: `p-${index}`,
  operation: "create_task" as const,
  status: "pending",
  title: `Suggestion ${index}`,
  rationale: "A concrete deliverable from the recap.",
  taskId: null,
  editable: true,
});

const moment = (status: RecapNextStepsMoment["status"], count: number): RecapNextStepsMoment => ({
  intervalId: "interval-1",
  label: "2:17–3:17 PM",
  status,
  items: Array.from({ length: count }, (_, index) => item(index)),
  states: {},
  failures: {},
});

const monitor = { width: 1440, height: 900 };
const position = { x: 600, y: 600 };

describe("nextStepsWindow", () => {
  it("gives the wait states one quiet block", () => {
    expect(nextStepsBubbleHeight(moment("drafting", 0))).toBe(NEXT_STEPS_WAIT_HEIGHT);
    expect(nextStepsBubbleHeight(moment("failed", 0))).toBe(NEXT_STEPS_WAIT_HEIGHT);
    expect(nextStepsBubbleHeight(moment("empty", 0))).toBe(NEXT_STEPS_WAIT_HEIGHT);
    expect(nextStepsBubbleHeight(null)).toBe(0);
  });

  it("grows with the visible rows and stops at the scroll cap", () => {
    const one = nextStepsBubbleHeight(moment("ready", 1));
    const three = nextStepsBubbleHeight(moment("ready", 3));
    const five = nextStepsBubbleHeight(moment("ready", 5));
    expect(one).toBeLessThan(three);
    expect(three).toBe(NEXT_STEPS_MAX_HEIGHT - 8);
    // A fourth item scrolls inside the bubble instead of growing the window.
    expect(five).toBe(three);
  });

  it("grows upward and widens without moving the mascot", () => {
    const { size, position: grown } = nextStepsWindow(moment("ready", 3), monitor, position);
    expect(size.width).toBe(320);
    expect(size.height).toBe(276 + (nextStepsBubbleHeight(moment("ready", 3)) - 88));
    // The bottom edge — the mascot and the elapsed pill — holds still.
    expect(grown.y + size.height).toBe(position.y + 276);
    expect(grown.x).toBe(position.x - (320 - 200) / 2);
  });

  it("grows for the rendered card, which a wrapped title makes taller than the estimate", () => {
    const estimate = nextStepsBubbleHeight(moment("ready", 1));
    const measured = 242;
    expect(measured).toBeGreaterThan(estimate);
    const { size, position: grown } = nextStepsWindow(moment("ready", 1), monitor, position, measured);
    expect(size.height).toBe(276 + (measured - 88));
    // The mascot and the elapsed pill still hold their screen position.
    expect(grown.y + size.height).toBe(position.y + 276);
  });

  it("never shrinks below the resting window for a small measured card", () => {
    const { size } = nextStepsWindow(moment("ready", 1), monitor, position, 40);
    expect(size.height).toBe(276);
  });

  it("keeps the resting width on a monitor too narrow for the measure", () => {
    const narrow = { width: 240, height: 600 };
    const { size } = nextStepsWindow(moment("ready", 3), narrow, { x: 20, y: 300 });
    expect(size.width).toBe(200);
  });

  it("never leaves the monitor when the companion sits at the top", () => {
    const { size, position: grown } = nextStepsWindow(moment("ready", 3), monitor, { x: 0, y: 0 });
    expect(grown.y).toBe(0);
    expect(grown.x).toBeGreaterThanOrEqual(0);
    expect(grown.y + size.height).toBeLessThanOrEqual(monitor.height);
  });
});
