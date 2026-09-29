/** When the main window opens the plan modal on its own.
 *
 * A launch paints the last persisted workday snapshot before the live read
 * lands, so a confirmed plan can briefly look unresolved. The auto-open
 * therefore waits for a live server day payload, and an auto-opened modal
 * closes again as soon as the plan proves resolved. `design.md` §8.7 owns the
 * reminder contract; this gate keeps the modal out of that stale window. */
export interface PlanningAutoOpenInput {
  active: boolean;
  /** True once a live server day payload has been applied this session. */
  dayLive: boolean;
  promptKind: string | null | undefined;
  promptRequired: boolean | null | undefined;
  planStatus: string | null | undefined;
}

export function shouldAutoOpenPlanning(input: PlanningAutoOpenInput): boolean {
  if (!input.active || !input.dayLive) return false;
  return input.promptKind === "plan" && input.promptRequired === true && input.planStatus !== "confirmed";
}

export function shouldCloseAutoOpenedPlanning(input: { open: boolean; autoOpened: boolean; planStatus: string | null | undefined }): boolean {
  return input.open && input.autoOpened && input.planStatus === "confirmed";
}
