/** Best-effort device-local boolean flags: collapse state and other quiet
 * per-device memories. A blocked, full, or unavailable storage always falls
 * back to the caller's default instead of throwing, and the storage is
 * injectable so the behavior stays testable outside a browser. */

type FlagStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): FlagStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readStoredFlag(
  key: string | null | undefined,
  fallback = false,
  storage: FlagStorage | null = defaultStorage(),
): boolean {
  if (!key || !storage) return fallback;
  try {
    const raw = storage.getItem(key);
    return raw == null ? fallback : raw === "true";
  } catch {
    return fallback;
  }
}

export function writeStoredFlag(
  key: string | null | undefined,
  value: boolean,
  storage: FlagStorage | null = defaultStorage(),
): void {
  if (!key || !storage) return;
  try {
    storage.setItem(key, value ? "true" : "false");
  } catch {
    /* best effort */
  }
}
