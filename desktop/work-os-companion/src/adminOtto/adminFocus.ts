/** Focus and Escape behaviour for the administration sheet, kept out of React
 * so the keyboard path is executable without a browser DOM. The helpers only
 * describe what to focus or close; the component performs the DOM calls. */

export type AdminFocusTarget = {
  focus: () => void;
  isConnected?: boolean;
};

export type AdminEscapeAction = "close-recap" | "close-surface" | null;

/** The admin sheet is not the topmost modal when another modal dialog is open.
 * Escape belongs to that modal then, never to both surfaces at once. */
export function adminEscapeAction(input: {
  key: string;
  recapOpen: boolean;
  topmostModalOpen: boolean;
}): AdminEscapeAction {
  if (input.key !== "Escape") return null;
  if (input.topmostModalOpen) return null;
  return input.recapOpen ? "close-recap" : "close-surface";
}

/** Closing a recap returns focus to the exact View control that opened it. If
 * that row was replaced by a refresh, look the recap up by its stable id and
 * fall back to the Back control rather than leaving focus on removed content. */
export function chooseAdminRecapReturnFocus(input: {
  trigger: AdminFocusTarget | null;
  recapId: string;
  lookup: (recapId: string) => AdminFocusTarget | null;
  back: AdminFocusTarget | null;
}): AdminFocusTarget | null {
  if (input.trigger?.isConnected) return input.trigger;
  return input.lookup(input.recapId) ?? input.back;
}

/** Opening the recap puts focus on its Back control, the first control of the
 * record view, and never on a removed inbox row. */
export function adminRecapOpenFocus(back: AdminFocusTarget | null): AdminFocusTarget | null {
  return back;
}
