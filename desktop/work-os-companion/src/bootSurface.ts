/**
 * Which surface the companion boots into.
 *
 * These gates used to be a chain of early returns inside `App`, and their order
 * was invisible: nothing said why one came before another, and nothing failed if
 * two of them were swapped. That mattered — the admin console's gate sat *above*
 * the onboarding gate, so an administrator signing in on a fresh device landed
 * straight in the console and never completed setup at all. The account kept
 * reporting that onboarding was required, forever, while the person worked
 * around a person record that did not exist yet.
 *
 * So the decision lives here instead: one ordered list, stated once, with the
 * reasoning attached and a test that fails if a future edit reorders it by
 * accident.
 */

export type BootSurface =
  /** Opening this device's saved session. */
  | "vault_loading"
  /** The saved session could not be opened. */
  | "vault_failed"
  /** No workspace connection yet. */
  | "connect"
  /** Connected, waiting on the schedule and workday. */
  | "data_loading"
  /** Employee setup is incomplete. */
  | "onboarding"
  /** The administration workspace. */
  | "admin"
  /** The employee workspace. */
  | "workspace";

export interface BootInput {
  vault: "pending" | "ready" | "failed";
  /** A session exists for the person using this device. */
  signedIn: boolean;
  /** The onboarding record has arrived; until then nothing can be decided. */
  onboardingLoaded: boolean;
  onboardingRequired: boolean;
  /** The shell this device last chose, or "employee" when it never has. */
  workspace: "employee" | "admin";
  /** The signed-in account's role, once the session query has answered. */
  role: string | null;
  /** Offline fixtures: no backend, so no administration surface. */
  syncBypass: boolean;
}

export function bootSurface(input: BootInput): BootSurface {
  if (input.vault === "pending") return "vault_loading";
  if (input.vault === "failed") return "vault_failed";
  if (!input.signedIn) return "connect";
  if (!input.onboardingLoaded) return "data_loading";

  /*
   * Setup, then the choice of shell.
   *
   * This order is the point of the module. Onboarding asks for the things that
   * make a person a person in the workspace — their name, timezone, workday,
   * notification and privacy choices — and the server gates most employee
   * endpoints on that record existing. An administrator who has not been through
   * it is not a fully-formed account, so the console cannot come first. The
   * requirement is satisfiable from the form itself: `onboardingRequired` counts
   * only the employee-owned answers, and `managerAssigned` is already true for an
   * admin, so nobody is sent to a screen they cannot finish.
   */
  if (input.onboardingRequired) return "onboarding";

  // The administration workspace is a real session talking to a real server; it
  // has no offline fixture, so bypass mode always lands on the employee shell.
  if (input.workspace === "admin" && input.role === "admin" && !input.syncBypass) return "admin";

  return "workspace";
}
