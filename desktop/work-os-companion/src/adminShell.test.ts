import { describe, expect, it } from "vitest";
import { ADMIN_SHELL_GUIDE_STATES, ADMIN_SHELL_NOTIFICATION_STATES, ADMIN_SHELL_OTTO_STATES, ADMIN_SHELL_OVERLAYS, ADMIN_SHELL_SESSION, ADMIN_SHELL_SETTINGS_STATES, adminShellGuideStateFor, adminShellNotificationStateFor, adminShellOttoStateFor, adminShellOverlayFor, adminShellSettingsAccountFor, adminShellSettingsStateFor, isAdminShellBoot } from "./adminShell";
import { GUIDE_VIEWS } from "./guideState";

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

  it("pins the bell's fixture state only on the dev boot, defaulting to populated", () => {
    expect(adminShellNotificationStateFor("?admin-shell", true)).toBe("populated");
    for (const state of ADMIN_SHELL_NOTIFICATION_STATES) {
      expect(adminShellNotificationStateFor(`?admin-shell&notifications=${state}`, true)).toBe(state);
    }
    // An unknown value must never strand the boot on an undefined state.
    expect(adminShellNotificationStateFor("?admin-shell&notifications=unknown", true)).toBe("populated");
    expect(adminShellNotificationStateFor("?admin-shell", false)).toBe(null);
    expect(adminShellNotificationStateFor("?preview-admin&notifications=empty", true)).toBe(null);
  });

  it("fabricates the admin session the shell branches on", () => {
    expect(ADMIN_SHELL_SESSION.role).toBe("admin");
    expect(ADMIN_SHELL_SESSION.personId).toBe("debug-person-1");
  });

  it("opens only known admin Otto fixture states on the dev boot", () => {
    for (const state of ADMIN_SHELL_OTTO_STATES) {
      expect(adminShellOttoStateFor(`?admin-shell&otto=${state}`, true)).toBe(state);
    }
    expect(adminShellOttoStateFor("?admin-shell", true)).toBe(null);
    expect(adminShellOttoStateFor("?admin-shell&otto=unknown", true)).toBe(null);
    expect(adminShellOttoStateFor("?preview-admin&otto=chat", true)).toBe(null);
    expect(adminShellOttoStateFor("?admin-shell&otto=chat", false)).toBe(null);
  });

  it("opens the follow fixture on All by default and keeps a second account separate", () => {
    expect(adminShellSettingsStateFor("?admin-shell", true)).toBe("all");
    for (const state of ADMIN_SHELL_SETTINGS_STATES) {
      expect(adminShellSettingsStateFor(`?admin-shell&settings=${state}`, true)).toBe(state);
    }
    expect(adminShellSettingsStateFor("?admin-shell&settings=unknown", true)).toBe("all");
    expect(adminShellSettingsStateFor("?admin-shell&settings=selected-none", false)).toBe(null);
    expect(adminShellSettingsStateFor("?preview-admin&settings=selected-none", true)).toBe(null);
    expect(adminShellSettingsAccountFor("?admin-shell&settings-account=two", true)).toBe("two");
    expect(adminShellSettingsAccountFor("?admin-shell", true)).toBe("one");
    expect(adminShellSettingsAccountFor("?admin-shell&settings-account=two", false)).toBe(null);
  });

  it("boots the guide flags fresh by default and fully seen on request", () => {
    // The default stays a first visit, so the guides auto-open as designed.
    expect(adminShellGuideStateFor("?admin-shell", true)).toEqual({ guides: {}, autoOpen: true });
    // `seen` is what the film shooter boots with: nothing left to auto-open.
    const seen = adminShellGuideStateFor("?admin-shell&guides=seen", true);
    for (const view of GUIDE_VIEWS) expect(seen?.guides[view], `${view} must be seen`).toBeTruthy();
    expect(seen?.autoOpen).toBe(true);
    // An unknown value must never strand the boot on an undefined state.
    expect(adminShellGuideStateFor("?admin-shell&guides=unknown", true)).toEqual({ guides: {}, autoOpen: true });
    expect(adminShellGuideStateFor("?admin-shell&guides=seen", false)).toBe(null);
    expect(adminShellGuideStateFor("?preview-admin&guides=seen", true)).toBe(null);
    expect(ADMIN_SHELL_GUIDE_STATES).toEqual(["fresh", "seen"]);
  });
});
