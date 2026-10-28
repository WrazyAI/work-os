import { isTauri } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

/** Notification copy for a reviewed-recap arrival. It states a count only:
 * never a recap headline, employee name, or any team record body. */
export function recapArrivalCopy(count: number): { title: string; body: string } {
  const safe = Math.max(1, Math.trunc(count));
  return {
    title: "Reviewed recaps are ready",
    body: safe === 1
      ? "1 reviewed recap is waiting in the administration inbox."
      : `${safe} reviewed recaps are waiting in the administration inbox.`,
  };
}

/** The host seams the acceptance predicate is tested against. */
export type AdminRecapPresentationHost = {
  isTauri: boolean;
  isWindowVisible: () => boolean | Promise<boolean>;
  /** Returns the current permission, then one explicit request when it is not
   * granted. A denial is final for this attempt. */
  requestPermission: (fence: AdminRecapPresentationFence) => Promise<"granted" | "denied" | "prompt">;
  sendNotification: (copy: { title: string; body: string }, fence: AdminRecapPresentationFence) => void | Promise<void>;
};

export type AdminRecapPresentationFence = { signal: AbortSignal; isCurrent: () => boolean };

export type AdminRecapPresentationOptions = Partial<AdminRecapPresentationFence> & {
  /** A visible in-app arrival surface (Task 9's inbox). It returns false when it
   * cannot show the group; returning undefined counts as accepted. Any host or
   * callback that adds its own await must consume the fence before displaying. */
  inApp?: (copy: { title: string; body: string }, fence: AdminRecapPresentationFence) => boolean | void | Promise<boolean | void>;
  isWindowVisible?: () => boolean | Promise<boolean>;
  host?: Partial<AdminRecapPresentationHost>;
};

const liveHost: AdminRecapPresentationHost = {
  isTauri: isTauri(),
  isWindowVisible: () => typeof document === "undefined" || document.visibilityState !== "hidden",
  requestPermission: async (fence) => {
    try {
      if (!fence.isCurrent()) return "denied";
      const granted = await isPermissionGranted();
      if (!fence.isCurrent()) return "denied";
      if (granted) return "granted";
      const permission = await requestPermission();
      return fence.isCurrent() && permission === "granted" ? "granted" : "denied";
    } catch {
      return "denied";
    }
  },
  sendNotification: (copy, fence) => { if (fence.isCurrent()) sendNotification(copy); },
};

/**
 * Present a grouped arrival and report whether a person could actually see it.
 *
 * - A visible in-app surface accepting the group is presentation even when the
 *   OS toast is denied.
 * - A hidden window's flyout is not a presentation; only an accepted toast is.
 * - The avatar has no in-app recap surface yet, so a denied toast is `false`.
 *   The delivery controller then releases its lease and leaves the event for
 *   the next poll instead of marking it presented forever.
 */
export async function presentAdminRecapArrival(
  count: number,
  options: AdminRecapPresentationOptions = {},
): Promise<boolean> {
  const signal = options.signal ?? new AbortController().signal;
  const fence: AdminRecapPresentationFence = {
    signal,
    isCurrent: () => !signal.aborted && (options.isCurrent?.() ?? true),
  };
  if (!fence.isCurrent()) return false;
  const copy = recapArrivalCopy(count);
  const host: AdminRecapPresentationHost = {
    ...liveHost,
    ...options.host,
    ...(options.isWindowVisible ? { isWindowVisible: options.isWindowVisible } : {}),
  };
  let visible = false;
  try {
    visible = await host.isWindowVisible();
  } catch {
    visible = false;
  }
  if (!fence.isCurrent()) return false;
  if (visible && options.inApp) {
    try {
      if (!fence.isCurrent()) return false;
      const accepted = await options.inApp(copy, fence);
      if (!fence.isCurrent()) return false;
      if (accepted !== false) return true;
    } catch {
      // Fall through to the OS path; an in-app failure is not acceptance.
    }
  }
  if (!host.isTauri || !fence.isCurrent()) return false;
  const permission = await host.requestPermission(fence).catch(() => "denied" as const);
  if (permission !== "granted" || !fence.isCurrent()) return false;
  try {
    // No await may separate this fence from the actual host invocation. Hosts
    // that defer further work receive the same live fence for their own boundary.
    if (!fence.isCurrent()) return false;
    await host.sendNotification(copy, fence);
    return fence.isCurrent();
  } catch {
    return false;
  }
}
