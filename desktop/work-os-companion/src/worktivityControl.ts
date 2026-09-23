export type WorktivityControlAction = "clock_in" | "clock_out" | "pause" | "resume";
export type WorktivityControlPhase = "preflight" | "desktop" | "confirm";

export type WorktivityControlRequest = {
  phase: "preflight" | "confirm";
  action: WorktivityControlAction;
  operation_id: string;
  [key: string]: unknown;
};

export type WorktivityPreflight = {
  status: "ready" | "already_target" | "confirmation_required" | "blocked";
  operation_id: string;
  requirement?: string;
  message?: string;
  state?: string;
};

export type WorktivityConfirmation = {
  status: "confirmed" | "pending" | "blocked" | "not_applied";
  operation_id?: string;
  state?: string;
  message?: string;
};

export type WorktivityDesktopResult = {
  status: "clicked" | "already_target" | "not_installed" | "not_ready" | "not_supported" | "error";
  message?: string;
  restore_required?: boolean;
};

export type WorktivityControlTransport = {
  preflight(request: WorktivityControlRequest): Promise<WorktivityPreflight>;
  execute(action: WorktivityControlAction): Promise<WorktivityDesktopResult>;
  restore(desktop?: WorktivityDesktopResult): Promise<void>;
  confirm(request: WorktivityControlRequest): Promise<WorktivityConfirmation>;
  sleep(milliseconds: number): Promise<void>;
};

export type WorktivityControlResult =
  | WorktivityPreflight
  | { status: "confirmed"; operation_id: string; state?: string; message?: string; already_target?: true; restore_warning?: string }
  | { status: "not_applied"; operation_id: string; action: WorktivityControlAction; body?: Record<string, unknown>; state?: string; message: string; restore_warning?: string }
  | { status: "pending" | "desktop_failed"; operation_id: string; action: WorktivityControlAction; body?: Record<string, unknown>; message: string; restore_warning?: string };

const ACCEPTED_DESKTOP_RESULTS = new Set<WorktivityDesktopResult["status"]>(["clicked", "already_target"]);

function withTimeout<T>(promise: Promise<T>, milliseconds: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("Worktivity desktop control timed out.")), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => { if (timer) clearTimeout(timer); });
}

function newOperationId() {
  return globalThis.crypto?.randomUUID?.() ?? `worktivity-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function request(phase: "preflight" | "confirm", action: WorktivityControlAction, operationId: string, body: Record<string, unknown> = {}): WorktivityControlRequest {
  return { ...body, phase, action, operation_id: operationId };
}

/** Performs one provider-aware action. Once the desktop command is invoked,
 * failures remain pending and retries only read provider state; the click is
 * never automatically replayed. */
export async function runWorktivityControl(
  action: WorktivityControlAction,
  body: Record<string, unknown>,
  transport: WorktivityControlTransport,
  options: { operationId?: string; attempts?: number; intervalMs?: number; timeoutMs?: number; executeTimeoutMs?: number; onPhase?: (phase: WorktivityControlPhase) => void } = {},
): Promise<WorktivityControlResult> {
  const operationId = options.operationId ?? newOperationId();
  options.onPhase?.("preflight");
  const preflight = await transport.preflight(request("preflight", action, operationId, body));
  if (preflight.status === "already_target") {
    return {
      status: "confirmed",
      operation_id: operationId,
      message: "Worktivity already reflects this attendance state.",
      already_target: true,
    };
  }
  if (preflight.status !== "ready") return preflight;

  let desktop: WorktivityDesktopResult | undefined;
  let outcome: WorktivityControlResult;
  try {
    try {
      options.onPhase?.("desktop");
      desktop = await withTimeout(transport.execute(action), Math.max(1, options.executeTimeoutMs ?? 45_000));
    } catch {
      outcome = { status: "pending", operation_id: operationId, action, body, message: "Worktivity may have received the request, but Work OS could not verify the desktop result. Check status before trying again." };
    }
    if (desktop) {
      if (!ACCEPTED_DESKTOP_RESULTS.has(desktop.status)) {
        outcome = { status: "desktop_failed", operation_id: operationId, action, message: desktop.message || desktopErrorMessage(desktop.status) };
      } else {
        const attempts = Math.max(1, Math.min(options.attempts ?? 16, 16));
        const deadline = Date.now() + Math.max(1, options.timeoutMs ?? 20_000);
        let lastStateWasUnchanged = false;
        outcome = { status: "pending", operation_id: operationId, action, body, message: "Worktivity has not confirmed the change yet. Retry the status check before trying the action again." };
        for (let attempt = 0; attempt < attempts && (attempt === 0 || Date.now() < deadline); attempt += 1) {
          try {
            options.onPhase?.("confirm");
            const confirmation = await transport.confirm(request("confirm", action, operationId, body));
            if (confirmation.status === "confirmed") {
              outcome = { ...confirmation, status: "confirmed", operation_id: operationId };
              break;
            }
            if (confirmation.status === "blocked") {
              lastStateWasUnchanged = false;
              outcome = { status: "pending", operation_id: operationId, action, body, message: confirmation.message || "Worktivity has not confirmed the change yet. Check the provider status before trying again." };
              break;
            }
            lastStateWasUnchanged = confirmation.status === "not_applied";
            if (attempt + 1 < attempts && Date.now() < deadline) await transport.sleep(Math.min(options.intervalMs ?? 2_000, deadline - Date.now()));
          } catch {
            lastStateWasUnchanged = false;
            outcome = { status: "pending", operation_id: operationId, action, body, message: "Worktivity may have received the request, but its status could not be read back. Retry the status check before trying the action again." };
            break;
          }
        }
        if (lastStateWasUnchanged && outcome.status === "pending") {
          outcome = { status: "not_applied", operation_id: operationId, action, body, message: "Worktivity still shows the previous attendance state. The change was not confirmed; you can retry it." };
        }
      }
    }
  } finally {
    try {
      await withTimeout(transport.restore(desktop), 35_000);
    } catch {
      const restoreWarning = "Worktivity's temporary local control connection could not be closed. Close and reopen Worktivity to end it.";
      outcome = { ...outcome!, restore_warning: restoreWarning } as WorktivityControlResult;
    }
  }
  return outcome!;
}

/** Rechecks provider state only. It deliberately has no desktop-action access. */
export async function retryWorktivityConfirmation(
  action: WorktivityControlAction,
  operationId: string,
  transport: Pick<WorktivityControlTransport, "confirm">,
  body: Record<string, unknown> = {},
): Promise<WorktivityControlResult> {
  try {
    const confirmation = await transport.confirm(request("confirm", action, operationId, body));
    if (confirmation.status === "confirmed") return { ...confirmation, status: "confirmed", operation_id: operationId };
    if (confirmation.status === "not_applied") return { status: "not_applied", operation_id: operationId, action, body, state: confirmation.state, message: confirmation.message || "Worktivity still shows the previous attendance state. The change was not confirmed; you can retry it." };
    return { status: "pending", operation_id: operationId, action, body, message: confirmation.message || "Worktivity has not confirmed the change yet." };
  } catch {
    return { status: "pending", operation_id: operationId, action, body, message: "Worktivity status is still unavailable. The action was not repeated." };
  }
}

function desktopErrorMessage(status: WorktivityDesktopResult["status"]) {
  if (status === "not_installed") return "Worktivity is not installed. Install it, then retry the clock action.";
  if (status === "not_supported") return "Worktivity clock controls are available from the Windows Companion.";
  if (status === "not_ready") return "Worktivity could not be controlled. Check its current state, then retry from the Windows Companion.";
  return "Worktivity could not complete the clock action.";
}
