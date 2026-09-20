import type { MascotAgentActivity } from "./mascotState";
export type MascotSequence = "success" | "interrupt" | "recover";
export const MASCOT_SEQUENCES: Record<MascotSequence, ReadonlyArray<{ after: number; activity: MascotAgentActivity | null }>> = {
  success: [{ after: 0, activity: "working" }, { after: 1_500, activity: "ready" }, { after: 3_300, activity: null }],
  interrupt: [{ after: 0, activity: "working" }, { after: 1_000, activity: "needs-input" }],
  recover: [{ after: 0, activity: "working" }, { after: 1_000, activity: "blocked" }, { after: 2_500, activity: "working" }, { after: 4_000, activity: "ready" }, { after: 5_800, activity: null }],
};
