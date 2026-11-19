import { MASCOT_ACTIVITIES, MASCOT_WORKDAYS } from "./mascotRuntimeModel";
import type { MascotAgentActivity, MascotWorkdayState } from "./mascotState";

export type MascotMatrixState = {
  key: string;
  workday: MascotWorkdayState;
  agent: MascotAgentActivity;
};

/** The debugger matrix is the Cartesian product of the unique workday and
 * activity states. Deduplicate defensively so a future constant edit cannot
 * render the same combination twice. */
export const MASCOT_MATRIX_STATES: MascotMatrixState[] = Array.from(new Set(MASCOT_WORKDAYS)).flatMap((workday) =>
  Array.from(new Set(MASCOT_ACTIVITIES)).map((agent) => ({ key: `${workday}:${agent}`, workday, agent })),
);
