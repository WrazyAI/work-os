import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/** Administration workspace primitives.
 *
 * The desktop admin pages share the companion's material system (panel, card
 * title, tokens) and add the small set of operational controls the workspace
 * needs: pills, drawers, segmented filters, notices, and skeletons. Every
 * primitive keeps its contract in markup + admin.css rather than inline styles
 * so the surfaces stay consistent. */

export function cx(...items: Array<string | false | null | undefined>) {
  return items.filter(Boolean).join(" ");
}

export function AdminCard({ icon: Icon, title, detail, action, padded = true, children, className }: {
  icon?: typeof X;
  title?: string;
  detail?: string;
  action?: ReactNode;
  padded?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("panel admin-card", className)}>
      {title ? (
        <div className="card-title admin-card-title">
          <span>{Icon ? <Icon size={17} aria-hidden /> : null} {title}</span>
          <div className="admin-card-meta">
            {detail ? <small>{detail}</small> : null}
            {action}
          </div>
        </div>
      ) : null}
      <div className={cx("admin-card-body", padded && "is-padded")}>{children}</div>
    </section>
  );
}

export type PillTone = "ok" | "warn" | "err" | "info" | "neutral" | "observed";

export function Pill({ tone = "neutral", icon: Icon, children, title }: {
  tone?: PillTone;
  icon?: typeof X;
  children: ReactNode;
  title?: string;
}) {
  return <span className={`admin-pill ${tone}`} title={title}>{Icon ? <Icon size={11} aria-hidden /> : null}{children}</span>;
}

export function Avatar({ name, size = 30 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";
  return <span className="admin-avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }} aria-hidden>{initials}</span>;
}

export function Notice({ tone = "info", children, action }: { tone?: "info" | "ok" | "warn" | "err"; children: ReactNode; action?: ReactNode }) {
  return <div className={`admin-notice ${tone}`} role="status">{children}{action ? <span className="admin-notice-action">{action}</span> : null}</div>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("admin-skeleton", className)} aria-hidden />;
}

export function Empty({ title, body }: { title: string; body: string }) {
  return <div className="admin-empty"><strong>{title}</strong><p>{body}</p></div>;
}

export function Segmented<T extends string>({ value, onChange, options, ariaLabel }: {
  value: T;
  onChange: (next: T) => void;
  options: Array<{ value: T; label: string; count?: number }>;
  ariaLabel: string;
}) {
  return (
    <div className="admin-seg" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? "active" : ""}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {typeof option.count === "number" ? <small>{option.count}</small> : null}
        </button>
      ))}
    </div>
  );
}

export function SelectField({ label, value, onChange, options, placeholder, ariaLabel }: {
  label?: string;
  value: string;
  onChange: (next: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  ariaLabel?: string;
}) {
  return (
    <label className="admin-field">
      {label ? <span>{label}</span> : null}
      <select value={value} aria-label={ariaLabel ?? label} onChange={(event) => onChange(event.target.value)}>
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

export function TextField({ label, type = "text", value, onChange, ariaLabel, placeholder }: {
  label?: string;
  type?: "text" | "date" | "search";
  value: string;
  onChange: (next: string) => void;
  ariaLabel?: string;
  placeholder?: string;
}) {
  return (
    <label className="admin-field">
      {label ? <span>{label}</span> : null}
      <input type={type} value={value} placeholder={placeholder} aria-label={ariaLabel ?? label} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className="admin-check">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="admin-section-label">{children}</p>;
}

export function KeyValue({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="admin-kv">
      <span>{label}</span>
      <b className={mono ? "is-mono" : undefined}>{value}</b>
    </div>
  );
}

/** Right-side drawer for one record. Keeps the list behind it in place, closes
 * on Escape and backdrop press, and returns focus to the opener. */
export function Drawer({ open, onClose, title, subtitle, children, footer, width = 560 }: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const lastFocus = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    lastFocus.current = document.activeElement;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (lastFocus.current instanceof HTMLElement) lastFocus.current.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="admin-drawer-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="admin-drawer" role="dialog" aria-modal="true" aria-label={title} style={{ width }}>
        <header className="admin-drawer-head">
          <div className="min-w-0">
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button ref={closeRef} type="button" className="icon" aria-label="Close" onClick={onClose}>
            <X size={16} aria-hidden />
          </button>
        </header>
        <div className="admin-drawer-body">{children}</div>
        {footer ? <footer className="admin-drawer-foot">{footer}</footer> : null}
      </aside>
    </div>
  );
}

/** Action button in the workspace's quiet product language. */
export function AdminButton({ children, onClick, variant = "secondary", disabled, title, icon: Icon, type = "button" }: {
  children?: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  title?: string;
  icon?: typeof X;
  type?: "button" | "submit";
}) {
  return (
    <button type={type} className={`admin-button ${variant}`} onClick={onClick} disabled={disabled} title={title}>
      {Icon ? <Icon size={13} aria-hidden /> : null}
      {children}
    </button>
  );
}
