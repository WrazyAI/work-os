import type { AppMenuItem } from "./AppMenuBar";

/** The host announces every floating-companion visibility transition: the
 * avatar's own close button, the tray item, and the main View menu all end in
 * the same Rust commands. */
export const COMPANION_VISIBILITY_EVENT = "work-os://companion-visibility";

/** Visibility starts as `null` until the first poll or host event lands.
 * Unknown is not visible: offering "Show Otto" cannot claim a window is there
 * when nothing has confirmed it yet. */
export function ottoVisibilityLabel(visible: boolean | null): "Show Otto" | "Hide Otto" {
  return visible === true ? "Hide Otto" : "Show Otto";
}

/** Shared by the in-window View menu and its macOS native mirror. */
export function ottoVisibilityMenuItem(visible: boolean | null, onSelect: () => void): AppMenuItem {
  return { id: "view:otto", label: ottoVisibilityLabel(visible), onSelect };
}
