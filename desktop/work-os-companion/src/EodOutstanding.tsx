import { useEffect, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Bell, BellRing, ChevronRight, RefreshCw, X } from "lucide-react";
import { Skeleton } from "./LoadingUi";
import { formatWorkOsDate } from "./dateFormat";
import { useAnchoredMenu } from "./taskSurfaces";
import type { OutstandingEodDay, OutstandingEodStatus } from "./types";

const STATUS_LABELS: Record<OutstandingEodStatus, { label: string; className: string }> = {
  no_draft: { label: "Needs draft", className: "needs-draft" },
  draft_unsubmitted: { label: "Draft not submitted", className: "draft-open" },
  changes_requested: { label: "Changes requested", className: "changes-requested" },
};

function weekdayLabel(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" }).format(parsed);
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

export function EodOutstandingBell({ days, loading, error, open, onToggle, onClose, onSelect, onRetry }: {
  days: OutstandingEodDay[];
  loading: boolean;
  error: string | null;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSelect: (day: OutstandingEodDay) => void;
  onRetry: () => void;
}) {
  const { triggerRef, menuRef, style } = useAnchoredMenu(open);
  const count = days.length;
  const label = count > 0 ? `Outstanding EODs, ${count} day${count === 1 ? "" : "s"} need attention` : "Outstanding EODs";

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const firstRow = menuRef.current?.querySelector<HTMLElement>(".eod-outstanding-row");
      const close = menuRef.current?.querySelector<HTMLElement>(".eod-outstanding-close");
      (firstRow ?? close)?.focus();
    });
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (!target || (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target))) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [menuRef, onClose, open, triggerRef]);

  const moveRowFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const rows = Array.from(menuRef.current?.querySelectorAll<HTMLElement>(".eod-outstanding-row") ?? []);
    if (!rows.length) return;
    event.preventDefault();
    const current = rows.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "Home" ? 0
      : event.key === "End" ? rows.length - 1
        : event.key === "ArrowDown" ? (current + 1) % rows.length
          : (current - 1 + rows.length) % rows.length;
    rows[next]?.focus();
  };

  return <>
    <button
      type="button"
      className="icon eod-bell"
      ref={(node) => { triggerRef.current = node; }}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={open}
      title="Outstanding EODs"
      onClick={onToggle}
    >
      {count > 0 ? <BellRing size={17} /> : <Bell size={17} />}
      {count > 0 && <em className="eod-bell-count" aria-hidden="true">{count > 9 ? "9+" : count}</em>}
    </button>
    {open && createPortal(
      <div className="eod-outstanding-card" role="dialog" aria-label="Outstanding EODs" ref={menuRef} style={style} onKeyDown={moveRowFocus}>
        <header className="eod-outstanding-head">
          <div>
            <strong>Outstanding EODs</strong>
            <small>{error ? "Could not refresh the list" : loading && !count ? "Checking past days…" : count ? `${count} past day${count === 1 ? "" : "s"} without a submitted report` : "Nothing outstanding"}</small>
          </div>
          <button type="button" className="icon eod-outstanding-close" aria-label="Close outstanding EODs" onClick={onClose}><X size={15} /></button>
        </header>
        <div className="eod-outstanding-body">
          {error && count > 0 && <div className="eod-outstanding-notice is-inline" role="status"><span>{error} Showing the last list.</span><button type="button" onClick={onRetry}><RefreshCw size={13} /> Retry</button></div>}
          {loading && !count ? <ul className="eod-outstanding-list" aria-hidden="true">{[0, 1, 2].map((row) => <li key={row} className="eod-outstanding-row is-skeleton"><Skeleton className="skeleton-line skeleton-title" /><Skeleton className="skeleton-line skeleton-body" /></li>)}</ul>
            : !count && error ? <div className="eod-outstanding-notice" role="status"><span>{error}</span><button type="button" onClick={onRetry}><RefreshCw size={14} /> Try again</button></div>
              : !count ? <div className="eod-outstanding-empty"><strong>You&apos;re caught up</strong><span>No past workday is missing a submitted EOD.</span></div>
                : <ul className="eod-outstanding-list">{days.map((day) => {
                  const status = STATUS_LABELS[day.status];
                  return <li key={day.date}>
                    <button type="button" className="eod-outstanding-row" onClick={() => onSelect(day)}>
                      <span className="eod-outstanding-row-main">
                        <span className="eod-outstanding-row-title">{formatWorkOsDate(day.date)}</span>
                        <span className="eod-outstanding-row-meta">{outstandingRowMeta(day) || "Recorded workday"}</span>
                      </span>
                      <span className={`eod-pill ${status.className}`}>{status.label}</span>
                      <ChevronRight size={14} />
                    </button>
                  </li>;
                })}</ul>}
        </div>
      </div>,
      document.body,
    )}
  </>;
}
