import { describe, expect, it, vi } from "vitest";
import { isStrongholdStartupRace, loadStrongholdWhenReady } from "./strongholdStartup";

describe("Stronghold startup recovery", () => {
  it("recognizes only the transient plugin-registration failure", () => {
    expect(isStrongholdStartupRace(new Error("plugin stronghold not found"))).toBe(true);
    expect(isStrongholdStartupRace(new Error("stronghold not initialized"))).toBe(false);
    expect(isStrongholdStartupRace(new Error("vault password rejected"))).toBe(false);
  });

  it("waits for dynamic Stronghold registration", async () => {
    const value = { ready: true };
    const load = vi.fn()
      .mockRejectedValueOnce(new Error("plugin stronghold not found"))
      .mockRejectedValueOnce(new Error("Plugin Stronghold not found"))
      .mockResolvedValue(value);
    const sleep = vi.fn(async () => undefined);

    await expect(loadStrongholdWhenReady(load, { attempts: 4, delayMs: 25, sleep })).resolves.toBe(value);
    expect(load).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 25);
    expect(sleep).toHaveBeenNthCalledWith(2, 25);
  });

  it("does not hide permanent failures and remains bounded", async () => {
    const permanent = vi.fn().mockRejectedValue(new Error("vault password rejected"));
    await expect(loadStrongholdWhenReady(permanent, { attempts: 4, sleep: async () => undefined })).rejects.toThrow("vault password rejected");
    expect(permanent).toHaveBeenCalledTimes(1);

    const transient = vi.fn().mockRejectedValue(new Error("plugin stronghold not found"));
    await expect(loadStrongholdWhenReady(transient, { attempts: 3, sleep: async () => undefined })).rejects.toThrow("plugin stronghold not found");
    expect(transient).toHaveBeenCalledTimes(3);
  });
});
