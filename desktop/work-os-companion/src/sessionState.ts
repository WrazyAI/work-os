import type { DesktopSession } from "./types";

/** One definition of "this device's session is no longer usable", shared by the
 * API layer and the screens.
 *
 * They used to disagree: the API layer refused an expired token while the
 * workspace still rendered as signed in, so every request failed with "Connect
 * this device to WrazyOS." and no screen ever said why. A stored expiry the
 * server cannot parse is left to the server — only the server can reject a
 * token it no longer accepts. */

export function sessionExpiryMs(session: { expiresAt?: unknown } | null | undefined): number | null {
  const value = session?.expiresAt;
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isSessionExpired(session: { expiresAt?: unknown } | null | undefined, now: number = Date.now()): boolean {
  const expiresAt = sessionExpiryMs(session);
  return expiresAt !== null && expiresAt <= now;
}

/** Why this device has no usable session. */
export type SessionReason = "none" | "expired" | "invalid";

export interface SessionState {
  session: DesktopSession | null;
  reason: SessionReason;
}

/** Reads a stored session into either a usable session or the reason it is not
 * one. `normalizeApiBase` is the caller's own rule (the packaged app only talks
 * to an HTTPS workspace). */
export function sessionStateFrom(
  stored: unknown,
  normalizeApiBase: (value: string) => string,
  now: number = Date.now(),
): SessionState {
  if (!stored || typeof stored !== "object") return { session: null, reason: "none" };
  const candidate = stored as Partial<DesktopSession>;
  if (typeof candidate.token !== "string" || !candidate.token) return { session: null, reason: "invalid" };
  let apiBase: string;
  try {
    apiBase = normalizeApiBase(String(candidate.apiBase ?? ""));
  } catch {
    return { session: null, reason: "invalid" };
  }
  const session: DesktopSession = {
    token: candidate.token,
    expiresAt: String(candidate.expiresAt ?? ""),
    organizationId: String(candidate.organizationId ?? ""),
    apiBase,
  };
  return isSessionExpired(session, now) ? { session: null, reason: "expired" } : { session, reason: "none" };
}

/** What the connect screen tells the employee about a session it had to drop. */
export function sessionNotice(reason: SessionReason): string | null {
  if (reason === "expired") {
    return "This device's connection expired, so I signed it out. Connect it again to keep working — nothing you filed is lost.";
  }
  if (reason === "invalid") {
    return "This device's connection is no longer accepted, so I signed it out. Connect it again to keep working.";
  }
  return null;
}
