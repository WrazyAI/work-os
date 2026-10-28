import { describe, expect, it, vi } from "vitest";
import { presentAdminRecapArrival, recapArrivalCopy, type AdminRecapPresentationHost } from "./notifications";

const native = vi.hoisted(() => ({
  isPermissionGranted: vi.fn<() => Promise<boolean>>(),
  requestPermission: vi.fn<() => Promise<string>>(),
  sendNotification: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/plugin-notification", () => native);

function host(overrides: Partial<AdminRecapPresentationHost> = {}): AdminRecapPresentationHost {
  return {
    isTauri: true,
    isWindowVisible: async () => true,
    requestPermission: async () => "granted",
    sendNotification: async () => undefined,
    ...overrides,
  };
}

describe("admin recap presentation acceptance", () => {
  it("returns false when OS permission is denied and no in-app surface accepted", async () => {
    const send = vi.fn();
    const accepted = await presentAdminRecapArrival(2, {
      host: host({ requestPermission: async () => "denied", sendNotification: send }),
    });
    expect(accepted).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("returns false for a hidden main window whose flyout cannot be seen", async () => {
    const inApp = vi.fn();
    const accepted = await presentAdminRecapArrival(2, {
      inApp,
      host: host({
        isWindowVisible: async () => false,
        requestPermission: async () => "denied",
      }),
    });
    expect(accepted).toBe(false);
    expect(inApp).not.toHaveBeenCalled();
  });

  it("returns true only after the toast was actually submitted", async () => {
    const send = vi.fn(async () => undefined);
    await expect(presentAdminRecapArrival(3, { host: host({ sendNotification: send }) })).resolves.toBe(true);
    expect(send).toHaveBeenCalledWith(recapArrivalCopy(3), expect.objectContaining({ signal: expect.any(AbortSignal), isCurrent: expect.any(Function) }));
  });

  it("returns true when the visible in-app surface accepted the group", async () => {
    const inApp = vi.fn(() => true);
    const send = vi.fn();
    await expect(presentAdminRecapArrival(2, {
      inApp,
      host: host({ requestPermission: async () => "denied", sendNotification: send }),
    })).resolves.toBe(true);
    expect(inApp).toHaveBeenCalledWith(recapArrivalCopy(2), expect.objectContaining({ signal: expect.any(AbortSignal), isCurrent: expect.any(Function) }));
    // A visible in-app receipt is enough; the denied toast is not a second try.
    expect(send).not.toHaveBeenCalled();
  });

  it("returns false when the in-app surface explicitly declines", async () => {
    const accepted = await presentAdminRecapArrival(1, {
      inApp: () => false,
      host: host({ requestPermission: async () => "denied" }),
    });
    expect(accepted).toBe(false);
  });

  it("returns false in a browser fixture with no visible in-app callback", async () => {
    await expect(presentAdminRecapArrival(1, { host: host({ isTauri: false }) })).resolves.toBe(false);
  });

  it("fails closed when the notification host throws", async () => {
    await expect(presentAdminRecapArrival(1, {
      host: host({ sendNotification: async () => { throw new Error("host refused"); } }),
    })).resolves.toBe(false);
  });

  it("the native permission adapter rechecks cancellation between permission-check and permission-request", async () => {
    let resolve!: (granted: boolean) => void;
    let entered!: () => void;
    const started = new Promise<void>((done) => { entered = done; });
    native.isPermissionGranted.mockImplementation(() => {
      entered();
      return new Promise<boolean>((done) => { resolve = done; });
    });
    const cancellation = new AbortController();
    const pending = presentAdminRecapArrival(1, { signal: cancellation.signal });
    await started;
    cancellation.abort(); resolve(false);
    expect(await pending).toBe(false);
    expect(native.requestPermission).not.toHaveBeenCalled();
    expect(native.sendNotification).not.toHaveBeenCalled();
  });
});
