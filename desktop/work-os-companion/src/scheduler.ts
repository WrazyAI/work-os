import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { diagnostics } from "./diagnostics";
import type { DayData } from "./types";

let timer: number | null = null;

export function cancelScheduledPrompt() {
  if (timer !== null) window.clearTimeout(timer);
  timer = null;
}

/** Sends an OS notification once the user has granted permission. */
export async function sendOSNotification(title: string, body: string, cause: string) {
  try {
    await deliverOSNotification(title, body, cause);
  } catch (error) {
    // Outside Tauri (or before the plugin is ready) OS delivery is simply
    // unavailable — the in-app persistent flyout remains the surface.
    diagnostics.warn("notification.unavailable", error instanceof Error ? error.message : "OS notification unavailable", { cause });
  }
}

async function deliverOSNotification(title: string, body: string, cause: string) {
  let granted = await isPermissionGranted();
  if (!granted) granted = (await requestPermission()) === "granted";
  if (!granted) {
    diagnostics.warn("notification.permission_denied", "Notification permission was not granted", { cause });
    return false;
  }
  diagnostics.info("notification.sent", "Showing companion notification", { cause });
  sendNotification({ title, body });
  return true;
}

/**
 * Arms the server-computed prompt timer. When it fires, the companion tick in
 * App re-evaluates the machine (refreshing the day first) and decides whether
 * a notification should surface — the scheduler no longer notifies on its own.
 */
export function schedulePrompt(day: DayData, onDue: () => void | Promise<void>) {
  cancelScheduledPrompt();
  if (!day.prompt.nextPromptAt) return;
  const triggerAt = day.prompt.nextPromptAt;
  const delay = new Date(triggerAt).getTime() - Date.now();
  diagnostics.info("scheduler.prompt.armed", "Prompt timer armed", { kind: day.prompt.kind, triggerAt, delayMs: delay });
  if (delay <= 0) {
    void onDue();
    return;
  }
  timer = window.setTimeout(() => {
    void Promise.resolve(onDue()).catch((error) => {
      diagnostics.warn("scheduler.prompt.tick_failed", error instanceof Error ? error.message : "Companion tick failed");
    });
  }, Math.min(delay, 2_147_000_000));
}
