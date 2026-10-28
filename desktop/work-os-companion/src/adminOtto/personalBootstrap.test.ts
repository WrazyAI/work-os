import { describe, expect, it, vi } from "vitest";
import { personalBootstrapAccess, runPersonalBootstrapRefresh } from "./personalBootstrap";

const never = () => Promise.reject(new Error("personal endpoint must not be called"));

function harness(access: ReturnType<typeof personalBootstrapAccess>) {
  const onboarding = vi.fn(async () => ({ loaded: true }));
  const day = vi.fn(async () => ({ shiftDate: "2026-10-26" }));
  return {
    onboarding,
    day,
    run: (source: "vault" | "sign_in" | "context" | "attendance" | "manual", dayOnly = false) =>
      runPersonalBootstrapRefresh({
        source,
        access,
        dayOnly,
        fetchOnboarding: onboarding,
        fetchDay: day,
      }),
  };
}

describe("admin Otto personal refresh gate", () => {
  it("does not reuse another account's mapped context after a sign-in", async () => {
    const access = personalBootstrapAccess({ signedIn: true, syncBypass: false, role: "admin", workspace: "admin",
      identity: { userId: "new", organizationId: "org" },
      adminContext: { status: "ready", personId: "old-person", scope: { userId: "old", organizationId: "org" } },
    });
    const h = harness(access);
    expect((await h.run("sign_in")).ran).toBe(false);
    expect(h.day).not.toHaveBeenCalled();
  });
  it("gates every direct refresh for an admin with a saved employee workspace", async () => {
    for (const adminContext of [null, { status: "loading" as const, personId: null },
      { status: "failed" as const, personId: null }, { status: "ready" as const, personId: null }]) {
      const h = harness(personalBootstrapAccess({
        signedIn: true, syncBypass: false, role: "admin", workspace: "employee", adminContext,
      }));
      for (const source of ["vault", "sign_in", "context", "attendance", "manual"] as const) {
        expect((await h.run(source)).ran).toBe(false);
      }
      expect(h.onboarding).not.toHaveBeenCalled();
      expect(h.day).not.toHaveBeenCalled();
    }
  });
  it("unmapped_admin_boot_does_not_fetch_me_day_or_onboarding", async () => {
    const access = personalBootstrapAccess({
      signedIn: true,
      syncBypass: false,
      role: "admin",
      workspace: "admin",
      adminContext: { status: "ready", personId: null },
    });
    expect(access).toMatchObject({ onboarding: false, day: false, reason: "admin_unmapped" });
    const h = harness(access);
    await expect(h.run("vault")).resolves.toMatchObject({ ran: false });
    // The sign-in listener is the same production path, not a second copy.
    await expect(h.run("sign_in")).resolves.toMatchObject({ ran: false });
    expect(h.onboarding).not.toHaveBeenCalled();
    expect(h.day).not.toHaveBeenCalled();
  });

  it("every_startup_personal_refresh_path_is_gated", async () => {
    for (const state of [
      { status: "loading" as const, personId: null },
      { status: "failed" as const, personId: null },
    ]) {
      const access = personalBootstrapAccess({
        signedIn: true,
        syncBypass: false,
        role: "admin",
        workspace: "admin",
        adminContext: state,
      });
      const h = harness(access);
      for (const source of ["vault", "sign_in", "context", "manual"] as const) {
        await h.run(source);
      }
      expect(h.onboarding).not.toHaveBeenCalled();
      expect(h.day).not.toHaveBeenCalled();
    }
  });

  it("mapped admin loads personal settings only after the context is ready", async () => {
    const pending = personalBootstrapAccess({
      signedIn: true, syncBypass: false, role: "admin", workspace: "admin",
      adminContext: { status: "loading", personId: "person-1" },
    });
    expect(pending).toMatchObject({ onboarding: false, day: false, reason: "admin_context_pending" });

    const ready = personalBootstrapAccess({
      signedIn: true, syncBypass: false, role: "admin", workspace: "admin",
      adminContext: { status: "ready", personId: "person-1" },
    });
    expect(ready).toMatchObject({ onboarding: true, day: true, reason: "admin_mapped" });
    const h = harness(ready);
    await expect(h.run("context")).resolves.toMatchObject({ ran: true });
    expect(h.onboarding).toHaveBeenCalledTimes(1);
    expect(h.day).toHaveBeenCalledTimes(1);
  });

  it("leaves employees and managers on their existing bootstrap", async () => {
    for (const role of ["employee", "manager"] as const) {
      const access = personalBootstrapAccess({
        signedIn: true, syncBypass: false, role, workspace: "employee", adminContext: null,
      });
      expect(access).toMatchObject({ onboarding: true, day: true, reason: "personal" });
      const h = harness(access);
      await h.run("vault", true);
      expect(h.onboarding).not.toHaveBeenCalled();
      expect(h.day).toHaveBeenCalledTimes(1);
    }
  });

  it("waits for the authoritative session instead of guessing", () => {
    expect(personalBootstrapAccess({
      signedIn: true, syncBypass: false, role: null, workspace: "employee", adminContext: null,
    })).toMatchObject({ onboarding: false, day: false, reason: "session_pending" });
    expect(personalBootstrapAccess({
      signedIn: false, syncBypass: false, role: "employee", workspace: "employee", adminContext: null,
    })).toMatchObject({ onboarding: false, day: false, reason: "signed_out" });
  });

  it("never fetches personal data through the gate for an offline fixture", async () => {
    const access = personalBootstrapAccess({
      signedIn: true, syncBypass: true, role: "employee", workspace: "employee", adminContext: null,
    });
    const h = harness(access);
    await expect(h.run("vault")).resolves.toMatchObject({ ran: false });
    expect(h.onboarding).not.toHaveBeenCalled();
    expect(h.day).not.toHaveBeenCalled();
    void never;
  });
});
