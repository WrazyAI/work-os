import { useSyncExternalStore } from "react";
import type { MascotRuntimeState } from "./mascotRuntimeModel";

let current: MascotRuntimeState | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const getSnapshot = () => current;
const getServerSnapshot = () => null;
/** A per-WebView presentation store, never persisted. Publishing a simulated
 * pose cannot affect the workday query cache, approvals, or receipt history. */
export function publishMascotRuntime(next: MascotRuntimeState | null) {
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  current = next;
  listeners.forEach((listener) => listener());
}
export function useMascotRuntimeSnapshot() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
