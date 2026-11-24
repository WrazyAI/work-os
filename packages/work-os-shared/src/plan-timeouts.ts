/** Client deadlines for the planning routes.
 *
 * The interpret route can run the Loom analysis (AI_TIMEOUTS.loom, 60s) and
 * the plan model (AI_TIMEOUTS.plan, 90s) in sequence. Keep the client deadline
 * above that combined budget so a transcript build is not aborted while the
 * server is still working. The refine route runs only the plan model.
 */
export const PLAN_INTERPRET_TIMEOUT_MS = 180_000;
export const PLAN_REFINE_TIMEOUT_MS = 120_000;
