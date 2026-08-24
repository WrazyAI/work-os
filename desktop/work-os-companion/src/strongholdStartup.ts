export const STRONGHOLD_STARTUP_ATTEMPTS = 40;
export const STRONGHOLD_STARTUP_DELAY_MS = 50;

type StartupRetryOptions = {
  attempts?: number;
  delayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
};

export function isStrongholdStartupRace(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /plugin stronghold not found/i.test(message);
}

export async function loadStrongholdWhenReady<T>(
  load: () => Promise<T>,
  options: StartupRetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? STRONGHOLD_STARTUP_ATTEMPTS);
  const delayMs = Math.max(0, options.delayMs ?? STRONGHOLD_STARTUP_DELAY_MS);
  const sleep = options.sleep ?? ((value: number) => new Promise<void>((resolve) => window.setTimeout(resolve, value)));

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await load();
    } catch (error) {
      if (!isStrongholdStartupRace(error) || attempt === attempts) throw error;
      await sleep(delayMs);
    }
  }

  throw new Error("Stronghold startup retry exhausted.");
}
