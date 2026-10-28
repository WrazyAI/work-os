import type { OttoScope } from "../../../src/modules/work-os/admin-otto/contracts";

/** The identity this window would present to the cross-window audio broker. */
export type AvatarAudioContext = { scope: OttoScope; epoch: number };

/** A read may start without a lease only when this window knows no identity.
 * Employees are identified too, so their reads take the same speech lease as
 * the main window's player; otherwise both windows could speak at once. */
export function avatarSpeechNeedsLease(context: AvatarAudioContext | null): boolean {
  return context !== null;
}

/**
 * The player's playback gate. An identified actor/organization/mode must hold
 * the active lease it was granted; with no identity (the pre-session window)
 * direct playback is the only possible mode.
 */
export function avatarPlaybackAllowed(
  lease: { isActive: () => boolean } | null,
  context: AvatarAudioContext | null,
): boolean {
  if (lease) return lease.isActive();
  return !avatarSpeechNeedsLease(context);
}
