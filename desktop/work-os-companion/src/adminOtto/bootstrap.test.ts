import { describe, expect, it } from "vitest";
import { bootSurface, type BootInput } from "../bootSurface";
import { adminOttoRoleAllowed, personalBootstrapFlags, planAdminOttoBootstrap, type AdminOttoBootInput } from "./bootstrap";

const base: AdminOttoBootInput = {
  signedIn: true,
  syncBypass: false,
  sessionSettled: true,
  sessionFailed: false,
  role: "admin",
  workspace: "admin",
  adminContext: { status: "ready", personId: null },
};

const plan = (patch: Partial<AdminOttoBootInput> = {}) => planAdminOttoBootstrap({ ...base, ...patch });

describe("admin Otto boot planning", () => {
  it("offline fixtures disable live personal reads before the first query", () => {
    expect(personalBootstrapFlags({
      syncBypass: true,
      plan: { personalBootstrapEnabled: true, personalNotificationsEnabled: true },
    })).toEqual({ personal: false, notifications: false });
    expect(personalBootstrapFlags({
      syncBypass: false,
      plan: { personalBootstrapEnabled: true, personalNotificationsEnabled: false },
    })).toEqual({ personal: true, notifications: false });
  });

  it("employee and manager roles never start an admin controller", () => {
    expect(adminOttoRoleAllowed("employee")).toBe(false);
    expect(adminOttoRoleAllowed("manager")).toBe(false);
    expect(adminOttoRoleAllowed(null)).toBe(false);
    expect(adminOttoRoleAllowed("admin")).toBe(true);
  });

  it("unmapped_admin_boot_does_not_fetch_me_day_or_onboarding", () => {
    const unmapped = plan();
    expect(unmapped).toMatchObject({
      adminShell: true,
      adminContextRequired: true,
      personalBootstrapEnabled: false,
      personalNotificationsEnabled: false,
      switchToEmployeeAvailable: false,
      waitingForSession: false,
      waitingForAdminContext: false,
    });
    // The admin shell is a real session surface, not a fixture fallback.
    expect(unmapped.adminShell).toBe(true);
  });

  it("mapped admin may load personal settings but still cannot gate the admin shell on them", () => {
    expect(plan({ adminContext: { status: "ready", personId: "person-1" } })).toMatchObject({
      adminShell: true,
      personalBootstrapEnabled: true,
      personalNotificationsEnabled: true,
      switchToEmployeeAvailable: true,
    });
  });

  it("waits for the authoritative context before choosing the admin branch", () => {
    expect(plan({ adminContext: { status: "loading", personId: null } })).toMatchObject({
      adminShell: false,
      waitingForAdminContext: true,
      personalBootstrapEnabled: false,
    });
    // A failed context still renders the workspace shell; Otto features report
    // their own failure instead of falling back to personal bootstrap.
    expect(plan({ adminContext: { status: "failed", personId: null } })).toMatchObject({
      adminShell: true,
      personalBootstrapEnabled: false,
      personalNotificationsEnabled: false,
    });
  });

  it("leaves the employee and manager path untouched", () => {
    for (const role of ["employee", "manager"] as const) {
      expect(plan({ role, workspace: "employee", adminContext: null })).toMatchObject({
        adminShell: false,
        adminContextRequired: false,
        personalBootstrapEnabled: true,
        personalNotificationsEnabled: true,
        switchToEmployeeAvailable: false,
      });
    }
    // An admin who saved the employee workspace still waits for the
    // authoritative context before deciding whether a personal setup exists.
    expect(plan({ workspace: "employee", adminContext: null })).toMatchObject({
      adminShell: false,
      personalBootstrapEnabled: false,
      waitingForAdminContext: true,
    });
    expect(plan({ workspace: "employee", adminContext: { status: "ready", personId: "person-1" } })).toMatchObject({
      adminShell: false,
      personalBootstrapEnabled: true,
      personalNotificationsEnabled: true,
      switchToEmployeeAvailable: true,
    });
    // A saved employee workspace cannot strand an unmapped admin: the console
    // is the usable surface, and no personal setup is attempted.
    expect(plan({ workspace: "employee", adminContext: { status: "ready", personId: null } })).toMatchObject({
      adminShell: true,
      personalBootstrapEnabled: false,
      personalNotificationsEnabled: false,
      switchToEmployeeAvailable: false,
    });
  });

  it("reads the authoritative session before any personal bootstrap", () => {
    expect(plan({ sessionSettled: false, adminContext: null })).toMatchObject({
      waitingForSession: true,
      personalBootstrapEnabled: false,
      adminShell: false,
    });
    expect(plan({ sessionSettled: true, sessionFailed: true, role: null, workspace: "employee", adminContext: null }))
      .toMatchObject({ personalBootstrapEnabled: true, adminShell: false });
  });

  it("never offers the admin shell in an offline fixture", () => {
    expect(plan({ syncBypass: true, adminContext: null })).toMatchObject({
      adminShell: false,
      adminContextRequired: false,
      personalBootstrapEnabled: true,
      switchToEmployeeAvailable: false,
    });
  });

  it("holds the boot surface for the admin context instead of onboarding", () => {
    const boot: BootInput = {
      vault: "ready",
      signedIn: true,
      onboardingLoaded: false,
      onboardingRequired: true,
      workspace: "admin",
      role: "admin",
      syncBypass: false,
      dayReady: false,
      dayFailed: false,
      adminOtto: { status: "loading", personId: null, active: false },
    };
    expect(bootSurface(boot)).toBe("data_loading");
    expect(bootSurface({ ...boot, adminOtto: { status: "ready", personId: null, active: true } })).toBe("admin");
    expect(bootSurface({ ...boot, adminOtto: { status: "failed", personId: null, active: true } })).toBe("admin");
    // A saved employee workspace cannot strand an unmapped admin.
    expect(bootSurface({
      ...boot,
      workspace: "employee",
      adminOtto: { status: "ready", personId: null, active: true },
    })).toBe("admin");
    // Without the explicit admin context seam, the established order is kept.
    expect(bootSurface({ ...boot, adminOtto: undefined })).toBe("data_loading");
    expect(bootSurface({
      ...boot,
      onboardingLoaded: true,
      adminOtto: undefined,
    })).toBe("onboarding");
  });
});
