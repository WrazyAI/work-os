import type { AdminOttoContextResponse } from "./api";

export type AdminOttoContextAvailability =
  | "employee"
  | "loading"
  | "failed"
  | "unmapped"
  | "ready";

export type AdminOttoContextView = AdminOttoContextResponse;

export function adminOttoContextAvailability(input: {
  adminShell: boolean;
  workspace: "admin" | "employee";
  context: { status: "loading" | "ready" | "failed"; personId: string | null } | null;
}): AdminOttoContextAvailability {
  if (!input.adminShell || input.workspace !== "admin") return "employee";
  if (!input.context || input.context.status === "loading") return "loading";
  if (input.context.status === "failed") return "failed";
  return input.context.personId === null ? "unmapped" : "ready";
}

export type ContextRefetchResult = {
  data?: AdminOttoContextView | null;
  error?: unknown;
};

export type ContextRetryResult = {
  status: "ready" | "failed";
  context: AdminOttoContextView | null;
  error: unknown;
  /** True when a newer retry superseded this answer; the caller must not open. */
  stale: boolean;
  attempt: number;
};

/**
 * New chat's real context retry. Each call supersedes the previous one; a late
 * answer from an abandoned attempt is reported stale and must not open the
 * entry or replace a newer context.
 */
export function createAdminOttoContextRetry(refetch: () => Promise<ContextRefetchResult>) {
  let attempt = 0;
  return {
    currentAttempt: () => attempt,
    async retry(current: AdminOttoContextView | null = null): Promise<ContextRetryResult> {
      if (current) {
        return { status: "ready", context: current, error: null, stale: false, attempt };
      }
      attempt += 1;
      const id = attempt;
      try {
        const result = await refetch();
        const stale = id !== attempt;
        if (result.error || !result.data) {
          return {
            status: stale ? "failed" : "failed",
            context: null,
            error: result.error ?? new Error("The administration context is unavailable."),
            stale,
            attempt: id,
          };
        }
        return { status: "ready", context: result.data, error: null, stale, attempt: id };
      } catch (error) {
        return {
          status: "failed",
          context: null,
          error,
          stale: id !== attempt,
          attempt: id,
        };
      }
    },
  };
}
