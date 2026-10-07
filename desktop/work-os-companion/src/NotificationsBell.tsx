import { useEffect, type KeyboardEvent } from "react";
import { Bell, BellRing, ChevronRight, RefreshCw, X } from "lucide-react";
import { Skeleton } from "./LoadingUi";
import { formatWorkOsDate } from "./dateFormat";
import { useAnchoredMenu } from "./taskSurfaces";
import { MASCOT } from "./mascot";
import { MascotMark } from "./chat/MascotMark";
import { renderViewportSurface } from "./viewportSurface";
import { notificationsBadgeCount, notificationsSummary } from "./notificationsLogic";
import type { OutstandingEodDay, OutstandingEodStatus } from "./types";

export const OUTSTANDING_STATUS_META: Record<OutstandingEodStatus, { label: string; className: string }> = {
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

/** One recap the employee has not decided yet, as the panel names it. */
export interface ReadyRecapSummary {
  id: string;
  label: string;
}

/**
 * The masthead notifications panel. One list of what needs the employee right
 * now: what Otto remembers awaiting review, a ready recap awaiting a decision,
 * and the outstanding EOD days the bell already tracked. The badge counts all
 * three; every row opens the exact surface that resolves it.
 */
export function NotificationsBell({ memoryCandidates, recap, days, loading, error, open, onToggle, onClose, onSelect, onOpenMemory, onOpenRecap, onRetry }: {
  memoryCandidates: number;
  recap: ReadyRecapSummary | null;
  days: OutstandingEodDay[];
  loading: boolean;
  error: string | null;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSelect: (day: OutstandingEodDay) => void;
  onOpenMemory: () => void;
  onOpenRecap: () => void;
  onRetry: () => void;
}) {
  const { triggerRef, menuRef, style } = useAnchoredMenu(open);
  const count = notificationsBadgeCount({ memoryCandidates, recapReady: !!recap, outstandingEodDays: days.length });
  const reviewCount = memoryCandidates + (recap ? 1 : 0);
  const label = count > 0 ? `Notifications, ${count} item${count === 1 ? "" : "s"} need attention` : "Notifications";
  const headline = loading && !count ? "Checking what needs you…"
    : error && !count ? "Could not refresh the list"
      : count ? notificationsSummary({ memoryCandidates, recapReady: !!recap, outstandingEodDays: days.length })
        : "You're all caught up";

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const firstRow = menuRef.current?.querySelector<HTMLElement>(".notifications-row");
      const close = menuRef.current?.querySelector<HTMLElement>(".notifications-close");
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
    const rows = Array.from(menuRef.current?.querySelectorAll<HTMLElement>(".notifications-row") ?? []);
    if (!rows.length) return;
    event.preventDefault();
    const current = rows.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "Home" ? 0
      : event.key === "End" ? rows.length - 1
        : event.key === "ArrowDown" ? (current + 1) % rows.length
          : (current - 1 + rows.length) % rows.length;
    rows[next]?.focus();
  };

  const reviewReminder = (kind: "memory" | "recap") => {
    const memory = kind === "memory";
    return <li key={kind}>
      <button type="button" className="notifications-row review" onClick={memory ? onOpenMemory : onOpenRecap}>
        <span className="notifications-mascot" aria-hidden="true"><MascotMark /></span>
        <span className="notifications-row-main">
          <span className="notifications-row-title">{memory ? `This is what ${MASCOT.name} remembers about you so far` : "Your recap is ready"}</span>
          <span className="notifications-row-meta">{memory
            ? `${memoryCandidates} proposed fact${memoryCandidates === 1 ? "" : "s"} waiting for your review`
            : `${recap?.label ?? "Your last interval"} is ready to confirm or correct`}</span>
        </span>
        <span className="notifications-row-action">Review</span>
      </button>
    </li>;
  };

  return <>
    <button
      type="button"
      className="icon notifications-bell"
      ref={(node) => { triggerRef.current = node; }}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={open}
      title="Notifications"
      onClick={onToggle}
    >
      {count > 0 ? <BellRing size={17} /> : <Bell size={17} />}
      {count > 0 && <em className="notifications-bell-count" aria-hidden="true">{count > 9 ? "9+" : count}</em>}
    </button>
    {open && renderViewportSurface(
      <div className="notifications-card" role="dialog" aria-label="Notifications" ref={menuRef} style={style} onKeyDown={moveRowFocus}>
        <header className="notifications-head">
          <div>
            <strong>Notifications</strong>
            <small>{headline}</small>
          </div>
          <button type="button" className="icon notifications-close" aria-label="Close notifications" onClick={onClose}><X size={15} /></button>
        </header>
        <div className="notifications-body">
          {error && count > 0 && <div className="notifications-notice is-inline" role="status"><span>{error} Showing the last list.</span><button type="button" onClick={onRetry}><RefreshCw size={13} /> Retry</button></div>}
          {reviewCount > 0 && <section className="notifications-section" aria-label="Waiting for your review">
            <span className="notifications-section-title">Waiting for you</span>
            <ul className="notifications-list">
              {memoryCandidates > 0 && reviewReminder("memory")}
              {recap && reviewReminder("recap")}
            </ul>
          </section>}
          {days.length > 0 && <section className="notifications-section" aria-label="Outstanding EODs">
            <span className="notifications-section-title">Outstanding EODs</span>
            <ul className="notifications-list">{days.map((day) => {
              const status = OUTSTANDING_STATUS_META[day.status];
              return <li key={day.date}>
                <button type="button" className="notifications-row" onClick={() => onSelect(day)}>
                  <span className="notifications-row-main">
                    <span className="notifications-row-title">{formatWorkOsDate(day.date)}</span>
                    <span className="notifications-row-meta">{outstandingRowMeta(day) || "Recorded workday"}</span>
                  </span>
                  <span className={`eod-pill ${status.className}`}>{status.label}</span>
                  <ChevronRight size={14} />
                </button>
              </li>;
            })}</ul>
          </section>}
          {loading && !count ? <ul className="notifications-list" aria-hidden="true">{[0, 1, 2].map((row) => <li key={row} className="notifications-row is-skeleton"><Skeleton className="skeleton-line skeleton-title" /><Skeleton className="skeleton-line skeleton-body" /></li>)}</ul>
            : error && !count ? <div className="notifications-notice" role="status"><span>{error}</span><button type="button" onClick={onRetry}><RefreshCw size={14} /> Try again</button></div>
              : !count ? <div className="notifications-empty"><strong>You&apos;re caught up</strong><span>Recaps, memories, and EODs show up here when they need you.</span></div>
                : null}
        </div>
      </div>,
    )}
  </>;
}
