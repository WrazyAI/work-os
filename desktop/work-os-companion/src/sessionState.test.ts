import { describe, expect, it } from "vitest";
import { isSessionExpired, sessionNotice, sessionStateFrom } from "./sessionState";

const NOW = Date.parse("2026-10-15T20:00:00.000Z");
const normalize = (value: string) => {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Use the HTTPS WrazyOS URL.");
  return url.origin;
};

function stored(overrides: Record<string, unknown> = {}) {
  return {
    token: "token",
    expiresAt: "2026-11-06T19:09:21.220Z",
    organizationId: "org",
    apiBase: "https://app.wrazyos.com",
    ...overrides,
  };
}

describe("device session state", () => {
  it("keeps a session that is still usable", () => {
    const state = sessionStateFrom(stored(), normalize, NOW);
    expect(state.reason).toBe("none");
    expect(state.session?.token).toBe("token");
    expect(state.session?.apiBase).toBe("https://app.wrazyos.com");
  });

  it("reports an expired session instead of signing the workspace in with it", () => {
    // This is the state that used to open the workspace while every request
    // failed with "Connect this device to WrazyOS.".
    const state = sessionStateFrom(stored({ expiresAt: "2026-10-07T19:06:37.839Z" }), normalize, NOW);
    expect(state.session).toBeNull();
    expect(state.reason).toBe("expired");
    expect(sessionNotice(state.reason)).toContain("expired");
    expect(sessionNotice(state.reason)).toContain("nothing you filed is lost");
  });

  it("treats a session with no usable token as unusable", () => {
    expect(sessionStateFrom(stored({ token: "" }), normalize, NOW).reason).toBe("invalid");
    expect(sessionStateFrom(stored({ apiBase: "http://plain.example.com" }), normalize, NOW).reason).toBe("invalid");
    expect(sessionStateFrom(null, normalize, NOW)).toEqual({ session: null, reason: "none" });
  });

  it("leaves an unparsable expiry to the server", () => {
    // Only the server can reject a token it no longer accepts; guessing here
    // would sign out a device whose token is perfectly good.
    const state = sessionStateFrom(stored({ expiresAt: "not a date" }), normalize, NOW);
    expect(state.session?.token).toBe("token");
    expect(state.reason).toBe("none");
    expect(isSessionExpired({ expiresAt: "not a date" }, NOW)).toBe(false);
  });

  it("agrees with the API layer at the boundary", () => {
    const expiresAt = new Date(NOW).toISOString();
    expect(isSessionExpired({ expiresAt }, NOW)).toBe(true);
    expect(isSessionExpired({ expiresAt }, NOW - 1)).toBe(false);
    expect(sessionStateFrom(stored({ expiresAt: new Date(NOW).toISOString() }), normalize, NOW).reason).toBe("expired");
  });

  it("has no notice for a healthy device", () => {
    expect(sessionNotice("none")).toBeNull();
  });
});
