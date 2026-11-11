export const PLAN_SAVE_FALLBACK = "Your plan was not saved. Check the connection or correct the plan and try again.";

/** The save result the planner understands. A generic failure carries the
 * server's actual reason so the editor never blames the connection for a
 * validation problem. */
export type PlanningConfirmResult =
  | "confirmed"
  | "saved"
  | "queued"
  | "conflict"
  | "rebuild"
  | { failed: string };

/** Classify a rejected plan save without hiding the server's explanation.
 * Conflict and expired-build messages keep their dedicated recovery paths;
 * everything else reaches the editor as written. */
export function classifyPlanSaveFailure(value: unknown): "conflict" | "rebuild" | { failed: string } {
  const message = typeof value === "string" && value.trim()
    ? value.trim()
    : value instanceof Error && value.message.trim()
      ? value.message.trim()
      : PLAN_SAVE_FALLBACK;
  if (/changed on another device/i.test(message)) return "conflict";
  if (/AI build/i.test(message)) return "rebuild";
  return { failed: message };
}
