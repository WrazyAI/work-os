import type { OttoPose, OttoTone } from "./Otto";

export type MascotAgentActivity = "idle" | "working" | "needs-input" | "ready" | "blocked";
export type MascotWorkdayState =
  | "disconnected"
  | "off-shift"
  | "active"
  | "paused"
  | "late"
  | "check-in-due"
  | "eod-due";

export interface MascotVisualInput {
  agent: MascotAgentActivity;
  workday: MascotWorkdayState;
}

export interface MascotVisualState {
  activity: MascotAgentActivity;
  workday: MascotWorkdayState;
  pose: OttoPose;
  tone: OttoTone;
  label: string;
  attention: boolean;
  transient: boolean;
}

const WORKDAY_IDLE_POSE: Record<MascotWorkdayState, OttoPose> = {
  disconnected: "idle",
  "off-shift": "sleep",
  active: "focus",
  paused: "rest",
  late: "focus",
  "check-in-due": "alert",
  "eod-due": "alert",
};

const WORKDAY_LABEL: Record<MascotWorkdayState, string> = {
  disconnected: "Connect",
  "off-shift": "Resting",
  active: "Focused",
  paused: "Paused",
  late: "Late start",
  "check-in-due": "Check in",
  "eod-due": "Wrap up",
};

/** Maps product truth to mascot presentation.
 *
 * Agent activity owns the character's primary expression. Workday state is the
 * secondary context: it supplies the idle pose and persistent tone without
 * forcing every product state to invent its own animation.
 */
export function deriveMascotVisualState({ agent, workday }: MascotVisualInput): MascotVisualState {
  const tone: OttoTone = workday === "late" ? "late" : "signal";

  if (agent === "blocked") {
    return { activity: agent, workday, pose: "recover", tone, label: "Blocked", attention: true, transient: false };
  }
  if (agent === "needs-input") {
    return { activity: agent, workday, pose: "alert", tone, label: "Needs input", attention: true, transient: false };
  }
  if (agent === "ready") {
    return { activity: agent, workday, pose: "celebrate", tone, label: "Ready", attention: false, transient: true };
  }
  if (agent === "working") {
    return { activity: agent, workday, pose: "think", tone, label: "Working", attention: false, transient: false };
  }

  return {
    activity: "idle",
    workday,
    pose: WORKDAY_IDLE_POSE[workday],
    tone,
    label: WORKDAY_LABEL[workday],
    attention: workday === "check-in-due" || workday === "eod-due",
    transient: false,
  };
}
