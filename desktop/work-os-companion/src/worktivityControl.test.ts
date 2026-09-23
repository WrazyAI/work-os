import { describe, expect, it, vi } from "vitest";
import { retryWorktivityConfirmation, runWorktivityControl, type WorktivityControlAction } from "./worktivityControl";

const operationId = "worktivity-operation-1";

function transport(overrides: Partial<Parameters<typeof runWorktivityControl>[2]> = {}) {
  return {
    preflight: vi.fn(async () => ({ status: "ready" as const, operation_id: operationId })),
    execute: vi.fn(async () => ({ status: "clicked" as const })),
    restore: vi.fn(async () => undefined),
    confirm: vi.fn(async () => ({ status: "confirmed" as const, state: "active" })),
    sleep: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("Worktivity clock controls", () => {
  it("does not touch the desktop app until server preflight is ready", async () => {
    const io = transport({
      preflight: vi.fn(async () => ({ status: "confirmation_required" as const, operation_id: operationId, requirement: "late" })),
    });

    const result = await runWorktivityControl("clock_in", { late_acknowledged: false }, io, { operationId });

    expect(result).toMatchObject({ status: "confirmation_required", requirement: "late", operation_id: operationId });
    expect(io.preflight).toHaveBeenCalledWith(expect.objectContaining({ phase: "preflight", operation_id: operationId, action: "clock_in" }));
    expect(io.execute).not.toHaveBeenCalled();
    expect(io.confirm).not.toHaveBeenCalled();
  });

  it("executes one desktop action and waits for fresh provider confirmation", async () => {
    const onPhase = vi.fn();
    const io = transport({
      confirm: vi.fn()
        .mockResolvedValueOnce({ status: "pending" as const, state: "active" })
        .mockResolvedValueOnce({ status: "pending" as const, state: "active" })
        .mockResolvedValueOnce({ status: "confirmed" as const, state: "active" }),
    });

    const result = await runWorktivityControl("clock_in", {}, io, { operationId, attempts: 4, intervalMs: 2, onPhase });

    expect(result).toMatchObject({ status: "confirmed", operation_id: operationId, state: "active" });
    expect(io.execute).toHaveBeenCalledTimes(1);
    expect(io.restore).toHaveBeenCalledTimes(1);
    expect(io.confirm).toHaveBeenCalledTimes(3);
    expect(io.sleep).toHaveBeenCalledTimes(2);
    expect(onPhase.mock.calls.map(([phase]) => phase)).toEqual(["preflight", "desktop", "confirm", "confirm", "confirm"]);
    expect(io.confirm).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "confirm", operation_id: operationId, action: "clock_in" }));
  });

  it("does not touch Worktivity when preflight already matches the requested state", async () => {
    const io = transport({
      preflight: vi.fn(async () => ({ status: "already_target" as const, operation_id: operationId })),
    });

    const result = await runWorktivityControl("clock_out", {}, io, { operationId });

    expect(result).toMatchObject({ status: "confirmed", operation_id: operationId, already_target: true });
    expect(io.execute).not.toHaveBeenCalled();
    expect(io.confirm).not.toHaveBeenCalled();
  });

  it("leaves an unconfirmed operation pending and retries by reading only", async () => {
    const io = transport({
      confirm: vi.fn(async () => ({ status: "pending" as const, state: "off_shift" })),
    });

    const first = await runWorktivityControl("clock_out", {}, io, { operationId, attempts: 2, intervalMs: 1 });
    const retry = await retryWorktivityConfirmation("clock_out", operationId, io);

    expect(first.status).toBe("pending");
    expect(retry.status).toBe("pending");
    expect(io.execute).toHaveBeenCalledTimes(1);
    expect(io.confirm).toHaveBeenCalledTimes(3);
  });

  it("releases a pending action when fresh status confirms it was not applied", async () => {
    const io = transport({
      confirm: vi.fn(async () => ({ status: "not_applied" as const, state: "off_shift" })),
    });

    const first = await runWorktivityControl("clock_in", {}, io, { operationId, attempts: 2, intervalMs: 1 });
    const retry = await retryWorktivityConfirmation("clock_in", operationId, io);

    expect(first).toMatchObject({ status: "not_applied", action: "clock_in" });
    expect(retry).toMatchObject({ status: "not_applied", action: "clock_in" });
    expect(io.execute).toHaveBeenCalledTimes(1);
    expect(io.restore).toHaveBeenCalledTimes(1);
    expect(io.confirm).toHaveBeenCalledTimes(3);
  });

  it("reports a failed attempt to close the temporary desktop control connection", async () => {
    const io = transport({ restore: vi.fn(async () => { throw new Error("restore failed"); }) });
    const result = await runWorktivityControl("clock_in", {}, io, { operationId });

    expect(result).toMatchObject({ status: "confirmed", restore_warning: expect.stringContaining("Close and reopen Worktivity") });
  });

  it("returns an actionable desktop error without claiming Worktivity changed", async () => {
    const io = transport({
      execute: vi.fn(async () => ({ status: "not_installed" as const, message: "Install Worktivity to continue." })),
    });

    const result = await runWorktivityControl("pause", {}, io, { operationId });

    expect(result).toMatchObject({ status: "desktop_failed", message: "Install Worktivity to continue." });
    expect(io.confirm).not.toHaveBeenCalled();
  });

  it("leaves a timed-out desktop command pending without repeating its action", async () => {
    const io = transport({
      execute: vi.fn(() => new Promise<never>(() => undefined)),
    });

    const result = await runWorktivityControl("clock_in", {}, io, { operationId, executeTimeoutMs: 5 });

    expect(result).toMatchObject({ status: "pending", operation_id: operationId });
    expect(io.execute).toHaveBeenCalledTimes(1);
    expect(io.confirm).not.toHaveBeenCalled();
  });

  it("supports each explicit attendance action", async () => {
    const actions: WorktivityControlAction[] = ["clock_in", "clock_out", "pause", "resume"];
    for (const action of actions) {
      const io = transport();
      await runWorktivityControl(action, {}, io, { operationId });
      expect(io.preflight).toHaveBeenCalledWith(expect.objectContaining({ action }));
    }
  });
});
