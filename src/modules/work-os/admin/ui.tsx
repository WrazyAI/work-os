"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import type { ReactNode } from "react";

/* Shared primitives for the Work OS administration surface. They follow the
 * design.md blueprint: warm raised surfaces, hairline structure, one signal
 * action per decision area, and quiet metadata. */

export function cx(...items: Array<string | false | null | undefined>) {
  return items.filter(Boolean).join(" ");
}

export function AdminCard({ children, className, padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section
      className={cx("rounded-2xl border", padded && "p-5", className)}
      style={{ borderColor: "var(--border)", background: "var(--bg-card)", boxShadow: "var(--shadow-sm)" }}
    >
      {children}
    </section>
  );
}

export function SectionHeading({ icon: Icon, title, detail, action }: {
  icon?: typeof Info;
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
          {Icon ? <Icon size={16} style={{ color: "var(--accent)" }} aria-hidden /> : null}
          {title}
        </h2>
        {detail ? <p className="mt-1 text-[12px] leading-5 text-[var(--text-tertiary)]">{detail}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function Metric({ label, value, detail, tone = "neutral", href, onClick }: {
  label: string;
  value: ReactNode;
  detail?: string;
  tone?: "neutral" | "signal" | "warn" | "err" | "observed";
  href?: string;
  onClick?: () => void;
}) {
  const color =
    tone === "signal" ? "var(--accent)"
      : tone === "warn" ? "var(--status-warn)"
        : tone === "err" ? "var(--status-error)"
          : tone === "observed" ? "var(--status-observed)"
            : "var(--text-primary)";
  const body = (
    <>
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">{label}</span>
      <span className="mt-1.5 block text-[24px] font-semibold leading-none tracking-[-0.02em] [font-variant-numeric:tabular-nums]" style={{ color }}>{value}</span>
      {detail ? <span className="mt-1.5 block text-[11px] leading-4 text-[var(--text-tertiary)]">{detail}</span> : null}
    </>
  );
  const className = cx(
    "block rounded-2xl border p-4 text-left transition",
    (href || onClick) && "hover:border-[var(--border-hot)]",
  );
  const style = { borderColor: "var(--border)", background: "var(--bg-card)", boxShadow: "var(--shadow-sm)" };
  if (href) return <Link href={href} className={className} style={style}>{body}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={className} style={style}>{body}</button>;
  return <div className={className} style={style}>{body}</div>;
}

const pillTones: Record<string, { color: string; background: string; border: string }> = {
  neutral: { color: "var(--text-secondary)", background: "var(--bg-secondary)", border: "var(--border)" },
  ok: { color: "var(--status-ok)", background: "color-mix(in srgb, var(--status-ok) 10%, transparent)", border: "color-mix(in srgb, var(--status-ok) 32%, transparent)" },
  warn: { color: "var(--status-warn)", background: "color-mix(in srgb, var(--status-warn) 12%, transparent)", border: "color-mix(in srgb, var(--status-warn) 34%, transparent)" },
  err: { color: "var(--status-error)", background: "color-mix(in srgb, var(--status-error) 10%, transparent)", border: "color-mix(in srgb, var(--status-error) 32%, transparent)" },
  info: { color: "var(--status-info)", background: "color-mix(in srgb, var(--status-info) 10%, transparent)", border: "color-mix(in srgb, var(--status-info) 30%, transparent)" },
  observed: { color: "var(--status-observed)", background: "var(--status-observed-soft)", border: "color-mix(in srgb, var(--status-observed) 28%, transparent)" },
};

export function StatusPill({ tone = "neutral", children, icon: Icon }: { tone?: keyof typeof pillTones; children: ReactNode; icon?: typeof Info }) {
  const palette = pillTones[tone] ?? pillTones.neutral;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] font-semibold leading-none"
      style={{ color: palette.color, background: palette.background, borderColor: palette.border }}
    >
      {Icon ? <Icon size={11} aria-hidden /> : null}
      {children}
    </span>
  );
}

export function ProvenanceChip({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.06em] text-[var(--text-tertiary)]"
      style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}
    >
      {children}
    </span>
  );
}

export function Notice({ tone = "info", children, action }: { tone?: "info" | "warn" | "err" | "ok"; children: ReactNode; action?: ReactNode }) {
  const palette = tone === "err" ? pillTones.err : tone === "warn" ? pillTones.warn : tone === "ok" ? pillTones.ok : pillTones.info;
  const Icon = tone === "err" || tone === "warn" ? AlertTriangle : tone === "ok" ? CheckCircle2 : Info;
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border px-3.5 py-3 text-[12.5px] leading-5"
      style={{ borderColor: palette.border, background: palette.background, color: palette.color }}>
      <span className="flex min-w-0 items-start gap-2">
        <Icon size={15} className="mt-0.5 shrink-0" aria-hidden />
        <span className="min-w-0">{children}</span>
      </span>
      {action}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, body, action }: { icon?: typeof Info; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="grid place-items-center rounded-2xl border px-6 py-12 text-center" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-secondary)" }}>
      <div>
        {Icon ? (
          <span className="mx-auto grid size-10 place-items-center rounded-full border" style={{ borderColor: "var(--border)", background: "var(--bg-card)", color: "var(--text-tertiary)" }}>
            <Icon size={18} aria-hidden />
          </span>
        ) : null}
        <p className="mt-3 text-[14px] font-semibold text-[var(--text-primary)]">{title}</p>
        {body ? <p className="mx-auto mt-1 max-w-md text-[12.5px] leading-5 text-[var(--text-tertiary)]">{body}</p> : null}
        {action ? <div className="mt-4 flex justify-center gap-2">{action}</div> : null}
      </div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-lg", className)} style={{ background: "var(--bg-tertiary)" }} aria-hidden />;
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const label = initials(name);
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full border text-[11px] font-semibold"
      style={{ width: size, height: size, borderColor: "var(--border)", background: "var(--bg-secondary)", color: "var(--text-secondary)" }}
    >
      {label}
    </span>
  );
}

export function initials(value?: string | null) {
  const parts = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function Button({ variant = "secondary", size = "md", className, children, ...rest }: {
  variant?: ButtonVariant;
  size?: "sm" | "md";
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const style =
    variant === "primary"
      ? { background: "var(--color-ink, var(--text-primary))", color: "var(--text-inverse)", borderColor: "var(--color-ink, var(--text-primary))" }
      : variant === "danger"
        ? { background: "transparent", color: "var(--status-error)", borderColor: "color-mix(in srgb, var(--status-error) 40%, transparent)" }
        : variant === "ghost"
          ? { background: "transparent", color: "var(--text-secondary)", borderColor: "transparent" }
          : { background: "var(--bg-card)", color: "var(--text-primary)", borderColor: "var(--border)" };
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-[10px] border font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "px-2.5 py-1.5 text-[11px]" : "px-3 py-2 text-[12px]",
        className,
      )}
      style={{ ...style, ...(rest.style ?? {}) }}
    >
      {children}
    </button>
  );
}

export function SegmentedControl<T extends string>({ options, value, onChange, ariaLabel }: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="inline-flex items-center gap-0.5 rounded-[10px] border p-0.5" style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cx("rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold transition", !active && "hover:text-[var(--text-primary)]")}
            style={active
              ? { background: "var(--bg-card)", color: "var(--text-primary)", boxShadow: "var(--shadow-sm)" }
              : { background: "transparent", color: "var(--text-tertiary)" }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function SelectField({ label, value, onChange, options, placeholder, ariaLabel, className }: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <label className={cx("grid gap-1 text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]", className)}>
      {label}
      <select
        aria-label={ariaLabel ?? label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-[34px] rounded-[10px] border bg-transparent px-2.5 py-1.5 text-[12px] font-normal normal-case tracking-normal text-[var(--text-primary)] outline-none"
        style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
      </select>
    </label>
  );
}

export function TextField({ label, value, onChange, type = "text", placeholder, ariaLabel, className }: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <label className={cx("grid gap-1 text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]", className)}>
      {label}
      <input
        aria-label={ariaLabel ?? label}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="min-h-[34px] rounded-[10px] border bg-transparent px-2.5 py-1.5 text-[12px] font-normal normal-case tracking-normal text-[var(--text-primary)] outline-none"
        style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}
      />
    </label>
  );
}

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
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previous?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close details" className="absolute inset-0 bg-black/35" onClick={onClose} />
      <div
        className="relative flex h-full w-full flex-col border-l"
        style={{ maxWidth: width, background: "var(--bg-card)", borderColor: "var(--border)", boxShadow: "var(--shadow-md)" }}
      >
        <header className="flex items-start justify-between gap-3 border-b px-5 py-4" style={{ borderColor: "var(--border-subtle)" }}>
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-semibold text-[var(--text-primary)]">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-[12px] text-[var(--text-tertiary)]">{subtitle}</p> : null}
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid size-8 shrink-0 place-items-center rounded-lg border text-[var(--text-tertiary)] transition hover:text-[var(--text-primary)]"
            style={{ borderColor: "var(--border)" }}
          >
            <X size={15} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <footer className="border-t px-5 py-3" style={{ borderColor: "var(--border-subtle)" }}>{footer}</footer> : null}
      </div>
    </div>
  );
}

export function ProgressRing({ completed, total, size = 44, label }: { completed: number; total: number; size?: number; label?: string }) {
  const percent = total > 0 ? Math.max(0, Math.min(1, completed / total)) : 0;
  const radius = (size - 6) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label ?? `${completed} of ${total}`}>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--bg-tertiary)" strokeWidth={4} />
      <circle
        cx={size / 2} cy={size / 2} r={radius} fill="none"
        stroke="var(--accent)" strokeWidth={4} strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - percent)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="52%" textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.24} fontWeight={650} fill="var(--text-primary)">
        {completed}/{total}
      </text>
    </svg>
  );
}

export function MiniBars({ points, ariaLabel, height = 120 }: {
  points: Array<{ label: string; value: number; secondary?: number }>;
  ariaLabel: string;
  height?: number;
}) {
  const max = Math.max(1, ...points.map((point) => Math.max(point.value, point.secondary ?? 0)));
  const width = Math.max(320, points.length * 34);
  const barWidth = 10;
  const gap = (width - points.length * barWidth) / Math.max(1, points.length - 1);
  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height + 22} viewBox={`0 0 ${width} ${height + 22}`} role="img" aria-label={ariaLabel} style={{ minWidth: "100%" }}>
        <line x1={0} y1={height} x2={width} y2={height} stroke="var(--border)" strokeWidth={1} />
        {points.map((point, index) => {
          const x = index * (barWidth + gap);
          const primary = Math.round((point.value / max) * (height - 10));
          const secondary = Math.round(((point.secondary ?? 0) / max) * (height - 10));
          return (
            <g key={`${point.label}-${index}`}>
              <title>{`${point.label}: ${point.value}${point.secondary != null ? ` (+${point.secondary} updates)` : ""}`}</title>
              <rect x={x} y={height - primary} width={barWidth} height={primary} rx={3} fill="var(--accent)" />
              {point.secondary != null ? <rect x={x + barWidth + 2} y={height - secondary} width={barWidth} height={secondary} rx={3} fill="var(--status-observed)" opacity={0.75} /> : null}
              <text x={x + barWidth / 2} y={height + 14} textAnchor="middle" fontSize={9} fill="var(--text-tertiary)">{point.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function formatClock(value?: string | null, timezone?: string | null, fallback = "—") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: timezone ?? undefined, hour: "numeric", minute: "2-digit" }).format(date);
  } catch {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
}

export function formatDuration(seconds?: number | null) {
  const total = Math.max(0, Math.round(Number(seconds ?? 0) / 60));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (!hours) return `${minutes}m`;
  if (!minutes) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export function relativeTime(value?: string | null, now = new Date()) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const diffMs = now.getTime() - date.getTime();
  const future = diffMs < 0;
  const minutes = Math.round(Math.abs(diffMs) / 60_000);
  if (minutes < 1) return future ? "in a moment" : "just now";
  if (minutes < 60) return future ? `in ${minutes}m` : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return future ? `in ${hours}h` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return future ? `in ${days}d` : `${days}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function statusLabel(value?: string | null) {
  if (!value) return "—";
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}
