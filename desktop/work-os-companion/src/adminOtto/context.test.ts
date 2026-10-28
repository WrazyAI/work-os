import { describe, expect, it, vi } from "vitest";
import type { OttoScope } from "../../../../src/modules/work-os/admin-otto/contracts";
import {
  adminOttoContextAvailability,
  createAdminOttoContextRetry,
  type AdminOttoContextView,
} from "./context";

const scope: OttoScope = { userId: "user-1", organizationId: "org-1", mode: "admin" };
const view = (personId: string | null = null): AdminOttoContextView => ({
  scope,
  personId,
  voiceAvailable: true,
  transcriptionAvailable: false,
});

describe("admin Otto context availability and retry", () => {
  it("names the explicit degraded states instead of reusing employee scope", () => {
    expect(adminOttoContextAvailability({
      adminShell: true, workspace: "admin", context: null,
    })).toBe("loading");
    expect(adminOttoContextAvailability({
      adminShell: true, workspace: "admin", context: { status: "failed", personId: null },
    })).toBe("failed");
    expect(adminOttoContextAvailability({
      adminShell: true, workspace: "admin", context: { status: "ready", personId: null },
    })).toBe("unmapped");
    expect(adminOttoContextAvailability({
      adminShell: true, workspace: "admin", context: { status: "ready", personId: "person-1" },
    })).toBe("ready");
    expect(adminOttoContextAvailability({
      adminShell: false, workspace: "employee", context: { status: "ready", personId: "person-1" },
    })).toBe("employee");
  });

  it("retries from New chat instead of reporting an unavailable dead end", async () => {
    const refetch = vi.fn(async () => ({ data: view(null), error: null }));
    const retry = createAdminOttoContextRetry(refetch);
    await expect(retry.retry()).resolves.toMatchObject({ status: "ready", context: { personId: null }, stale: false });
    expect(refetch).toHaveBeenCalledTimes(1);
    await expect(retry.retry(view(null))).resolves.toMatchObject({ status: "ready", stale: false });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("reports a real failure without throwing or opening the entry", async () => {
    const retry = createAdminOttoContextRetry(async () => ({ data: undefined, error: new Error("offline") }));
    await expect(retry.retry(null)).resolves.toMatchObject({ status: "failed", context: null, error: expect.any(Error) });
  });

  it("cancels a stale retry so an older response cannot replace the current attempt", async () => {
    const pending: Array<(value: { data: AdminOttoContextView; error: null }) => void> = [];
    const retry = createAdminOttoContextRetry(() => new Promise((resolve) => { pending.push(resolve); }));
    const first = retry.retry(null);
    const second = retry.retry(null);
    pending[1]({ data: view("person-2"), error: null });
    await expect(second).resolves.toMatchObject({ status: "ready", context: { personId: "person-2" }, stale: false });
    pending[0]({ data: view("person-1"), error: null });
    await expect(first).resolves.toMatchObject({ status: "ready", context: { personId: "person-1" }, stale: true });
    expect(retry.currentAttempt()).toBe(2);
  });
});
