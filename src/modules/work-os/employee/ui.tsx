"use client";

/** Shared presentational primitives for the employee workspace.
 *
 * One warm-paper language for every destination: panels with hairline edges
 * and a single shadow family, flat rows, one primary action per area
 * (design.md §2, §8.1). The tokens resolve from the scoped Work OS block in
 * globals.css while these routes are mounted. */

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

export function cx(...items: Array<string | false | null | undefined>) {
  return items.filter(Boolean).join(" ");
}

const PANEL_SHADOW = "0 1px 2px rgba(20,30,18,.035), 0 10px 28px rgba(20,30,18,.045)";

export function Panel({
  children,
  className,
  style,
  ...rest
}: { children: ReactNode; className?: string } & HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cx("rounded-2xl border", className)}
      style={{ borderColor: "var(--border)", background: "var(--bg-card)", boxShadow: PANEL_SHADOW, ...style }}
      {...rest}
    >
      {children}
    </section>
  );
}

export function PanelHeader({
  icon,
  title,
  meta,
  actions,
}: {
  icon?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold leading-tight text-[var(--text-primary)]">
          {icon ? <span className="shrink-0" style={{ color: "var(--accent-deep)" }}>{icon}</span> : null}
          {title}
        </h2>
        {meta ? <div className="mt-1 text-[12px] leading-5 text-[var(--text-tertiary)]">{meta}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Masthead({
  eyebrow,
  title,
  meta,
  actions,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">{eyebrow}</p>
        <h1 className="mt-1.5 text-[26px] font-bold leading-tight tracking-[-0.01em] text-[var(--text-primary)]">{title}</h1>
        {meta ? <p className="mt-1.5 text-[12px] leading-5 text-[var(--text-secondary)]">{meta}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div> : null}
    </header>
  );
}

export function Notice({
  tone = "info",
  children,
  className,
}: {
  tone?: "info" | "warn" | "err";
  children: ReactNode;
  className?: string;
}) {
  const color = tone === "err" ? "var(--status-error)" : tone === "warn" ? "var(--status-warn)" : "var(--accent-deep)";
  return (
    <div
      className={cx("rounded-xl border px-3.5 py-2.5 text-[12px] leading-5", className)}
      style={{ borderColor: `color-mix(in srgb, ${color} 42%, var(--border))`, background: `color-mix(in srgb, ${color} 7%, var(--bg-card))`, color: "var(--text-primary)" }}
    >
      {children}
    </div>
  );
}

export function PrimaryButton({ className, style, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-[10px] px-3.5 py-2 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-45",
        className,
      )}
      style={{ background: "var(--signal)", color: "var(--signal-ink)", border: "1px solid transparent", ...style }}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({ className, style, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-[10px] border px-3.5 py-2 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 hover:border-[var(--border-hot)]",
        className,
      )}
      style={{ borderColor: "var(--border)", background: "var(--bg-card)", color: "var(--text-primary)", ...style }}
    >
      {children}
    </button>
  );
}

export function QuietButton({ className, style, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cx("inline-flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-[12px] font-semibold transition disabled:opacity-45", className)}
      style={{ color: "var(--text-secondary)", ...style }}
    >
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className,
  style,
  children,
  ...props
}: { label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      aria-label={label}
      title={label}
      className={cx("grid size-9 shrink-0 place-items-center rounded-[10px] border transition disabled:opacity-45", className)}
      style={{ borderColor: "var(--border)", background: "var(--bg-card)", color: "var(--text-secondary)", ...style }}
    >
      {children}
    </button>
  );
}

export function StatusPill({ tone = "open", children }: { tone?: "open" | "done" | "overdue" | "error" | "info"; children: ReactNode }) {
  const color =
    tone === "done" ? "var(--status-ok)"
      : tone === "overdue" ? "var(--status-warn)"
        : tone === "error" ? "var(--status-error)"
          : tone === "info" ? "var(--status-info)"
            : "var(--text-tertiary)";
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em]"
      style={{ borderColor: `color-mix(in srgb, ${color} 45%, var(--border))`, color }}
    >
      {children}
    </span>
  );
}

export const inputClass =
  "w-full rounded-[10px] border px-3 py-2 text-[13px] font-normal text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-tertiary)] focus:border-[var(--accent-deep)]";

export const inputStyle = { borderColor: "var(--border)", background: "var(--bg-card)" } as const;

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[11px] font-semibold text-[var(--text-secondary)]">{label}</span>
      {children}
      {hint ? <span className="text-[11px] font-normal leading-4 text-[var(--text-tertiary)]">{hint}</span> : null}
    </label>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon?: ReactNode;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      {icon ? <span style={{ color: "var(--text-tertiary)" }}>{icon}</span> : null}
      <strong className="text-[13px] font-semibold text-[var(--text-primary)]">{title}</strong>
      {message ? <span className="max-w-md text-[12px] leading-5 text-[var(--text-secondary)]">{message}</span> : null}
      {action ? <span className="mt-1">{action}</span> : null}
    </div>
  );
}

export function Metric({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: "neutral" | "warn" | "error";
}) {
  const color = tone === "warn" ? "var(--status-warn)" : tone === "error" ? "var(--status-error)" : "var(--text-primary)";
  return (
    <div className="rounded-xl border px-3.5 py-3" style={{ borderColor: "var(--border)", background: "var(--bg-primary)" }}>
      <span className="block text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">{label}</span>
      <strong className="mt-1 block text-[20px] font-bold leading-none tabular-nums" style={{ color }}>{value}</strong>
      {detail ? <span className="mt-1.5 block text-[11px] leading-4 text-[var(--text-tertiary)]">{detail}</span> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cx("block animate-pulse rounded-lg", className)} style={{ background: "var(--bg-tertiary)" }} />;
}
