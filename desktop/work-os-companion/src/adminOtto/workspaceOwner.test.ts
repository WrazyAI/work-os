import { describe, expect, it, vi } from "vitest";
import type { OttoScope } from "../../../../src/modules/work-os/admin-otto/contracts";
import { createWorkspaceOwner, effectiveWorkspaceMode } from "./workspaceOwner";

const actor = { userId: "user-1", organizationId: "org-1" };
const adminScope: OttoScope = { ...actor, mode: "admin" };
const employeeScope: OttoScope = { ...actor, mode: "employee" };

function state(overrides: Record<string, unknown> = {}) {
  return {
    workspace: "employee" as const,
    role: "admin" as const,
    adminStatus: "ready" as const,
    personId: "person-1",
    online: true,
    resetting: false,
    scope: employeeScope,
    actor,
    ...overrides,
  };
}

describe("workspace owner", () => {
  it("switch_awaits_controller_before_persisting_or_publishing", async () => {
    const order: string[] = [];
    let current: "employee" | "admin" = "employee";
    const owner = createWorkspaceOwner({
      read: () => ({ ...state(), workspace: current, scope: current === "employee" ? employeeScope : adminScope }),
      suspend: () => order.push("suspend"),
      switchController: async (next) => {
        order.push(`switch:${next}`);
        return { scope: next === "admin" ? adminScope : employeeScope, epoch: 2 };
      },
      commit: (next) => {
        order.push(`commit:${next}`);
        current = next;
      },
      retryContext: async () => true,
    });
    await expect(owner.request("admin")).resolves.toEqual({ ok: true });
    expect(order).toEqual(["suspend", "switch:admin", "commit:admin"]);
  });

  it("switch_failure_keeps_workspace_preference_and_thread", async () => {
    const commit = vi.fn();
    const owner = createWorkspaceOwner({
      read: () => state(),
      suspend: () => undefined,
      switchController: async () => { throw new Error("controller refused"); },
      commit,
      retryContext: async () => true,
    });
    await expect(owner.request("admin")).resolves.toEqual({ ok: false, reason: "switch_failed" });
    expect(commit).not.toHaveBeenCalled();
  });

  it("concurrent_switches_cannot_commit_out_of_order", async () => {
    let current: "employee" | "admin" = "employee";
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const commit = vi.fn();
    const owner = createWorkspaceOwner({
      read: () => ({ ...state({ workspace: current, scope: current === "admin" ? adminScope : employeeScope }) }),
      suspend: () => undefined,
      switchController: async (next) => { await gate; return { scope: next === "admin" ? adminScope : employeeScope, epoch: 2 }; },
      commit,
      retryContext: async () => true,
    });
    const first = owner.request("admin");
    current = "admin";
    await expect(owner.request("employee")).resolves.toEqual({ ok: false, reason: "switch_failed" });
    release();
    await expect(first).resolves.toEqual({ ok: true });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("admin", expect.objectContaining({ scope: adminScope }));
  });

  it("session_replacement_during_switch_has_no_commit", async () => {
    let replacement = false;
    const commit = vi.fn();
    const owner = createWorkspaceOwner({
      read: () => ({ ...state({ workspace: "employee", scope: employeeScope }), actor: replacement ? { userId: "user-2", organizationId: "org-1" } : actor }),
      suspend: () => { replacement = true; },
      switchController: async () => ({ scope: adminScope, epoch: 2 }),
      commit,
      retryContext: async () => true,
    });
    await expect(owner.request("admin")).resolves.toEqual({ ok: false, reason: "switch_failed" });
    expect(commit).not.toHaveBeenCalled();
  });

  it("retry_republishes_readiness_without_new_chat", async () => {
    const retry = vi.fn(async () => true);
    const owner = createWorkspaceOwner({
      read: () => state({ workspace: "admin", adminStatus: "failed", scope: adminScope }),
      suspend: () => undefined,
      switchController: async () => ({ scope: adminScope, epoch: 3 }),
      commit: () => undefined,
      retryContext: retry,
    });
    await expect(owner.retryContext()).resolves.toEqual({ ok: true });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("uses the effective shell during loading and after failure", () => {
    expect(effectiveWorkspaceMode({ selected: "employee", adminShell: false, waitingForContext: true })).toBe("employee");
    expect(effectiveWorkspaceMode({ selected: "admin", adminShell: false, waitingForContext: true })).toBe("admin");
    expect(effectiveWorkspaceMode({ selected: "employee", adminShell: true, waitingForContext: false })).toBe("admin");
    expect(effectiveWorkspaceMode({ selected: "employee", adminShell: false, waitingForContext: false })).toBe("employee");
  });
});
