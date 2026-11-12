import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Check, ChevronDown, Copy, Minus, Square, X } from "lucide-react";
import { isMacOS } from "./platform";
import { isEditableTarget, isQuitShortcut, isSidebarShortcut, SIDEBAR_TOGGLE_EVENT, shortcutLabel } from "./windowChrome";

export type AppMenuItem = {
  /** Stable across menu rebuilds; the native menu maps clicks by this, never
   * by position. */
  id?: string;
  label: string;
  shortcut?: string;
  /** The native menu bar needs a real accelerator, not the display label. */
  accelerator?: string;
  checked?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  onSelect?: () => void;
};

export type AppMenuGroup = { label?: string; items: AppMenuItem[] };

/** Windows draws its own window controls; macOS keeps the native traffic
 * lights and spends the trailing edge on the shift state instead. */
export type AppMenuBarVariant = "windows" | "mac";

/** The Quit action is appended by the bar itself so every surface and test
 * gets the same bottom-of-menu contract. */
export function withQuitGroup(groups: AppMenuGroup[], onQuit: () => void, mac = isMacOS(), quitLabel = "Quit Work OS"): AppMenuGroup[] {
  return [
    ...groups.filter((group) => group.items.length > 0),
    { items: [{ label: quitLabel, shortcut: shortcutLabel("Q", mac), destructive: true, onSelect: onQuit }] },
  ];
}

function menuItems(menu: HTMLDivElement | null) {
  return Array.from(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? []);
}

function shiftState(statusLabel: string | null, tone: "shift" | "admin") {
  return statusLabel
    ? <span className={`wc-mac-state${tone === "admin" ? " is-admin" : ""}`}><i aria-hidden="true" />{statusLabel}</span>
    : null;
}

export default function AppMenuBar({
  pageLabel,
  statusLabel = null,
  statusTone = "shift",
  menuGroups,
  onQuit,
  quitLabel = "Quit Work OS",
  variant: requestedVariant,
  showTrafficLights = !isTauri(),
}: {
  pageLabel: string;
  statusLabel?: string | null;
  /** Admin mode is a workspace, not attendance, so it must not borrow the
   * shift marker. */
  statusTone?: "shift" | "admin";
  menuGroups: AppMenuGroup[];
  onQuit: () => void;
  quitLabel?: string;
  variant?: AppMenuBarVariant;
  showTrafficLights?: boolean;
}) {
  const variant = requestedVariant ?? (isMacOS() ? "mac" : "windows");
  const mac = variant === "mac";
  const appWindow = useMemo(() => (isTauri() ? getCurrentWindow() : null), []);
  const [maximized, setMaximized] = useState(false);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();
  const groups = withQuitGroup(menuGroups, onQuit, mac, quitLabel);

  useEffect(() => {
    document.documentElement.classList.add("window-chrome-active");
    return () => document.documentElement.classList.remove("window-chrome-active");
  }, []);

  useEffect(() => {
    if (!appWindow) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const sync = () => {
      void appWindow.isMaximized().then((value) => {
        if (!disposed) setMaximized(value);
      }).catch(() => undefined);
    };
    sync();
    void appWindow.onResized(sync).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [appWindow]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isQuitShortcut(event, mac)) {
        event.preventDefault();
        onQuit();
        return;
      }
      if (isSidebarShortcut(event, mac) && !isEditableTarget(event.target)) {
        event.preventDefault();
        window.dispatchEvent(new Event(SIDEBAR_TOGGLE_EVENT));
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mac, onQuit]);

  useEffect(() => {
    if (!open) return;
    menuItems(menuRef.current)[0]?.focus();
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const closeMenu = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const choose = (item: AppMenuItem) => {
    if (item.disabled) return;
    setOpen(false);
    triggerRef.current?.focus();
    item.onSelect?.();
  };

  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      return;
    }
    if (event.key === "Tab") {
      closeMenu(false);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = menuItems(menuRef.current);
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : Math.max(0, Math.min(items.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
    items[next]?.focus();
  };

  const minimize = () => { void appWindow?.minimize().catch(() => undefined); };
  const toggleMaximize = () => { void appWindow?.toggleMaximize().catch(() => undefined); };
  const closeWindow = () => { void appWindow?.close().catch(() => undefined); };

  return <header className={`wc-bar${mac ? " wc-bar--mac" : ""}`} data-variant={variant} data-tauri-drag-region>
    {mac ? <span className={`wc-traffic${showTrafficLights ? "" : " is-native"}`} aria-hidden="true">
      {showTrafficLights ? <><i className="wc-traffic-close" /><i className="wc-traffic-min" /><i className="wc-traffic-zoom" /></> : null}
    </span> : null}
    <div className="wc-brand" data-tauri-drag-region="deep">
      <button
        ref={triggerRef}
        type="button"
        className={`wc-trigger${open ? " is-open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onTriggerKeyDown}
      >Work OS <ChevronDown size={11} aria-hidden="true" /></button>
    </div>
    <div className="wc-drag" data-tauri-drag-region="deep">
      <span className="wc-page" title={pageLabel}>{pageLabel}</span>
      {variant === "windows" && statusLabel ? <><i className={statusTone === "admin" ? "is-admin" : undefined} aria-hidden="true" /><span className="wc-status">{statusLabel}</span></> : null}
    </div>
    {variant === "windows"
      ? <div className="wc-controls">
        <button type="button" aria-label="Minimize" title="Minimize" onClick={minimize}><Minus size={13} aria-hidden="true" /></button>
        <button type="button" aria-label={maximized ? "Restore" : "Maximize"} title={maximized ? "Restore" : "Maximize"} onClick={toggleMaximize}>{maximized ? <Copy size={11} aria-hidden="true" /> : <Square size={11} aria-hidden="true" />}</button>
        <button type="button" aria-label="Close window" title="Close window" className="wc-close" onClick={closeWindow}><X size={13} aria-hidden="true" /></button>
      </div>
      : <div className="wc-mac-trail is-chip">
        {shiftState(statusLabel, statusTone)}
      </div>}
    {open ? <div id={menuId} ref={menuRef} className="wc-menu" role="menu" aria-label="Work OS menu" onKeyDown={onMenuKeyDown}>
      {groups.map((group, groupIndex) => <div className={`wc-menu-group${groupIndex === groups.length - 1 ? " is-quit" : ""}`} key={`${group.label ?? "quit"}-${groupIndex}`}>
        {group.label ? <span className="wc-menu-label">{group.label}</span> : null}
        {group.items.map((item, itemIndex) => <button
          key={`${item.label}-${itemIndex}`}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          className={item.destructive ? "is-destructive" : undefined}
          onClick={() => choose(item)}
        >
          <span className="wc-menu-check">{item.checked ? <Check size={12} aria-hidden="true" /> : null}</span>
          <span className="wc-menu-text">{item.label}</span>
          {item.shortcut ? <kbd>{item.shortcut}</kbd> : null}
        </button>)}
      </div>)}
    </div> : null}
  </header>;
}
