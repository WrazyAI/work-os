import { describe, expect, it } from "vitest";
import { MASCOT_ACTIVITIES, MASCOT_WORKDAYS } from "./mascotRuntimeModel";
import { MASCOT_MATRIX_STATES } from "./mascotDebugMatrix";

describe("debugger mascot matrix", () => {
  it("keeps both axes unique", () => {
    expect(new Set(MASCOT_WORKDAYS).size).toBe(MASCOT_WORKDAYS.length);
    expect(new Set(MASCOT_ACTIVITIES).size).toBe(MASCOT_ACTIVITIES.length);
  });

  it("renders every unique workday and activity combination exactly once", () => {
    expect(MASCOT_MATRIX_STATES).toHaveLength(MASCOT_WORKDAYS.length * MASCOT_ACTIVITIES.length);
    expect(new Set(MASCOT_MATRIX_STATES.map((state) => state.key)).size).toBe(MASCOT_MATRIX_STATES.length);
    expect(new Set(MASCOT_MATRIX_STATES.map((state) => `${state.workday}/${state.agent}`)).size).toBe(MASCOT_MATRIX_STATES.length);
    for (const workday of MASCOT_WORKDAYS) {
      for (const agent of MASCOT_ACTIVITIES) {
        expect(MASCOT_MATRIX_STATES.filter((state) => state.workday === workday && state.agent === agent)).toHaveLength(1);
      }
    }
  });
});
