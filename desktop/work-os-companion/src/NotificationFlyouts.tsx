import { createContext, useCallback, useContext, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { AlertTriangle, Check, Info, Pin, X } from "lucide-react";

export type NotificationTone = "success" | "error" | "warning" | "info";
export type NotificationPersistence = "transient" | "persistent";

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
  /** Locks the card while work is in flight: no dismiss control. */
  locked?: boolean;
};

type NotificationInput = Omit<AppNotification, "id">;
type PersistentOptions = {
  action?: AppNotification["action"];
  actions?: NotificationAction[];
  progress?: NotificationProgress;
  locked?: boolean;
};
type NotificationContextValue = {
  notify: (tone: NotificationTone, message: string, title?: string, action?: AppNotification["action"]) => void;
  success: (message: string, title?: string, action?: AppNotification["action"]) => void;
  error: (message: string, title?: string, action?: AppNotification["action"]) => void;
  info: (message: string, title?: string, action?: AppNotification["action"]) => void;
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
  const notify = useCallback((tone: NotificationTone, message: string, title = DEFAULT_TITLES[tone], action?: AppNotification["action"]) => {
    const cleanMessage = message.trim();
    if (!cleanMessage) return;
    setNotifications((current) => appendNotification(current, { tone, title, message: cleanMessage, action }));
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
      locked: options?.locked,
      persistence: "persistent",
      persistenceKey: cleanKey,
    }));
  }, []);
  const value = useMemo<NotificationContextValue>(() => ({
    notify,
    success: (message, title, action) => notify("success", message, title, action),
    error: (message, title, action) => notify("error", message, title, action),
    info: (message, title, action) => notify("info", message, title, action),
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

export function NotificationFlyouts({ notifications, onDismiss }: { notifications: AppNotification[]; onDismiss: (id: string) => void }) {
  return <section className="notification-flyouts" aria-label="Application notifications">
    {notifications.map((notification) => <NotificationCard key={notification.id} notification={notification} onDismiss={onDismiss} />)}
  </section>;
}

function NotificationCard({ notification, onDismiss }: { notification: AppNotification; onDismiss: (id: string) => void }) {
  const duration = notificationAutoDismissMs(notification);
  useEffect(() => {
    if (duration === null) return;
    const timer = window.setTimeout(() => onDismiss(notification.id), duration);
    return () => window.clearTimeout(timer);
  }, [duration, notification.id, onDismiss]);
    const Icon = notification.persistence === "persistent" ? Pin : notification.tone === "success" ? Check : notification.tone === "error" || notification.tone === "warning" ? AlertTriangle : Info;
  const actions = notification.actions ?? (notification.action ? [{ ...notification.action, kind: "primary" as const }] : []);
  const progress = notification.progress;
  const progressPercent = progress && progress.value !== null && progress.max > 0 ? Math.max(0, Math.min(100, Math.round((progress.value / progress.max) * 100))) : null;
  return <article
    className={`notification-flyout ${notification.tone} ${notification.persistence ?? "transient"}${notification.locked ? " locked" : ""}`}
    role={notificationAriaRole(notification.tone)}
    aria-atomic="true"
    style={duration === null ? undefined : { "--notification-duration": `${duration}ms` } as CSSProperties}
  >
    <span className="notification-icon"><Icon size={18} /></span>
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
    {!notification.locked && <button className="notification-dismiss" type="button" aria-label={`Dismiss ${notification.title}`} onClick={() => onDismiss(notification.id)}><X size={16} /></button>}
    {notification.persistence !== "persistent" && <i aria-hidden="true" />}
  </article>;
}
