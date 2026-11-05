import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactElement } from "react";
import { Check, ChevronDown, RotateCcw } from "lucide-react";
import { createPortal } from "react-dom";
import { MASCOT, type MascotPose, type MascotTone } from "../mascot";
import { MascotMark } from "../chat/MascotMark";
import type { OttoMode } from "./mode";
import { placeViewPopover } from "./viewPopover";
import "./view-switch.css";

export type CompanionViewSwitchProps = {
  mode: OttoMode;
  employeeAvailable: boolean;
  adminAvailable: boolean;
  employeeReason?: string | null;
  adminReason?: string | null;
  switchable?: boolean;
  pending?: OttoMode | null;
  error?: string | null;
  onSwitch: (mode: OttoMode) => void;
  onRetry?: () => void;
  className?: string;
  pose?: MascotPose;
  tone?: MascotTone;
};

type MenuProps = {
  open: boolean;
  mode: OttoMode;
  employeeAvailable: boolean;
  adminAvailable: boolean;
  employeeReason?: string | null;
  adminReason?: string | null;
  pending?: OttoMode | null;
  error?: string | null;
  onSwitch: (mode: OttoMode) => void;
  onRetry?: () => void;
  onClose: () => void;
  anchor?: { left: number; right: number; top: number; bottom: number } | null;
  labelledBy?: string;
};

const LABELS: Record<OttoMode, string> = { employee: "Employee", admin: "Admin" };

function optionFor(mode: OttoMode, employeeAvailable: boolean, adminAvailable: boolean, employeeReason?: string | null, adminReason?: string | null) {
  return {
    mode,
    label: LABELS[mode],
    available: mode === "employee" ? employeeAvailable : adminAvailable,
    reason: mode === "employee" ? employeeReason : adminReason,
  };
}

function MenuMarkup({
  mode, employeeAvailable, adminAvailable, employeeReason, adminReason,
  pending, error, onSwitch, onRetry, onClose, anchor, labelledBy,
}: Omit<MenuProps, "open">): ReactElement {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const options = [
    optionFor("employee", employeeAvailable, adminAvailable, employeeReason, adminReason),
    optionFor("admin", employeeAvailable, adminAvailable, employeeReason, adminReason),
  ];
  const [position, setPosition] = useState(() => anchor && typeof window !== "undefined"
    ? placeViewPopover({
        anchor,
        size: { width: 252, height: 214 },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      })
    : null);

  useEffect(() => {
    if (!anchor) return;
    const update = () => setPosition(placeViewPopover({
      anchor,
      size: { width: 252, height: 214 },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    }));
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchor]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const current = menuRef.current?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')
        ?? menuRef.current?.querySelector<HTMLElement>('[role="menuitemradio"]');
      current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const move = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      (document.activeElement as HTMLElement | null)?.click();
    }
  };

  return <div
    ref={menuRef}
    className="otto-view-menu"
    role="menu"
    aria-label={`${MASCOT.name} view`}
    aria-labelledby={labelledBy}
    data-view-menu
    data-mode={mode}
    style={position ? { left: position.left, top: position.top, width: position.width, maxHeight: position.height } : undefined}
    onKeyDown={move}
  >
    <div className="otto-view-menu-heading">
      <span>{MASCOT.name} view</span>
      <small>Follows your workspace</small>
    </div>
    {options.map((option) => {
      const current = option.mode === mode;
      const disabled = pending !== null || !option.available;
      return <button
        key={option.mode}
        type="button"
        role="menuitemradio"
        aria-checked={current}
        aria-disabled={disabled || undefined}
        className="otto-view-option"
        data-current={current ? "true" : undefined}
        onClick={() => {
          if (disabled) return;
          onSwitch(option.mode);
          onClose();
        }}
      >
        <span className="otto-view-option-mark" aria-hidden="true">{current ? <Check size={14} /> : null}</span>
        <span className="otto-view-option-copy">
          <strong>{option.label}</strong>
          {option.reason ? <small>{option.reason}</small> : null}
        </span>
        {current ? <span className="otto-view-current">Current</span> : null}
      </button>;
    })}
    {pending ? <p className="otto-view-status" role="status">Switching to {LABELS[pending]}…</p> : null}
    {error ? <div className="otto-view-error" role="alert">
      <p>{error}</p>
      {onRetry ? <button type="button" onClick={onRetry}><RotateCcw size={12} aria-hidden="true" />Try again</button> : null}
    </div> : null}
  </div>;
}

/** SSR-safe menu content for render tests and the portal. */
export function CompanionViewMenu({ open, ...props }: MenuProps): ReactElement | null {
  if (!open) return null;
  const menu = <MenuMarkup {...props} />;
  if (typeof document === "undefined") return menu;
  return createPortal(menu, document.body);
}

export function CompanionViewSwitch({
  mode, employeeAvailable, adminAvailable, employeeReason, adminReason,
  switchable = true, pending = null, error = null, onSwitch, onRetry, className, pose, tone,
}: CompanionViewSwitchProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ left: number; right: number; top: number; bottom: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();
  const current = LABELS[mode];

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target)) return;
      if (document.querySelector("[data-view-menu]")?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer, true);
    return () => document.removeEventListener("pointerdown", onPointer, true);
  }, [open]);

  if (!switchable) {
    return <span className={`otto-view-switch-static${className ? ` ${className}` : ""}`} aria-hidden="true" data-view-switch-static>
      <MascotMark mode={mode} pose={pose} tone={tone} />
    </span>;
  }

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
    setOpen(true);
  };

  return <>
    <button
      ref={triggerRef}
      id={menuId}
      type="button"
      className={`otto-view-switch${open ? " is-open" : ""}${className ? ` ${className}` : ""}`}
      data-view-switch
      data-mode={mode}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={menuId}
      aria-label={`${MASCOT.name} view: ${current}. Change view`}
      title={`${MASCOT.name} view: ${current}`}
      onClick={toggle}
    >
      <span className="otto-view-switch-mark"><MascotMark mode={mode} pose={pose} tone={tone} /></span>
      <span className="otto-view-switch-live" aria-hidden="true">{current}</span>
      <ChevronDown className="otto-view-switch-chevron" size={12} aria-hidden="true" />
    </button>
    <CompanionViewMenu
      open={open}
      mode={mode}
      employeeAvailable={employeeAvailable}
      adminAvailable={adminAvailable}
      employeeReason={employeeReason}
      adminReason={adminReason}
      pending={pending}
      error={error}
      onSwitch={onSwitch}
      onRetry={onRetry}
      onClose={() => {
        setOpen(false);
        window.requestAnimationFrame(() => {
          if (triggerRef.current?.isConnected) triggerRef.current.focus();
        });
      }}
      anchor={anchor}
      labelledBy={menuId}
    />
  </>;
}
