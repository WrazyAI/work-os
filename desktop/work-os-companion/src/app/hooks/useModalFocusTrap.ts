import { useEffect } from "react";
import { useModalScrollLock } from "../../modalScrollLock";
import { moveMenuFocus } from "../../taskSurfaces";

export function useModalFocusTrap({
  modalOpen,
  taskFinderOpen,
  dismissTopLayer,
}: {
  modalOpen: boolean;
  taskFinderOpen: boolean;
  dismissTopLayer: () => void;
}) {
  useModalScrollLock(modalOpen);

  useEffect(() => {
    if (!modalOpen || taskFinderOpen) return; // Native finder dialog owns inertness/focus.
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]');
      const dialog = dialogs.item(dialogs.length - 1);
      if (!dialog || dialog.contains(document.activeElement)) return;
      dialog.querySelector<HTMLElement>('input:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])')?.focus();
    });
    const onKey = (event: KeyboardEvent) => {
      if (moveMenuFocus(event)) return;
      const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]');
      const dialog = dialogs.item(dialogs.length - 1);
      if (!dialog) return;
      if (event.key === "Escape") { event.preventDefault(); dismissTopLayer(); return; }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((item) => item.offsetParent !== null);
      if (!focusable.length) { event.preventDefault(); dialog.focus(); return; }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [dismissTopLayer, modalOpen, taskFinderOpen]);
}
