import { afterEach, describe, expect, it, vi } from "vitest";
import { VAULT_GATE_TIMEOUT_MS, VAULT_TROUBLE_PROBE_MS, runVaultGate, vaultFailureFrom } from "./vaultGate";

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
    const attempt = runVaultGate(() => new Promise(() => undefined), { timeoutMs: 1_000 });
    expect(attempt.settled()).toBe(false);
    await vi.advanceTimersByTimeAsync(999);
    expect(attempt.settled()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const outcome = await attempt.result;
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    // The timeout names the one cause the employee can act on without claiming
    // it is the cause: the host may have answered the keychain long ago.
    expect(outcome.failure.confirmationRequired).toBe(false);
    expect(outcome.failure.message).toContain("macOS");
    expect(VAULT_GATE_TIMEOUT_MS).toBeGreaterThanOrEqual(30_000);
  });

  it("ignores a late answer for a retired attempt", async () => {
    vi.useFakeTimers();
    let release: (value: string) => void = () => undefined;
    const pending = new Promise<string>((resolve) => { release = resolve; });
    const attempt = runVaultGate(() => pending, { timeoutMs: 500 });
    attempt.abandon();
    release("password");
    await vi.advanceTimersByTimeAsync(5_000);
    // The retired attempt never hands an outcome to the screen in its place.
    const raced = await Promise.race([attempt.result, Promise.resolve("still-pending")]);
    expect(raced).toBe("still-pending");
    expect(attempt.settled()).toBe(true);
  });

  it("offers starting fresh when the host lost the open to a panic", async () => {
    vi.useFakeTimers();
    // The Stronghold plugin panics instead of rejecting, so the opener stays
    // pending forever and only the host knows why.
    const attempt = runVaultGate(() => new Promise(() => undefined), {
      timeoutMs: 1_000,
      probeTrouble: async () => true,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(VAULT_TROUBLE_PROBE_MS + 50);
    const outcome = await attempt.result;
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    // Retrying a panicked open panics again, so this failure must carry the
    // recovery that replaces the local copy.
    expect(outcome.failure.requiresReset).toBe(true);
    expect(outcome.failure.confirmationRequired).toBe(false);
    expect(outcome.failure.message).toContain("Start fresh");
  });

  it("keeps the timeout failure when the host reports no panic", async () => {
    vi.useFakeTimers();
    const attempt = runVaultGate(() => new Promise(() => undefined), {
      timeoutMs: 1_000,
      probeTrouble: async () => false,
    });
    await vi.advanceTimersByTimeAsync(1_000 + VAULT_TROUBLE_PROBE_MS + 50);
    const outcome = await attempt.result;
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.failure.requiresReset).toBe(false);
  });

  it("treats a probe that cannot answer as no panic", async () => {
    vi.useFakeTimers();
    const attempt = runVaultGate(() => new Promise(() => undefined), {
      timeoutMs: 1_000,
      // A host whose main thread is stuck cannot answer at all.
      probeTrouble: () => new Promise(() => undefined),
    });
    await vi.advanceTimersByTimeAsync(1_000 + VAULT_TROUBLE_PROBE_MS + 50);
    const outcome = await attempt.result;
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.failure.requiresReset).toBe(false);
    expect(outcome.failure.message).toContain("taking longer than usual");
  });

  it("lets a slow but successful open land while the trouble probe is still out", async () => {
    vi.useFakeTimers();
    let releaseOpen: (value: string) => void = () => undefined;
    let releaseProbe: (value: boolean) => void = () => undefined;
    const attempt = runVaultGate(
      () => new Promise<string>((resolve) => { releaseOpen = resolve; }),
      {
        timeoutMs: 1_000,
        probeTrouble: () => new Promise<boolean>((resolve) => { releaseProbe = resolve; }),
      },
    );
    await vi.advanceTimersByTimeAsync(1_000);
    releaseOpen("password");
    await vi.advanceTimersByTimeAsync(10);
    releaseProbe(false);
    await vi.advanceTimersByTimeAsync(VAULT_TROUBLE_PROBE_MS + 50);
    await expect(attempt.result).resolves.toEqual({ status: "ready" });
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

  const badFileKey = "inner error occurred(invalid file failed to decode/decrypt age content BadFileKey)";

  it.each([
    badFileKey,
    new Error(badFileKey),
    { message: badFileKey },
    { code: "unknown", message: badFileKey },
  ])("offers explicit recovery for a confirmed decryption failure: %j", (error) => {
    const failure = vaultFailureFrom(error);
    expect(failure.requiresReset).toBe(true);
    expect(failure.confirmationRequired).toBe(false);
    expect(failure.message).toContain("couldn't decrypt");
    expect(failure.message).toContain("Start fresh");
    expect(failure.message).not.toContain("BadFileKey");
  });

  it("passes decryption recovery through the boot gate without invoking recovery", async () => {
    const open = vi.fn().mockRejectedValue(badFileKey);
    const attempt = runVaultGate(open);
    await expect(attempt.result).resolves.toMatchObject({
      status: "failed",
      failure: { requiresReset: true, confirmationRequired: false },
    });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it.each([
    { code: "unknown" },
    { code: "unknown", message: "The local vault gate failed; the retry screen is up" },
    { code: "store_unavailable", message: "Credential store is not ready" },
    { code: "store_write_failed", message: "Credential store write failed" },
    "plugin stronghold not found",
    "Opening this device's saved data timed out",
    "invalid file",
    "failed to decode/decrypt age content",
    "NotBadFileKey",
  ])("keeps unknown and transient startup failures non-destructive: %j", (error) => {
    expect(vaultFailureFrom(error).requiresReset).toBe(false);
  });

  it("stays useful when the rejection carries no structure", () => {
    expect(vaultFailureFrom("Local workspace unavailable").message).toBe("Local workspace unavailable");
    expect(vaultFailureFrom(undefined).requiresReset).toBe(false);
    expect(vaultFailureFrom(undefined).message).toContain("Try again");
  });
});
