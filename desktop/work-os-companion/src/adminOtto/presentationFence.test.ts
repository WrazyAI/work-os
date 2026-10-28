import { describe, expect, it, vi } from "vitest";
import type { OttoScope } from "../../../../src/modules/work-os/admin-otto/contracts";
import { startAdminRecapDelivery } from "./delivery";
import { presentAdminRecapArrival, type AdminRecapPresentationFence } from "./notifications";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const scope: OttoScope = { userId: "admin", organizationId: "org", mode: "admin" };

describe("delivery -> real presentation adapter cancellation", () => {
  for (const waitAt of ["permission", "visibility", "final_canPresent"] as const) {
    it.each(["stop", "mode", "account", "organization", "epoch"] as const)(
      `never displays or acknowledges after %s while awaiting ${waitAt}`, async (boundary) => {
        const waiting = deferred<void>();
        const permission = deferred<"granted">();
        const visibility = deferred<boolean>();
        const canPresent = deferred<boolean>();
        const os = vi.fn();
        const inApp = vi.fn(() => true);
        const states: string[] = [];
        let current = { scope: { ...scope }, epoch: 1 };
        let claims = 0, checks = 0;
        let presentationFence: AdminRecapPresentationFence | undefined;
        const delivery = startAdminRecapDelivery({
          scope, epoch: 1, deviceId: "device", windowId: "main",
          isCurrent: (epoch) => current.epoch === epoch && current.scope.userId === scope.userId
            && current.scope.organizationId === scope.organizationId && current.scope.mode === scope.mode,
          api: {
            fetchInbox: async () => ({ items: [], total: 1, nextCursor: null, unread: 1, catchupPending: false, asOf: "", coverage: [] }),
            claim: async () => ++claims === 1 ? { token: "lease", eventIds: ["event"], pendingCount: 1, expiresAt: new Date(Date.now() + 30_000).toISOString() } : null,
            updateState: async (input) => { states.push(input.action); },
          },
          canPresent: () => {
            if (++checks === 3 && waitAt === "final_canPresent") { waiting.resolve(); return canPresent.promise; }
            return true;
          },
          onArrival: (arrival, fence) => {
            presentationFence = fence;
            return presentAdminRecapArrival(arrival.count, {
            ...fence,
            inApp: waitAt === "permission" ? undefined : inApp,
            host: {
              isTauri: true,
              isWindowVisible: () => { if (waitAt === "visibility") { waiting.resolve(); return visibility.promise; } return false; },
              requestPermission: () => { waiting.resolve(); return permission.promise; },
              sendNotification: os,
            },
            });
          },
        });
        const poll = delivery.pollNow();
        await waiting.promise;
        if (boundary === "stop") await delivery.stop();
        else if (boundary === "mode") await delivery.setMode("employee");
        else if (boundary === "account") current = { ...current, scope: { ...scope, userId: "new-admin" } };
        else if (boundary === "organization") current = { ...current, scope: { ...scope, organizationId: "new-org" } };
        else current = { ...current, epoch: 2 };
        if (waitAt !== "final_canPresent") {
          expect(presentationFence?.isCurrent()).toBe(false);
          if (boundary === "stop" || boundary === "mode") expect(presentationFence?.signal.aborted).toBe(true);
        }
        permission.resolve("granted"); visibility.resolve(true); canPresent.resolve(true);
        await poll;
        expect(os).not.toHaveBeenCalled();
        expect(inApp).not.toHaveBeenCalled();
        expect(states).not.toContain("presented");
        expect(states).toContain("release");
        await delivery.stop();
      },
    );
  }
});
