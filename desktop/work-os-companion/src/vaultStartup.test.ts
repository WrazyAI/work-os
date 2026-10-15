import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isVaultStartupRace, openVaultWhenReady, VAULT_STARTUP_ATTEMPTS } from "./vaultStartup";

const instant = async () => undefined;

describe("vault startup retry", () => {
  it("retries a host that is not ready yet, then succeeds", async () => {
    let calls = 0;
    const retries: number[] = [];
    const result = await openVaultWhenReady(async () => {
      calls += 1;
      if (calls < 3) throw { code: "unavailable", message: "The host could not run the request at all." };
      return "opened";
    }, { sleep: instant, onRetry: (attempt) => retries.push(attempt) });
    expect(result).toBe("opened");
    expect(calls).toBe(3);
    expect(retries).toEqual([1, 2]);
  });

  it("retries the plugin race and the transient store hiccups", async () => {
    for (const error of [
      new Error("plugin stronghold not found"),
      { code: "store_unavailable", message: "This device's password store is unavailable right now." },
      { code: "store_write_failed", message: "This device's password store refused to save a new key." },
    ]) {
      let calls = 0;
      const result = await openVaultWhenReady(async () => {
        calls += 1;
        if (calls === 1) throw error;
        return "opened";
      }, { sleep: instant });
      expect(result).toBe("opened");
      expect(calls).toBe(2);
    }
  });

  it("never retries a failure the employee has to act on", async () => {
    for (const error of [
      { code: "unlock_failed", message: "The saved key for this device's Work OS data can't be read." },
      { code: "confirmation_required", message: "macOS is waiting for you to allow access to the saved Work OS key." },
      new Error("The vault file could not be opened"),
    ]) {
      let calls = 0;
      await expect(openVaultWhenReady(async () => { calls += 1; throw error; }, { sleep: instant })).rejects.toBe(error);
      expect(calls).toBe(1);
    }
  });

  it("reports the last startup failure once the attempts run out", async () => {
    let calls = 0;
    const last = { code: "unavailable", message: "still starting" };
    await expect(openVaultWhenReady(async () => { calls += 1; throw last; }, { sleep: instant })).rejects.toBe(last);
    expect(calls).toBe(VAULT_STARTUP_ATTEMPTS);
  });
});

describe("vault startup wiring", () => {
  it("opens the vault through the startup retry and keeps its breadcrumb", () => {
    const vault = readFileSync(resolve(import.meta.dirname, "vault.ts"), "utf8");
    expect(vault).toContain("openVaultWhenReady(openVault");
    expect(vault).toContain("onRetry: reportVaultRetry");
  });

  it("classifies only host-startup codes and the plugin race as transient", () => {
    expect(isVaultStartupRace({ code: "unavailable" })).toBe(true);
    expect(isVaultStartupRace("plugin stronghold not found")).toBe(true);
    expect(isVaultStartupRace({ code: "unlock_failed" })).toBe(false);
    expect(isVaultStartupRace({ code: "confirmation_required" })).toBe(false);
    expect(isVaultStartupRace(new Error("The vault file could not be opened"))).toBe(false);
  });
});
