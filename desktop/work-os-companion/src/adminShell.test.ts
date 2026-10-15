import { describe, expect, it } from "vitest";
import { ADMIN_SHELL_OVERLAYS, ADMIN_SHELL_SESSION, adminShellOverlayFor, isAdminShellBoot } from "./adminShell";

describe("administration shell dev boot", () => {
  it("activates only in dev", () => {
    expect(isAdminShellBoot("?admin-shell", true)).toBe(true);
    expect(isAdminShellBoot("?admin-shell&overlay=profile", true)).toBe(true);
    expect(isAdminShellBoot("?admin-shell", false)).toBe(false);
    expect(isAdminShellBoot("?preview-admin", true)).toBe(false);
  });

  it("reads only known overlay names, and only in dev", () => {
    for (const overlay of ADMIN_SHELL_OVERLAYS) {
      expect(adminShellOverlayFor(`?admin-shell&overlay=${overlay}`, true)).toBe(overlay);
    }
    expect(adminShellOverlayFor("?admin-shell&overlay=unknown", true)).toBe(null);
    expect(adminShellOverlayFor("?admin-shell", true)).toBe(null);
    expect(adminShellOverlayFor("?admin-shell&overlay=memory", false)).toBe(null);
  });

  it("fabricates the admin session the shell branches on", () => {
    expect(ADMIN_SHELL_SESSION.role).toBe("admin");
    expect(ADMIN_SHELL_SESSION.personId).toBe("debug-person-1");
  });
});
