import { emit as tauriEmit, listen as tauriListen, type EventCallback } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";

/** Browser-safe shims for the avatar window: the packaged app always runs in
 * Tauri, but the browser dev fixture (?window=avatar&token=…) has no IPC, so
 * event calls become no-ops instead of throwing synchronously. */
export function listen<T>(event: string, handler: EventCallback<T>): Promise<() => void> {
  if (!isTauri()) return Promise.resolve(() => undefined);
  return tauriListen<T>(event, handler);
}

export function emit(event: string, payload?: unknown): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return tauriEmit(event, payload as never);
}
