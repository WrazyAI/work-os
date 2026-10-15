import { diagnostics } from "./diagnostics";

/** Retries the local vault open while the host is still coming up.
 *
 * The vault open is the first thing the frontend asks the host to do, and the
 * host registers its pieces while it starts: the password worker is spawned
 * from setup, and the Stronghold plugin is registered there too. A slow first
 * launch can lose that race, and the gate then showed its recovery screen
 * while a reload always worked — the employee had to refresh to get in.
 *
 * Transient startup failures are now retried inside the one gate attempt. A
 * real failure (an unreadable key, a pending confirmation, a timeout) is
 * reported immediately, and every retry leaves a `vault.open.retrying`
 * breadcrumb so the next occurrence is diagnosable. */

export const VAULT_STARTUP_ATTEMPTS = 4;
export const VAULT_STARTUP_DELAY_MS = 400;

/** Error codes that can only mean the host was not ready to answer yet. */
const TRANSIENT_CODES = new Set(["unavailable", "store_unavailable", "store_write_failed"]);

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  const record = error as { message?: unknown } | null | undefined;
  return typeof record?.message === "string" ? record.message : "";
}

/** True when the failure can only mean the host was still starting. */
export function isVaultStartupRace(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (typeof code === "string" && TRANSIENT_CODES.has(code)) return true;
  return /plugin stronghold not found|stronghold not found/i.test(messageOf(error));
}

type StartupRetryOptions = {
  attempts?: number;
  delayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
  onRetry?: (attempt: number, error: unknown) => void;
};

/** Runs `open`, retrying only the failures a still-starting host produces. */
export async function openVaultWhenReady<T>(
  open: () => Promise<T>,
  options: StartupRetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? VAULT_STARTUP_ATTEMPTS);
  const delayMs = Math.max(0, options.delayMs ?? VAULT_STARTUP_DELAY_MS);
  const sleep = options.sleep ?? ((value: number) => new Promise<void>((resolve) => window.setTimeout(resolve, value)));

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await open();
    } catch (error) {
      if (attempt >= attempts || !isVaultStartupRace(error)) throw error;
      options.onRetry?.(attempt, error);
      await sleep(delayMs);
    }
  }
}

/** The retry breadcrumb for the vault open, so a lost race is visible in the
 * diagnostics trail instead of only in the employee's experience. */
export function reportVaultRetry(attempt: number, error: unknown) {
  const reason = messageOf(error) || "the host was not ready";
  diagnostics.warn(
    "vault.open.retrying",
    `The local vault open hit a startup race; retrying (attempt ${attempt + 1}). ${reason}`,
  );
}
