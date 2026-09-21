import { emit as tauriEmit, listen as tauriListen, type EventCallback } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";

// Only non-secret presentation/debug events are bridged in browser DEV fixtures.
// Auth, conversation, queue and business mutation events remain native-only.
const PREVIEW_EVENTS = new Set([
  "work-os://debug-current", "work-os://debug-scenario", "work-os://debug-request",
  "work-os://mascot-activity", "work-os://mascot-resolved", "work-os://mascot-request",
]);
const handlers = new Map<string, Set<(payload: unknown) => void>>();
let channel: BroadcastChannel | null = null;
function previewAllowed(event: string): boolean {
  return import.meta.env.DEV && typeof window !== "undefined" && PREVIEW_EVENTS.has(event);
}
function dispatch(event: string, payload: unknown) {
  for (const handler of handlers.get(event) ?? []) handler(payload);
}
function previewChannel() {
  if (!channel && typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel("work-os.mascot-preview.v1");
    channel.onmessage = ({ data }: MessageEvent<unknown>) => {
      if (!data || typeof data !== "object") return;
      const value = data as { event?: unknown; payload?: unknown };
      if (typeof value.event === "string" && previewAllowed(value.event)) dispatch(value.event, value.payload);
    };
  }
  return channel;
}
export function listen<T>(event: string, handler: EventCallback<T>): Promise<() => void> {
  if (isTauri()) return tauriListen<T>(event, handler);
  if (!previewAllowed(event)) return Promise.resolve(() => undefined);
  previewChannel();
  const callback = (payload: unknown) => handler({ event, id: 0, payload: payload as T });
  const group = handlers.get(event) ?? new Set();
  group.add(callback);
  handlers.set(event, group);
  return Promise.resolve(() => {
    group.delete(callback);
    if (!group.size) handlers.delete(event);
    if (!handlers.size) { channel?.close(); channel = null; }
  });
}
export function emit(event: string, payload?: unknown): Promise<void> {
  if (isTauri()) return tauriEmit(event, payload as never);
  if (!previewAllowed(event)) return Promise.resolve();
  dispatch(event, payload);
  // BroadcastChannel does not echo to its sender; dispatch handles this window.
  previewChannel()?.postMessage({ event, payload });
  return Promise.resolve();
}
