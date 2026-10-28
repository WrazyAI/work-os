import { describe, expect, it } from "vitest";
import { avatarDayAccess } from "./avatarDay";
import { personalBootstrapAccess } from "./adminOtto/personalBootstrap";

const access = (role: "admin" | "manager" | "employee", personId: string | null = null) =>
  personalBootstrapAccess({
    signedIn: true, syncBypass: false, role, workspace: "employee", identity: { userId: "user-1", organizationId: "org-1" },
    adminContext: { status: "ready", personId, scope: { userId: "user-1", organizationId: "org-1" } },
  });

describe("floating companion day access", () => {
  it("settles an unmapped administrator instead of waiting on a day read", () => {
    expect(avatarDayAccess(access("admin"))).toBe("unmapped");
  });

  it("keeps the employee and mapped-admin day behavior", () => {
    expect(avatarDayAccess(access("employee"))).toBe("load");
    expect(avatarDayAccess(access("manager"))).toBe("load");
    expect(avatarDayAccess(access("admin", "person-1"))).toBe("load");
  });

  it("still loads today when only the membership answer failed", () => {
    // /me/day authorizes itself; a failed auxiliary gate must not mark the day stale.
    expect(avatarDayAccess(null)).toBe("load");
  });

  it("waits while an administration gate has not resolved", () => {
    expect(avatarDayAccess(personalBootstrapAccess({
      signedIn: true, syncBypass: false, role: "admin", workspace: "employee",
      adminContext: { status: "loading", personId: "person-1" },
    }))).toBe("wait");
    expect(avatarDayAccess(personalBootstrapAccess({
      signedIn: true, syncBypass: false, role: "admin", workspace: "employee",
      adminContext: { status: "failed", personId: "person-1" },
    }))).toBe("wait");
  });
});
