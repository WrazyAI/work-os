import { createContext, useCallback, useContext, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, Info, X } from "lucide-react";
import { MASCOT } from "./mascot";
import { MascotMark } from "./chat/MascotMark";

export type NotificationTone = "success" | "error" | "warning" | "info";
export type NotificationPersistence = "transient" | "persistent";
/** Identity for the card's leading tile: the agent's own mark for reminders it
 * authors, the tone icon otherwise. */
export type NotificationIcon = "otto";

export type NotificationAction = { label: string; onClick: () => void; kind?: "primary" | "quiet" };
export type NotificationProgress = { value: number | null; max: number; valueText: string };

export type AppNotification = {
  id: string;
  tone: NotificationTone;
  title: string;
  message: string;
  persistence?: NotificationPersistence;
  persistenceKey?: string;
  action?: { label: string; onClick: () => void };
  actions?: NotificationAction[];
  progress?: NotificationProgress;
  /** When set, the leading tile renders the agent mark for reviewer reminders. */
  icon?: NotificationIcon;
  /** Locks the card while work is in flight: no dismiss control. */
  locked?: boolean;
};

type NotificationOptions = { icon?: NotificationIcon };
type NotificationInput = Omit<AppNotification, "id">;
type PersistentOptions = {
  action?: AppNotification["action"];
  actions?: NotificationAction[];
  progress?: NotificationProgress;
  icon?: NotificationIcon;
  locked?: boolean;
};
type NotificationContextValue = {
  notify: (tone: NotificationTone, message: string, title?: string, action?: AppNotification["action"], options?: NotificationOptions) => void;
  success: (message: string, title?: string, action?: AppNotification["action"], options?: NotificationOptions) => void;
  error: (message: string, title?: string, action?: AppNotification["action"], options?: NotificationOptions) => void;
  info: (message: string, title?: string, action?: AppNotification["action"], options?: NotificationOptions) => void;
  persistent: (key: string, message: string, title?: string, tone?: NotificationTone, options?: PersistentOptions) => void;
  clearPersistent: (key: string) => void;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);
const DEFAULT_TITLES: Record<NotificationTone, string> = {
  success: "Done",
  error: "Something went wrong",
  warning: "Needs attention",
  info: "Heads up",
};

function notificationId() {
  return globalThis.crypto?.randomUUID?.() ?? `notification-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function appendNotification(current: AppNotification[], input: NotificationInput, transientMaximum = 4, persistentMaximum = 3): AppNotification[] {
  const persistence = input.persistence ?? "transient";
  const duplicate = persistence === "persistent" && input.persistenceKey
    ? current.find((item) => item.persistence === "persistent" && item.persistenceKey === input.persistenceKey)
    : current.find((item) => (item.persistence ?? "transient") === persistence && item.tone === input.tone && item.title === input.title && item.message === input.message);
  const next = duplicate ? current.filter((item) => item.id !== duplicate.id) : current;
  const item = { ...input, persistence, id: persistence === "persistent" && duplicate ? duplicate.id : notificationId() };
  const transient = [...next.filter((entry) => (entry.persistence ?? "transient") === "transient"), ...(persistence === "transient" ? [item] : [])].slice(-transientMaximum);
  const persistent = [...next.filter((entry) => entry.persistence === "persistent"), ...(persistence === "persistent" ? [item] : [])].slice(-persistentMaximum);
  return [...transient, ...persistent];
}

export function notificationTimeoutMs(tone: NotificationTone) {
  return tone === "error" ? 10_000 : tone === "success" ? 6_000 : 7_000;
}

export function notificationAutoDismissMs(notification: AppNotification) {
  return notification.persistence === "persistent" ? null : notificationTimeoutMs(notification.tone);
}

export function notificationAriaRole(tone: NotificationTone) {
  return tone === "error" ? "alert" : "status";
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const dismiss = useCallback((id: string) => setNotifications((current) => current.filter((item) => item.id !== id)), []);
  const clearPersistent = useCallback((key: string) => setNotifications((current) => current.filter((item) => item.persistenceKey !== key)), []);
  const notify = useCallback((tone: NotificationTone, message: string, title = DEFAULT_TITLES[tone], action?: AppNotification["action"], options?: NotificationOptions) => {
    const cleanMessage = message.trim();
    if (!cleanMessage) return;
    setNotifications((current) => appendNotification(current, { tone, title, message: cleanMessage, action, icon: options?.icon }));
  }, []);
  const persistent = useCallback((key: string, message: string, title = "Needs attention", tone: NotificationTone = "info", options?: PersistentOptions) => {
    const cleanKey = key.trim();
    const cleanMessage = message.trim();
    if (!cleanKey || !cleanMessage) return;
    setNotifications((current) => appendNotification(current, {
      tone,
      title,
      message: cleanMessage,
      action: options?.action,
      actions: options?.actions,
      progress: options?.progress,
      icon: options?.icon,
      locked: options?.locked,
      persistence: "persistent",
      persistenceKey: cleanKey,
    }));
  }, []);
  const value = useMemo<NotificationContextValue>(() => ({
    notify,
    success: (message, title, action, options) => notify("success", message, title, action, options),
    error: (message, title, action, options) => notify("error", message, title, action, options),
    info: (message, title, action, options) => notify("info", message, title, action, options),
    persistent,
    clearPersistent,
  }), [clearPersistent, notify, persistent]);

  useEffect(() => {
    const onError = (event: ErrorEvent) => notify("error", event.error instanceof Error ? event.error.message : event.message || "An unexpected application error occurred.");
    const onRejection = (event: PromiseRejectionEvent) => notify("error", event.reason instanceof Error ? event.reason.message : typeof event.reason === "string" ? event.reason : "An unexpected operation failed.");
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [notify]);

  return <NotificationContext.Provider value={value}>{children}<NotificationFlyouts notifications={notifications} onDismiss={dismiss} /></NotificationContext.Provider>;
}

export function useNotifications() {
  const value = useContext(NotificationContext);
  if (!value) throw new Error("useNotifications must be used inside NotificationProvider");
  return value;
}

/** The in-flow slot the employee and administration shells render under their
 * mastheads. Standing conditions (a stale record, a setup blocker) belong in
 * the page's reading order; only transient receipts keep the floating stack
 * design.md §16.1 pins to the top-right corner. */
export const NOTIFICATION_REGION_ID = "work-os-notification-region";

export function NotificationFlyouts({ notifications, onDismiss }: { notifications: AppNotification[]; onDismiss: (id: string) => void }) {
  const [region, setRegion] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const locate = () => {
      const next = document.getElementById(NOTIFICATION_REGION_ID);
      setRegion((current) => (current === next ? current : next));
    };
    locate();
    // The shell can mount after the notification exists (boot, workspace
    // switch), so watch the tree instead of sampling once.
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  const transient = notifications.filter((notification) => (notification.persistence ?? "transient") === "transient");
  const persistent = notifications.filter((notification) => notification.persistence === "persistent");
  const cards = (items: AppNotification[]) => items.map((notification) => <NotificationCard key={notification.id} notification={notification} onDismiss={onDismiss} />);
  const fixedHasPersistent = !region && persistent.length > 0;
  return <>
    <section className={`notification-flyouts${fixedHasPersistent ? " has-persistent" : ""}`} aria-label="Application notifications">
      {cards(transient)}
      {!region ? cards(persistent) : null}
    </section>
    {region && persistent.length ? createPortal(
      <section className="notification-region-list" aria-label="Workspace notices">{cards(persistent)}</section>,
      region,
    ) : null}
  </>;
}

function NotificationCard({ notification, onDismiss }: { notification: AppNotification; onDismiss: (id: string) => void }) {
  const duration = notificationAutoDismissMs(notification);
  useEffect(() => {
    if (duration === null) return;
    const timer = window.setTimeout(() => onDismiss(notification.id), duration);
    return () => window.clearTimeout(timer);
  }, [duration, notification.id, onDismiss]);
    const Icon = notification.tone === "success" ? Check : notification.tone === "error" || notification.tone === "warning" ? AlertTriangle : Info;
  const actions = notification.actions ?? (notification.action ? [{ ...notification.action, kind: "primary" as const }] : []);
  const progress = notification.progress;
  const progressPercent = progress && progress.value !== null && progress.max > 0 ? Math.max(0, Math.min(100, Math.round((progress.value / progress.max) * 100))) : null;
  return <div
    className={`notification-flyout ${notification.tone} ${notification.persistence ?? "transient"}${notification.locked ? " locked" : ""}`}
    role={notificationAriaRole(notification.tone)}
    aria-atomic="true"
    style={duration === null ? undefined : { "--notification-duration": `${duration}ms` } as CSSProperties}
  >
    <span className={`notification-icon${notification.icon === "otto" ? " is-mascot" : ""}`}>{notification.icon === "otto" ? <MascotMark className="notification-mascot" /> : <Icon size={15} />}</span>
    <div>
      <strong>{notification.title}</strong>
      <p>{notification.message}</p>
      {progress && progressPercent !== null && <div
        className="notification-progress"
        role="progressbar"
        aria-label="Download progress"
        aria-valuemin={0}
        aria-valuemax={progress.max}
        aria-valuenow={progress.value ?? undefined}
        aria-valuetext={progress.valueText}
      ><i style={{ width: `${progressPercent}%` }} /></div>}
      {actions.length > 0 && <div className="notification-actions">{actions.map((entry, index) => <button
        key={`${entry.label}-${index}`}
        className={`notification-action${entry.kind === "quiet" ? " quiet" : ""}`}
        type="button"
        onClick={entry.onClick}
      >{entry.label}</button>)}</div>}
    </div>
    {!notification.locked && <button className="notification-dismiss" type="button" aria-label={`Dismiss ${notification.title}`} onClick={() => onDismiss(notification.id)}><X size={14} /></button>}
    {notification.persistence !== "persistent" && <i aria-hidden="true" />}
  </div>;
}
