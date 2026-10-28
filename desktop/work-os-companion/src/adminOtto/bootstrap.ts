export type AdminOttoRole = "admin" | "manager" | "employee";

export type AdminOttoContextState = {
  status: "loading" | "ready" | "failed";
  personId: string | null;
};

export type AdminOttoBootInput = {
  signedIn: boolean;
  /** Offline fixture boot has no backend, so the admin shell is unavailable. */
  syncBypass: boolean;
  /** The authoritative session query has answered (success or failure). */
  sessionSettled: boolean;
  sessionFailed: boolean;
  role: AdminOttoRole | null;
  workspace: "admin" | "employee";
  /** Null until the query is enabled or while it has no answer. */
  adminContext: AdminOttoContextState | null;
};

export type AdminOttoBootPlan = {
  /** Hold the boot surface until the role is authoritative. */
  waitingForSession: boolean;
  /** The admin context POST must run before the shell is usable. */
  adminContextRequired: boolean;
  /** The context POST has answered (ready or failed). */
  waitingForAdminContext: boolean;
  adminShell: boolean;
  /**
   * `/api/work-os/me/day` and `/me/onboarding` may run. Administration never
   * depends on a person mapping: an unmapped admin keeps this false, while a
   * mapped admin may load their own settings alongside the console without
   * either read gating the console.
   */
  personalBootstrapEnabled: boolean;
  /** The account's own employee notification reads (outstanding EOD, memory). */
  personalNotificationsEnabled: boolean;
  switchToEmployeeAvailable: boolean;
};

const IDLE: AdminOttoBootPlan = {
  waitingForSession: false,
  adminContextRequired: false,
  waitingForAdminContext: false,
  adminShell: false,
  personalBootstrapEnabled: false,
  personalNotificationsEnabled: false,
  switchToEmployeeAvailable: false,
};

/**
 * One decision for the companion's two workspaces.
 *
 * The admin shell reads the authoritative session and the explicit admin
 * context before choosing any personal bootstrap. An unmapped administrator
 * therefore never calls `/me/day` or `/me/onboarding`; a mapped administrator
 * on the admin shell skips them too, because administration is an
 * organization-scoped surface. The employee and manager paths are unchanged.
 */
/** Only administrators ever create an admin controller or delivery loop. */
export function adminOttoRoleAllowed(role: AdminOttoRole | null): boolean {
  return role === "admin";
}

/** The employee fixture must never issue live personal reads before its hooks
 * are disabled; the offline flag wins over every plan state. */
export function personalBootstrapFlags(input: {
  syncBypass: boolean;
  plan: Pick<AdminOttoBootPlan, "personalBootstrapEnabled" | "personalNotificationsEnabled">;
}): { personal: boolean; notifications: boolean } {
  if (input.syncBypass) return { personal: false, notifications: false };
  return {
    personal: input.plan.personalBootstrapEnabled,
    notifications: input.plan.personalNotificationsEnabled,
  };
}

export function planAdminOttoBootstrap(input: AdminOttoBootInput): AdminOttoBootPlan {
  if (!input.signedIn) return { ...IDLE };
  if (input.syncBypass) {
    return {
      ...IDLE,
      personalBootstrapEnabled: true,
      personalNotificationsEnabled: true,
    };
  }
  if (!input.sessionSettled) {
    return { ...IDLE, waitingForSession: true };
  }
  if (input.sessionFailed) {
    // A failed session probe must not strand an employee behind a spinner;
    // the employee reads surface their own authoritative failure.
    return {
      ...IDLE,
      personalBootstrapEnabled: true,
      personalNotificationsEnabled: true,
    };
  }

  if (input.role !== "admin") {
    return {
      ...IDLE,
      personalBootstrapEnabled: true,
      personalNotificationsEnabled: true,
    };
  }

  /* Every administrator needs the authoritative context, even when this
   * device saved the employee workspace: an unmapped admin must not be left in
   * a personal setup they cannot complete. A mapped admin still falls through
   * to the employee workspace when that is what they chose. */
  const context = input.adminContext;
  const settled = context !== null && context.status !== "loading";
  const mapped = context?.status === "ready" && context.personId !== null;
  const blocked = context?.status === "failed";
  const adminShell = settled && (blocked || input.workspace === "admin" || context?.personId === null);
  return {
    waitingForSession: false,
    adminContextRequired: true,
    waitingForAdminContext: !settled,
    adminShell,
    personalBootstrapEnabled: mapped && !blocked,
    personalNotificationsEnabled: mapped && !blocked,
    switchToEmployeeAvailable: mapped && !blocked,
  };
}
