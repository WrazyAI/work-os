import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { diagnostics } from "./diagnostics";
import type { DayData } from "./types";

let timer: number | null = null;
let lastKey = "";

export function cancelScheduledPrompt() {
  if (timer !== null) window.clearTimeout(timer);
  timer = null;
}

async function notifyPrompt(day: DayData, triggerAt: string) {
  if (!day.prompt.kind) return;
  const key = `${day.shiftDate}:${day.prompt.kind}:${triggerAt}`;
  if (key === lastKey) return;
  lastKey = key;
  let granted = await isPermissionGranted();
  if (!granted) granted = (await requestPermission()) === "granted";
  if (!granted) {
    diagnostics.warn("notification.permission_denied", "Notification permission was not granted", { kind: day.prompt.kind });
    return;
  }
  diagnostics.info("notification.scheduled", "Showing work prompt notification", { kind: day.prompt.kind, triggerAt });
  sendNotification({
    title: day.prompt.kind === "eod" ? "Review your EOD draft" : day.prompt.required ? "Work OS check-in" : "Anything to add?",
    body: day.prompt.reason,
  });
}

export async function schedulePrompt(day: DayData, refresh: () => Promise<DayData>) {
  cancelScheduledPrompt();
  if (!day.prompt.nextPromptAt) return;
  const triggerAt = day.prompt.nextPromptAt;
  const delay = new Date(triggerAt).getTime() - Date.now();
  diagnostics.info("scheduler.prompt.armed", "Prompt timer armed", { kind: day.prompt.kind, triggerAt, delayMs: delay });
  if (delay <= 0) {
    await notifyPrompt(day, triggerAt);
    return;
  }
  timer = window.setTimeout(async () => {
    try {
      const current = await refresh();
      if (Date.now() + 1_000 < new Date(triggerAt).getTime()) return;
      await notifyPrompt(current, triggerAt);
    } catch (error) {
      diagnostics.warn("scheduler.prompt.refresh_failed", error instanceof Error ? error.message : "Prompt refresh failed");
    }
  }, Math.min(delay, 2_147_000_000));
}
