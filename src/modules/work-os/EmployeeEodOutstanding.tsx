"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Bell, BellRing, ChevronRight, RefreshCw, X } from "lucide-react";

export type OutstandingEodStatus = "no_draft" | "draft_unsubmitted" | "changes_requested";

export interface OutstandingEodDay {
  date: string;
  status: OutstandingEodStatus;
  reportId: string | null;
  observedMinutes: number;
  completedTasks: number;
  hasPlan: boolean;
}

export interface OutstandingEodsResponse {
  from: string;
  through: string;
  count: number;
  days: OutstandingEodDay[];
}

const STATUS_META: Record<OutstandingEodStatus, { label: string; color: string; background: string }> = {
  no_draft: { label: "Needs draft", color: "var(--status-warn)", background: "color-mix(in srgb, var(--status-warn) 12%, transparent)" },
  draft_unsubmitted: { label: "Draft not submitted", color: "var(--text-tertiary)", background: "transparent" },
  changes_requested: { label: "Changes requested", color: "var(--status-err)", background: "color-mix(in srgb, var(--status-err) 10%, transparent)" },
};

/** Formats a checked calendar date without letting the timezone shift its day. */
export function calendarDateLabel(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || "—";
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return value;
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: "UTC", month: "long", day: "numeric" }).format(parsed);
  } catch {
    return value;
  }
}

function weekdayLabel(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: "UTC", weekday: "long" }).format(parsed);
  } catch {
    return null;
  }
}

function observedLabel(minutes: number) {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return hours ? `${hours}h ${String(rest).padStart(2, "0")}m observed` : `${rest}m observed`;
}

export function outstandingRowMeta(day: OutstandingEodDay) {
  const outcomes = day.completedTasks > 0 ? `${day.completedTasks} task outcome${day.completedTasks === 1 ? "" : "s"}` : null;
  return [weekdayLabel(day.date), observedLabel(day.observedMinutes), outcomes].filter(Boolean).join(" · ");
}

export function EmployeeEodOutstandingBell({ days, loading, error, open, onToggle, onClose, onSelect, onRetry }: {
  days: OutstandingEodDay[];
  loading: boolean;
  error: string | null;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSelect: (day: OutstandingEodDay) => void;
  onRetry: () => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelLeft, setPanelLeft] = useState<number | null>(null);
  const count = days.length;
  const label = count > 0 ? `Outstanding EODs, ${count} day${count === 1 ? "" : "s"} need attention` : "Outstanding EODs";

  // Keep the detached card inside the viewport: prefer trailing alignment to
  // the bell, then clamp to an 8px margin and let the width shrink with it.
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const wrapper = rootRef.current;
      const panel = panelRef.current;
      if (!wrapper || !panel) return;
      const box = wrapper.getBoundingClientRect();
      const width = panel.offsetWidth;
      const viewportLeft = Math.min(Math.max(8, box.right - width), Math.max(8, window.innerWidth - 8 - width));
      setPanelLeft(viewportLeft - box.left);
    };
    measure();
    const frame = window.requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
    };
  }, [open, days.length]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const firstRow = panelRef.current?.querySelector<HTMLElement>("[data-eod-row]");
      const close = panelRef.current?.querySelector<HTMLElement>("[data-eod-close]");
      (firstRow ?? close)?.focus();
    });
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (!target || !rootRef.current?.contains(target)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [onClose, open]);

  const moveRowFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const rows = Array.from(panelRef.current?.querySelectorAll<HTMLElement>("[data-eod-row]") ?? []);
    if (!rows.length) return;
    event.preventDefault();
    const current = rows.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "Home" ? 0
      : event.key === "End" ? rows.length - 1
        : event.key === "ArrowDown" ? (current + 1) % rows.length
          : (current - 1 + rows.length) % rows.length;
    rows[next]?.focus();
  };

  return <div className="relative" ref={rootRef}>
    <button
      type="button"
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={open}
      title="Outstanding EODs"
      onClick={onToggle}
      className="relative grid size-9 place-items-center border text-[var(--text-secondary)]"
      style={{ borderColor: count ? "var(--status-warn)" : "var(--border)" }}
    >
      {count > 0 ? <BellRing size={15} /> : <Bell size={15} />}
      {count > 0 ? <em className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9px] font-bold not-italic" style={{ background: "var(--status-warn)", color: "var(--text-inverse)" }}>{count > 9 ? "9+" : count}</em> : null}
    </button>
    {open ? <div
      ref={panelRef}
      role="dialog"
      aria-label="Outstanding EODs"
      onKeyDown={moveRowFocus}
      className="absolute top-full z-50 mt-1.5 w-[min(370px,calc(100vw-2rem))] border shadow-lg"
      style={{ ...(panelLeft === null ? { right: 0 } : { left: panelLeft }), borderColor: "var(--border)", background: "var(--bg-card)" }}
    >
      <header className="flex items-start justify-between gap-3 border-b px-3.5 py-3" style={{ borderColor: "var(--border)" }}>
        <div>
          <strong className="block text-[13px] font-semibold text-[var(--text-primary)]">Outstanding EODs</strong>
          <small className="mt-0.5 block text-[10px] text-[var(--text-tertiary)]">
            {error ? "Could not refresh the list" : loading && !count ? "Checking past days…" : count ? `${count} past day${count === 1 ? "" : "s"} without a submitted report` : "Nothing outstanding"}
          </small>
        </div>
        <button type="button" data-eod-close aria-label="Close outstanding EODs" onClick={onClose} className="grid size-7 shrink-0 place-items-center border text-[var(--text-tertiary)]" style={{ borderColor: "var(--border)" }}><X size={13} /></button>
      </header>
      <div className="max-h-[60vh] overflow-y-auto">
        {error && count > 0 ? <div role="status" className="flex items-center justify-between gap-3 border-b px-3.5 py-2 text-[10px] text-[var(--text-secondary)]" style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--status-warn) 10%, transparent)" }}><span>{error} Showing the last list.</span><button type="button" onClick={onRetry} className="inline-flex items-center gap-1.5 text-[10px] font-semibold" style={{ color: "var(--text-primary)" }}><RefreshCw size={12} /> Retry</button></div> : null}
        {loading && !count ? <div aria-hidden="true">{[0, 1, 2].map((row) => <div key={row} className="border-b px-3.5 py-3 last:border-b-0" style={{ borderColor: "var(--border)" }}><span className="block h-3 w-28 animate-pulse rounded" style={{ background: "var(--border)" }} /><span className="mt-2 block h-2.5 w-44 animate-pulse rounded" style={{ background: "var(--border)" }} /></div>)}</div>
          : !count && error ? <div role="status" className="flex flex-col items-center gap-2 px-4 py-7 text-center text-[11px] text-[var(--text-secondary)]"><span>{error}</span><button type="button" onClick={onRetry} className="inline-flex items-center gap-1.5 border px-2.5 py-1.5 text-[11px] font-semibold" style={{ borderColor: "var(--border)" }}><RefreshCw size={12} /> Try again</button></div>
            : !count ? <div className="px-4 py-7 text-center"><strong className="block text-[12px] font-semibold text-[var(--text-primary)]">You&apos;re caught up</strong><span className="mt-1 block text-[11px] text-[var(--text-tertiary)]">No past workday is missing a submitted EOD.</span></div>
              : <ul>{days.map((day) => {
                const meta = STATUS_META[day.status];
                return <li key={day.date} className="border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
                  <button type="button" data-eod-row onClick={() => onSelect(day)} className="flex w-full items-start justify-between gap-3 px-3.5 py-2.5 text-left hover:bg-[color-mix(in_srgb,var(--accent)_5%,transparent)]">
                    <span className="min-w-0">
                      <span className="block text-[12px] font-semibold text-[var(--text-primary)]">{calendarDateLabel(day.date)}</span>
                      <span className="mt-0.5 block text-[10px] text-[var(--text-tertiary)]">{outstandingRowMeta(day) || "Recorded workday"}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 pt-0.5">
                      <span className="rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase" style={{ borderColor: meta.color, color: meta.color, background: meta.background }}>{meta.label}</span>
                      <ChevronRight size={13} className="text-[var(--text-tertiary)]" />
                    </span>
                  </button>
                </li>;
              })}</ul>}
      </div>
    </div> : null}
  </div>;
}
