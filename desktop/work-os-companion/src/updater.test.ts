import { describe, expect, it } from "vitest";
import {
  UPDATE_AVAILABLE_KEY,
  isManagedUpdateChannel,
  shouldAutoCheckUpdate,
  updateAuthHeaders,
  updateAvailableCopy,
  updateChannelOrigin,
} from "./updater";

describe("updateChannelOrigin", () => {
  it("points at the WrazyOS catalog by default", () => {
    expect(updateChannelOrigin()).toBe("https://app.wrazyos.com");
  });
});

describe("isManagedUpdateChannel", () => {
  it("uses the companion catalog for the WrazyOS origin", () => {
    expect(isManagedUpdateChannel("https://app.wrazyos.com")).toBe(false);
  });

  it("defers to the server for any other origin", () => {
    expect(isManagedUpdateChannel("https://updates.example.com")).toBe(true);
  });

  it("defers when the address is not a URL at all", () => {
    expect(isManagedUpdateChannel("not a url")).toBe(true);
  });
});

describe("updateAuthHeaders", () => {
  it("carries the session token and organization scope", () => {
    expect(updateAuthHeaders({ token: "t-1", organizationId: "org-1" })).toEqual({
      Authorization: "Bearer t-1",
      "X-Work-OS-Organization-Id": "org-1",
    });
  });
});

describe("shouldAutoCheckUpdate", () => {
  const base = { supported: true, debugEnabled: false, hasSession: true, autoCheckUpdates: true };

  it("checks on launch when everything lines up", () => {
    expect(shouldAutoCheckUpdate(base)).toBe(true);
  });

  it("stays quiet without a native runtime, session, or opt-in", () => {
    expect(shouldAutoCheckUpdate({ ...base, supported: false })).toBe(false);
    expect(shouldAutoCheckUpdate({ ...base, hasSession: false })).toBe(false);
    expect(shouldAutoCheckUpdate({ ...base, autoCheckUpdates: false })).toBe(false);
  });

  it("never phones home from debug scenarios", () => {
    expect(shouldAutoCheckUpdate({ ...base, debugEnabled: true })).toBe(false);
  });
});

describe("updateAvailableCopy", () => {
  it("names the exact version and the restart consequence", () => {
    const copy = updateAvailableCopy("0.2.61");
    expect(copy.title).toContain("0.2.61");
    expect(copy.message).toContain("0.2.61");
    expect(copy.message).toMatch(/restart/i);
    expect(copy.message).toMatch(/run the setup again/i);
    expect(copy.actionLabel).toBe("Install & restart");
  });

  it("uses a stable flyout key so repeats replace instead of stacking", () => {
    expect(UPDATE_AVAILABLE_KEY).toBe("work-os-update-available");
  });
});
