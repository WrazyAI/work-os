import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import {
  Bell,
  BellRing,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  FileCheck2,
  Flag,
  LayoutDashboard,
  MessageSquareText,
  RefreshCw,
  Scale,
  ShieldAlert,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { Skeleton } from "./LoadingUi";
import { formatWorkOsDate } from "./dateFormat";
import { useAnchoredMenu } from "./taskSurfaces";
import { MASCOT } from "./mascot";
import { MascotMark } from "./chat/MascotMark";
import { renderViewportSurface } from "./viewportSurface";
import { notificationsBadgeCount, overdueSummary } from "./notificationsLogic";
import {
  adminNotificationActivity,
  adminNotificationDecisionCount,
  adminNotificationDecisions,
  adminNotificationPulse,
} from "./admin/adminNotificationModel";
import type { AdminOverview, AdminSection, AdminSectionFocus } from "./admin/types";
import type { OutstandingEodDay, OutstandingEodStatus } from "./types";

export const OUTSTANDING_STATUS_META: Record<OutstandingEodStatus, { label: string; className: string }> = {
  no_draft: { label: "Needs draft", className: "needs-draft" },
  draft_unsubmitted: { label: "Draft not submitted", className: "draft-open" },
  changes_requested: { label: "Changes requested", className: "changes-requested" },
};

/** The administration record the Admin tab reads. The app owns the query so a
 * closed bell still carries an accurate badge; the workspace owns where each
 * row lands. */
export type AdminNotificationFeed = {
  overview: AdminOverview | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onNavigate: (section: AdminSection, focus?: AdminSectionFocus) => void;
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

function decisionIcon(code: string) {
  if (code === "reports_pending_review") return <FileCheck2 size={16} />;
  if (code === "eod_outstanding") return <CalendarClock size={16} />;
  if (code === "tasks_overdue") return <CircleAlert size={16} />;
  if (code === "evidence_disputed") return <Scale size={16} />;
  if (code === "readiness_blocked") return <ShieldAlert size={16} />;
  return <Flag size={16} />;
}

function activityIcon(kind: AdminOverview["recentActivity"][number]["kind"]) {
  if (kind === "task_completed") return <CircleCheck size={15} />;
  if (kind === "eod_submitted") return <FileCheck2 size={15} />;
  if (kind === "evidence") return <Sparkles size={15} />;
  if (kind === "recap") return <MessageSquareText size={15} />;
  return <UserRound size={15} />;
}

/**
 * The masthead notifications panel. One surface, two audiences: the Employee
 * tab is the account's own list of what needs the employee right now; the Admin
 * tab is the live workspace decision queue and team pulse. The active tab
 * starts on the workspace the person is in, so opening the bell never makes an
 * administrator read their personal reminders first.
 */
export function NotificationsBell({ memoryCandidates, recap, overdueTasks, days, loading, error, open, onToggle, onClose, onSelect, onOpenMemory, onOpenRecap, onOpenOverdue, onRetry, admin, defaultTab = "employee" }: {
  memoryCandidates: number;
  recap: ReadyRecapSummary | null;
  overdueTasks: number;
  days: OutstandingEodDay[];
  loading: boolean;
  error: string | null;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSelect: (day: OutstandingEodDay) => void;
  onOpenMemory: () => void;
  onOpenRecap: () => void;
  onOpenOverdue: () => void;
  onRetry: () => void;
  /** Present only for administrators. It supplies the Admin tab and its badge. */
  admin?: AdminNotificationFeed | null;
  /** Which audience the bell starts on when it opens. Reset on every open. */
  defaultTab?: "employee" | "admin";
}) {
  const { triggerRef, menuRef, style } = useAnchoredMenu(open);
  const bodyRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const [tab, setTab] = useState<"employee" | "admin">(defaultTab);
  // Opening the panel starts on the workspace that owns the bell. Reset during
  // render, not in an effect, so the first painted frame is already correct
  // even after a previous visit ended on the other audience.
  const [previousOpen, setPreviousOpen] = useState(open);
  if (open !== previousOpen) {
    setPreviousOpen(open);
    if (open) setTab(defaultTab);
  }
  const [previousDefaultTab, setPreviousDefaultTab] = useState(defaultTab);
  if (defaultTab !== previousDefaultTab) {
    setPreviousDefaultTab(defaultTab);
    if (open) setTab(defaultTab);
  }
  const employeeCount = notificationsBadgeCount({ memoryCandidates, recapReady: !!recap, overdueTasks, outstandingEodDays: days.length });
  const adminCount = adminNotificationDecisionCount(admin?.overview);
  const showTabs = Boolean(admin);
  const activeTab = showTabs ? tab : "employee";
  // While the panel is open the badge follows the audience being read; when it
  // closes it snaps back to the one the next open will show.
  const count = open
    ? activeTab === "admin" ? adminCount : employeeCount
    : showTabs && defaultTab === "admin" ? adminCount : employeeCount;
  const reviewCount = memoryCandidates + (recap ? 1 : 0);
  const label = count > 0 ? `Notifications, ${count} item${count === 1 ? "" : "s"} need attention` : "Notifications";
  const activeTabId = `${baseId}-${activeTab}-tab`;
  const panelId = `${baseId}-panel`;

  useEffect(() => {
    // A tab is a new list: never inherit the previous audience's scroll offset.
    if (open) bodyRef.current?.scrollTo({ top: 0 });
  }, [activeTab, open]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const firstRow = menuRef.current?.querySelector<HTMLElement>(".notifications-row");
      const selectedTab = menuRef.current?.querySelector<HTMLElement>('.notifications-tab[aria-selected="true"]');
      const close = menuRef.current?.querySelector<HTMLElement>(".notifications-close");
      // The anchored-menu effect fixes the card only a frame after mount; until
      // then it sits at the document's end, where a plain focus() would scroll
      // the window there. A detached surface never shifts the user's scroll
      // position (design §8.3).
      (firstRow ?? selectedTab ?? close)?.focus({ preventScroll: true });
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
    // The tablist consumes its own arrow keys first; without this guard the
    // bubbling event would also jump into the first row.
    if (event.defaultPrevented) return;
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

  const moveTabFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'));
    if (!tabs.length) return;
    event.preventDefault();
    const current = tabs.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "Home" ? 0
      : event.key === "End" ? tabs.length - 1
        : event.key === "ArrowRight" ? (current + 1) % tabs.length
          : (current - 1 + tabs.length) % tabs.length;
    const nextTab = tabs[next]?.dataset.tab === "admin" ? "admin" : "employee";
    setTab(nextTab);
    tabs[next]?.focus();
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

  const employeeBody = () => <>
    {error && count > 0 && <div className="notifications-notice is-inline" role="status"><span>{error} Showing the last list.</span><button type="button" onClick={onRetry}><RefreshCw size={13} /> Retry</button></div>}
    {reviewCount > 0 && <section className="notifications-section" aria-label="Waiting for your review">
      <span className="notifications-section-title">Waiting for you</span>
      <ul className="notifications-list">
        {memoryCandidates > 0 && reviewReminder("memory")}
        {recap && reviewReminder("recap")}
      </ul>
    </section>}
    {overdueTasks > 0 && <section className="notifications-section" aria-label="Tasks needing attention">
      <span className="notifications-section-title">Needs attention</span>
      <ul className="notifications-list">
        <li>
          <button type="button" className="notifications-row review overdue" onClick={onOpenOverdue}>
            <span className="notifications-lead" aria-hidden="true"><CircleAlert size={16} /></span>
            <span className="notifications-row-main">
              <span className="notifications-row-title">{overdueSummary(overdueTasks)}</span>
              <span className="notifications-row-meta">Unfinished work past its due date</span>
            </span>
            <span className="notifications-row-action">Review</span>
          </button>
        </li>
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
        : !count ? <div className="notifications-empty"><strong>You&apos;re caught up</strong><span>Recaps, memories, overdue tasks, and EODs show up here when they need you.</span></div>
          : null}
  </>;

  const adminBody = () => {
    if (!admin) return null;
    if (!admin.overview && admin.loading) {
      return <ul className="notifications-list" aria-hidden="true">{[0, 1, 2].map((row) => <li key={row} className="notifications-row is-skeleton"><Skeleton className="skeleton-line skeleton-title" /><Skeleton className="skeleton-line skeleton-body" /></li>)}</ul>;
    }
    if (!admin.overview) {
      return <div className="notifications-notice" role="status">
        <span>{admin.error ?? "The workspace record is not available."}</span>
        <button type="button" onClick={admin.onRetry}><RefreshCw size={14} /> Try again</button>
      </div>;
    }
    const decisions = adminNotificationDecisions(admin.overview);
    const pulse = adminNotificationPulse(admin.overview);
    const activity = adminNotificationActivity(admin.overview);
    return <>
      {admin.error && <div className="notifications-notice is-inline" role="status">
        <span>{admin.error} Showing the last workspace record.</span>
        <button type="button" onClick={admin.onRetry}><RefreshCw size={13} /> Retry</button>
      </div>}
      <section className="notifications-section" aria-label="Needs your decision">
        <span className="notifications-section-title">Needs your decision</span>
        {decisions.length ? <ul className="notifications-list">{decisions.map((decision) => <li key={decision.id}>
          <button type="button" className="notifications-row review admin-notification-decision" onClick={() => admin.onNavigate(decision.section, decision.focus)}>
            <span className={`notifications-lead is-${decision.severity}`} aria-hidden="true">{decisionIcon(decision.code)}</span>
            <span className="notifications-row-main">
              <span className="notifications-row-title">{decision.title}</span>
              <span className="notifications-row-meta">{decision.meta}</span>
            </span>
            <span className="notifications-row-action">{decision.action}</span>
          </button>
        </li>)}</ul>
          : <div className="notifications-all-clear"><CheckCircle2 size={15} aria-hidden="true" /><span>No decisions are waiting.</span></div>}
      </section>
      <section className="notifications-section notifications-pulse-section" aria-label="Today across the workspace">
        <span className="notifications-section-title">Today across the workspace</span>
        <div className="notifications-pulse">
          {pulse.map((item) => <span key={item.label}><b>{item.value}</b> {item.label}</span>)}
        </div>
      </section>
      <section className="notifications-section" aria-label="Recent team activity">
        <span className="notifications-section-title">Recent team activity</span>
        {activity.length ? <ul className="notifications-list">{activity.map((item) => <li key={item.id}>
          <button type="button" className="notifications-row admin-notification-activity" onClick={() => admin.onNavigate(item.section, item.focus)}>
            <span className={`notifications-activity-tile is-${item.kind}`} aria-hidden="true">{activityIcon(item.kind)}</span>
            <span className="notifications-row-main">
              <span className="notifications-row-title">{item.title}</span>
              <span className="notifications-row-meta">{item.meta || "Recorded today"}</span>
            </span>
            <span className="notifications-activity-time">{item.time}</span>
          </button>
        </li>)}</ul>
          : <div className="notifications-all-clear"><CheckCircle2 size={15} aria-hidden="true" /><span>No activity has been recorded today yet.</span></div>}
        <div className="notifications-admin-foot">
          <button type="button" onClick={() => admin.onNavigate("overview")}>Open the workspace overview</button>
        </div>
      </section>
    </>;
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
      <div
        className={`notifications-card${activeTab === "admin" ? " is-admin" : ""}`}
        role="dialog"
        aria-label="Notifications"
        ref={menuRef}
        style={style}
        onKeyDown={moveRowFocus}
      >
        <header className={`notifications-head${showTabs ? " has-tabs" : ""}`}>
          {showTabs && <div className="notifications-tabs" role="tablist" aria-label="Notification audience" onKeyDown={moveTabFocus}>
            <button
              type="button"
              role="tab"
              id={`${baseId}-employee-tab`}
              data-tab="employee"
              className="notifications-tab"
              aria-selected={activeTab === "employee"}
              aria-controls={panelId}
              tabIndex={activeTab === "employee" ? 0 : -1}
              onClick={() => setTab("employee")}
            >
              <UserRound size={13} aria-hidden="true" />
              <span>Employee</span>
              {employeeCount > 0 && <em className="notifications-tab-count">{employeeCount > 99 ? "99+" : employeeCount}</em>}
            </button>
            <button
              type="button"
              role="tab"
              id={`${baseId}-admin-tab`}
              data-tab="admin"
              className="notifications-tab"
              aria-selected={activeTab === "admin"}
              aria-controls={panelId}
              tabIndex={activeTab === "admin" ? 0 : -1}
              onClick={() => setTab("admin")}
            >
              <LayoutDashboard size={13} aria-hidden="true" />
              <span>Admin</span>
              {adminCount > 0 && <em className="notifications-tab-count">{adminCount > 99 ? "99+" : adminCount}</em>}
            </button>
          </div>}
          <button type="button" className="icon notifications-close" aria-label="Close notifications" onClick={onClose}><X size={15} /></button>
        </header>
        <div
          className="notifications-body"
          ref={bodyRef}
          id={panelId}
          role={showTabs ? "tabpanel" : undefined}
          aria-labelledby={showTabs ? activeTabId : undefined}
        >
          {activeTab === "admin" ? adminBody() : employeeBody()}
        </div>
      </div>,
    )}
  </>;
}
