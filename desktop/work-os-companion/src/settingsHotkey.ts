/** Ctrl + , (Cmd + , on macOS) opens the main window's Settings from either
 * Work OS window. It is a window-focused shortcut, never a system-wide
 * capture, so it cannot steal the familiar preferences chord from browsers,
 * editors, and other applications. */
export function isSettingsHotkey(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key === ",";
}
