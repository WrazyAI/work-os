import { isMacOS } from "./platform";

/** The sidebar listens for this one event so the app bar never reaches into
 * the rail's local collapsed state. */
export const SIDEBAR_TOGGLE_EVENT = "work-os:toggle-sidebar";

type ShortcutEvent = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "repeat">;

/** Ctrl+Q on Windows/Linux, Cmd+Q on macOS. The menu shows the same label, so
 * the visible shortcut and the handled one cannot drift. */
export function isQuitShortcut(event: ShortcutEvent, mac = isMacOS()): boolean {
  return !event.altKey
    && !event.shiftKey
    && (mac ? event.metaKey : event.ctrlKey)
    && event.key.toLowerCase() === "q";
}

/** Ctrl+B / Cmd+B toggles the shell rail, matching the app menu's View item. */
export function isSidebarShortcut(event: ShortcutEvent, mac = isMacOS()): boolean {
  return !event.altKey
    && !event.shiftKey
    && (mac ? event.metaKey : event.ctrlKey)
    && event.key.toLowerCase() === "b";
}

/** Text fields keep the platform's own edit menu and text shortcuts; every
 * other surface is the app, not a browser. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']"));
}

export function shortcutLabel(key: string, mac = isMacOS()): string {
  return mac ? `⌘${key}` : `Ctrl ${key}`;
}
