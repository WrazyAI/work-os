import { afterEach, describe, expect, it, vi } from "vitest";
import { VAULT_GATE_TIMEOUT_MS, runVaultGate, vaultFailureFrom } from "./vaultGate";

afterEach(() => {
  vi.useRealTimers();
});

describe("vault gate", () => {
  it("reports ready when the vault opens", async () => {
    const attempt = runVaultGate(() => Promise.resolve("password"));
    await expect(attempt.result).resolves.toEqual({ status: "ready" });
    expect(attempt.settled()).toBe(true);
  });
  it("reports the host failure instead of hanging the loading screen", async () => {
    const attempt = runVaultGate(() => Promise.reject({
      code: "confirmation_required",
      message: "macOS is waiting for you to allow access to the saved Work OS key.",
      requiresReset: false,
    }));
    await expect(attempt.result).resolves.toEqual({
      status: "failed",
      failure: {
        message: "macOS is waiting for you to allow access to the saved Work OS key.",
        confirmationRequired: true,
        requiresReset: false,
      },
    });
  });

  it("settles on its own when the credential store never answers", async () => {
    vi.useFakeTimers();
    const attempt = runVaultGate(() => new Promise(() => undefined), 1_000);
    expect(attempt.settled()).toBe(false);
    await vi.advanceTimersByTimeAsync(999);
    expect(attempt.settled()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const outcome = await attempt.result;
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.failure.confirmationRequired).toBe(true);
    expect(VAULT_GATE_TIMEOUT_MS).toBeGreaterThan(3_000);
  });

  it("ignores a late answer for a retired attempt", async () => {
    vi.useFakeTimers();
    let release: (value: string) => void = () => undefined;
    const pending = new Promise<string>((resolve) => { release = resolve; });
    const attempt = runVaultGate(() => pending, 500);
    attempt.abandon();
    release("password");
    await vi.advanceTimersByTimeAsync(5_000);
    // The retired attempt never hands an outcome to the screen in its place.
    const raced = await Promise.race([attempt.result, Promise.resolve("still-pending")]);
    expect(raced).toBe("still-pending");
    expect(attempt.settled()).toBe(true);
  });

  it("flags the reset recovery the host asked for", () => {
    const failure = vaultFailureFrom({
      code: "unlock_failed",
      message: "The saved key for this device's Work OS data can't be read.",
      requiresReset: true,
    });
    expect(failure.requiresReset).toBe(true);
    expect(failure.message).toContain("can't be read");
  });

  it("stays useful when the rejection carries no structure", () => {
    expect(vaultFailureFrom("Local workspace unavailable").message).toBe("Local workspace unavailable");
    expect(vaultFailureFrom(undefined).requiresReset).toBe(false);
    expect(vaultFailureFrom(undefined).message).toContain("Try again");
  });
});
