/**
 * The one gate for personal `/me/day` and `/me/onboarding` reads.
 *
 * Administration is an organization-scoped surface. An administrator whose
 * context reports no person, whose context is still loading, or whose context
 * failed must never issue the employee bootstrap reads. A mapped administrator
 * may load their own settings only after the explicit context says so; the
 * employee and manager paths keep their existing bootstrap.
 */
export type PersonalBootstrapRole = "admin" | "manager" | "employee" | null;

export type PersonalBootstrapAccess = {
  onboarding: boolean;
  day: boolean;
  reason:
    | "personal"
    | "admin_mapped"
    | "admin_unmapped"
    | "admin_context_pending"
    | "admin_context_failed"
    | "session_pending"
    | "signed_out"
    | "offline";
};

export type PersonalBootstrapInput = {
  signedIn: boolean;
  syncBypass: boolean;
  role: PersonalBootstrapRole;
  identity?: { userId: string; organizationId: string };
  workspace: "admin" | "employee";
  adminContext: { status: "loading" | "ready" | "failed"; personId: string | null;
    scope?: { userId: string; organizationId: string } } | null;
};

export function personalBootstrapAccess(input: PersonalBootstrapInput): PersonalBootstrapAccess {
  if (input.syncBypass) return { onboarding: false, day: false, reason: "offline" };
  if (!input.signedIn) return { onboarding: false, day: false, reason: "signed_out" };
  if (!input.role) return { onboarding: false, day: false, reason: "session_pending" };
  if (input.role !== "admin") {
    return { onboarding: true, day: true, reason: "personal" };
  }
  const context = input.adminContext;
  if (!context || context.status === "loading" || (input.identity
    && (context.scope?.userId !== input.identity.userId || context.scope.organizationId !== input.identity.organizationId))) {
    return { onboarding: false, day: false, reason: "admin_context_pending" };
  }
  if (context.status === "failed") {
    return { onboarding: false, day: false, reason: "admin_context_failed" };
  }
  if (context.personId === null) {
    return { onboarding: false, day: false, reason: "admin_unmapped" };
  }
  return { onboarding: true, day: true, reason: "admin_mapped" };
}

export type PersonalBootstrapSource = "vault" | "sign_in" | "context" | "attendance" | "manual";

export type PersonalBootstrapRefreshInput = {
  source: PersonalBootstrapSource;
  access: PersonalBootstrapAccess;
  dayOnly: boolean;
  fetchOnboarding: () => Promise<unknown>;
  fetchDay: () => Promise<unknown>;
};

export type PersonalBootstrapRefreshResult = {
  ran: boolean;
  onboarding: PromiseSettledResult<unknown> | null;
  day: PromiseSettledResult<unknown> | null;
};

/** The production refresh runner. When the gate is closed it makes no request
 * at all, on every caller (vault boot, desktop sign-in, context recovery,
 * attendance and manual refresh). */
export async function runPersonalBootstrapRefresh(
  input: PersonalBootstrapRefreshInput,
): Promise<PersonalBootstrapRefreshResult> {
  const fetchOnboarding = input.access.onboarding && !input.dayOnly;
  const fetchDay = input.access.day;
  if (!fetchOnboarding && !fetchDay) {
    return { ran: false, onboarding: null, day: null };
  }
  const [onboarding, day] = await Promise.all([
    fetchOnboarding
      ? Promise.allSettled([input.fetchOnboarding()]).then(([result]) => result)
      : Promise.resolve(null),
    fetchDay
      ? Promise.allSettled([input.fetchDay()]).then(([result]) => result)
      : Promise.resolve(null),
  ]);
  return { ran: true, onboarding, day };
}
