import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bootSurface, type BootInput } from "./bootSurface";

const base: BootInput = {
  vault: "ready",
  signedIn: true,
  onboardingLoaded: true,
  onboardingRequired: false,
  workspace: "employee",
  role: "employee",
  syncBypass: false,
};

const surface = (patch: Partial<BootInput>) => bootSurface({ ...base, ...patch });

describe("boot surface", () => {
  it("opens the device before it opens the workspace", () => {
    expect(surface({ vault: "pending" })).toBe("vault_loading");
    expect(surface({ vault: "failed" })).toBe("vault_failed");
    // The vault is decided first even when everything after it would decide the
    // answer on its own.
    expect(surface({ vault: "failed", onboardingRequired: true })).toBe("vault_failed");
  });

  it("asks for a workspace connection before anything else", () => {
    expect(surface({ signedIn: false })).toBe("connect");
    expect(surface({ signedIn: false, onboardingRequired: true })).toBe("connect");
  });

  it("waits for the schedule instead of guessing at the setup state", () => {
    expect(surface({ onboardingLoaded: false })).toBe("data_loading");
    // Guessing here would flash the workspace and then replace it.
    expect(surface({ onboardingLoaded: false, onboardingRequired: true })).toBe("data_loading");
    expect(surface({ onboardingLoaded: false, role: "admin", workspace: "admin" })).toBe("data_loading");
  });

  it("puts an administrator through setup before the console", () => {
    // The regression this module exists for: an admin on a fresh device used to
    // land in the console and never complete onboarding, which then reported
    // itself as required for the life of the account.
    expect(surface({ role: "admin", workspace: "admin", onboardingRequired: true })).toBe("onboarding");
  });

  it("lands an administrator in the console once setup is done", () => {
    expect(surface({ role: "admin", workspace: "admin" })).toBe("admin");
  });

  it("keeps an administrator on the employee shell when that is what they chose", () => {
    expect(surface({ role: "admin", workspace: "employee" })).toBe("workspace");
  });

  it("refuses the console to an account whose role does not allow it", () => {
    // A stored preference is not permission: the role decides.
    expect(surface({ role: "employee", workspace: "admin" })).toBe("workspace");
    expect(surface({ role: null, workspace: "admin" })).toBe("workspace");
    expect(surface({ role: "manager", workspace: "admin" })).toBe("workspace");
  });

  it("never offers the console in offline fixture mode", () => {
    expect(surface({ syncBypass: true, role: "admin", workspace: "admin" })).toBe("workspace");
    // ...and setup still applies there, because the fixtures simulate it.
    expect(surface({ syncBypass: true, onboardingRequired: true })).toBe("onboarding");
  });

  it("gives an ordinary employee their workspace", () => {
    expect(surface({})).toBe("workspace");
  });
});

/**
 * The module above is only load-bearing if `App` actually consults it in the
 * same order. These read the boot gates out of the source, because the bug this
 * replaced was never a wrong decision — it was a right decision asked in the
 * wrong order, which no unit test of the decision alone can catch.
 */
describe("boot gate wiring", () => {
  const app = readFileSync(fileURLToPath(new URL("./App.tsx", import.meta.url)), "utf8");

  it("asks the tested seam for the landing surface", () => {
    expect(app).toMatch(/bootSurface\(\{/);
    expect(app).toMatch(/if \(landing === "admin"/);
  });

  it("puts the onboarding gate above the administration gate", () => {
    const onboarding = app.indexOf("visibleOnboarding.onboardingRequired) return <Onboarding");
    const admin = app.indexOf('if (landing === "admin"');
    expect(onboarding, "the onboarding gate is missing from App.tsx").toBeGreaterThan(-1);
    expect(admin, "the administration gate is missing from App.tsx").toBeGreaterThan(-1);
    expect(onboarding, "onboarding must be decided before the admin console").toBeLessThan(admin);
  });

  it("puts both of them below the session and vault gates", () => {
    const connect = app.indexOf("if (!visibleSession) return <ConnectScreen");
    const onboarding = app.indexOf("visibleOnboarding.onboardingRequired) return <Onboarding");
    expect(connect).toBeGreaterThan(-1);
    expect(connect).toBeLessThan(onboarding);
  });
});
