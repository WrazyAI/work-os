/** The boot gate that keeps every screen hidden until this device's local vault
 * (session, queued updates, cached workday) can be opened.
 *
 * The vault key lives in the OS credential store, and that read can wait on a
 * system dialog: on macOS an in-place app update changes the app's ad-hoc
 * signature, so the saved Keychain item no longer matches the new binary and
 * macOS asks the employee to allow access. A gate that only ever resolved on
 * success left the companion on its loading screen forever — painted but dead,
 * with the mascot unable to move — while an unanswered dialog waited behind the
 * always-on-top companion.
 *
 * The gate therefore always settles:
 *
 * - the vault opens → the workspace continues (or reports a real error),
 * - the store answers with a failure → the failure screen names it and offers
 *   the matching recovery,
 * - nothing answers in time → the timeout failure, so the app can be retried
 *   instead of hanging.
 *
 * A retried attempt abandons the previous one. The abandoned read keeps running
 * in the host (its answer is cached there), so a late answer can never resolve
 * the retired attempt and jump the UI past the screen the employee is on. */

export const VAULT_GATE_TIMEOUT_MS = 12_000;

/** The bounded, employee-facing explanation of a gate failure, plus which
 * recovery the UI may offer. */
export interface VaultGateFailure {
  /** What went wrong, in the employee's words. */
  message: string;
  /** The OS is waiting for the employee to allow access (macOS Keychain). */
  confirmationRequired: boolean;
  /** Only starting fresh on this device can move the app forward. */
  requiresReset: boolean;
}

/** The settled outcomes: the vault opened, or the screen must explain why not. */
export type VaultGateSettled =
  | { status: "ready" }
  | { status: "failed"; failure: VaultGateFailure };

/** The gate's state as the app renders it. `pending` is the loading screen;
 * `failed` is a screen with a bounded explanation and the recovery the failure
 * allows. */
export type VaultGateState = { status: "pending" } | VaultGateSettled;

export interface VaultAttempt {
  /** Settles once, with the outcome or with the timeout failure. */
  result: Promise<VaultGateSettled>;
  /** Retires this attempt; a late settlement is ignored. */
  abandon(): void;
  settled(): boolean;
}

const GENERIC_FAILURE: VaultGateFailure = {
  message: "Work OS couldn't open this device's saved data. Try again — nothing on the server was changed.",
  confirmationRequired: false,
  requiresReset: false,
};

const TIMEOUT_FAILURE: VaultGateFailure = {
  message: "Opening this device's saved data is taking too long. On macOS a password dialog can open behind the companion — allow access there, then try again.",
  confirmationRequired: true,
  requiresReset: false,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

/** Normalizes whatever the host rejected with: the command's structured
 * `{ code, message, requiresReset }`, a plain string from an older build, or any
 * other thrown value. */
export function vaultFailureFrom(error: unknown): VaultGateFailure {
  const record = asRecord(error);
  const message = typeof record?.message === "string" ? record.message.trim()
    : typeof error === "string" ? error.trim()
      : "";
  const code = typeof record?.code === "string" ? record.code : "";
  const requiresReset = record?.requiresReset === true || code === "unlock_failed";
  if (!message) return { ...GENERIC_FAILURE, requiresReset };
  return {
    message,
    confirmationRequired: code === "confirmation_required" || requiresReset,
    requiresReset,
  };
}

/** Starts one gate attempt. `open` resolves when the vault is usable; anything
 * it rejects with is reported as a failure. Never rejects itself. */
export function runVaultGate(
  open: () => Promise<unknown>,
  timeoutMs: number = VAULT_GATE_TIMEOUT_MS,
): VaultAttempt {
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let resolveOutcome: (outcome: VaultGateSettled) => void = () => undefined;

  const settle = (outcome: VaultGateSettled) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    timer = null;
    resolveOutcome(outcome);
  };

  const result = new Promise<VaultGateSettled>((resolve) => {
    resolveOutcome = resolve;
  });
  timer = setTimeout(() => settle({ status: "failed", failure: TIMEOUT_FAILURE }), Math.max(0, timeoutMs));

  void (async () => {
    try {
      await open();
      settle({ status: "ready" });
    } catch (error) {
      settle({ status: "failed", failure: vaultFailureFrom(error) });
    }
  })();

  return {
    result,
    abandon() {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      timer = null;
      // The promise intentionally stays pending: the retired attempt must not
      // hand an outcome to a screen the employee has already left.
    },
    settled: () => settled,
  };
}
