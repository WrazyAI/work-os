import { isEditableTarget } from "./windowChrome";

/** The webview's own right-click menu makes the companion read as a browser.
 * Suppress it everywhere except text fields, where the platform edit menu is
 * still the right tool for paste, spellcheck, and text selection. */
export function installContextMenuSuppression(target: Document = document): () => void {
  const onContextMenu = (event: MouseEvent) => {
    if (isEditableTarget(event.target)) return;
    event.preventDefault();
  };
  target.addEventListener("contextmenu", onContextMenu);
  return () => target.removeEventListener("contextmenu", onContextMenu);
}
