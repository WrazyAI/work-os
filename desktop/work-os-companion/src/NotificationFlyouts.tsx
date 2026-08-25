import { createContext, useCallback, useContext, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { AlertTriangle, Check, Info, Pin, X } from "lucide-react";

export type NotificationTone = "success" | "error" | "info";
export type NotificationPersistence = "transient" | "persistent";

export type AppNotification = {
  id: string;
  tone: NotificationTone;
  title: string;
  message: string;
  persistence?: NotificationPersistence;
  persistenceKey?: string;
  action?: { label: string; onClick: () => void };
};

type NotificationInput = Omit<AppNotification, "id">;
type NotificationContextValue = {
  notify: (tone: NotificationTone, message: string, title?: string, action?: AppNotification["action"]) => void;
  success: (message: string, title?: string, action?: AppNotification["action"]) => void;
  error: (message: string, title?: string, action?: AppNotification["action"]) => void;
  info: (message: string, title?: string, action?: AppNotification["action"]) => void;
  persistent: (key: string, message: string, title?: string, tone?: NotificationTone, action?: AppNotification["action"]) => void;
  clearPersistent: (key: string) => void;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);
const DEFAULT_TITLES: Record<NotificationTone, string> = {
  success: "Done",
  error: "Something went wrong",
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
  const persistent = useCallback((key: string, message: string, title = "Needs attention", tone: NotificationTone = "info", action?: AppNotification["action"]) => {
    const cleanKey = key.trim();
    const cleanMessage = message.trim();
    if (!cleanKey || !cleanMessage) return;
    setNotifications((current) => appendNotification(current, { tone, title, message: cleanMessage, action, persistence: "persistent", persistenceKey: cleanKey }));
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
  const Icon = notification.persistence === "persistent" ? Pin : notification.tone === "success" ? Check : notification.tone === "error" ? AlertTriangle : Info;
  return <article
    className={`notification-flyout ${notification.tone} ${notification.persistence ?? "transient"}`}
    role={notificationAriaRole(notification.tone)}
    aria-atomic="true"
    style={duration === null ? undefined : { "--notification-duration": `${duration}ms` } as CSSProperties}
  >
    <span className="notification-icon"><Icon size={18} /></span>
    <div><strong>{notification.title}</strong><p>{notification.message}</p>{notification.action && <button className="notification-action" type="button" onClick={notification.action.onClick}>{notification.action.label}</button>}</div>
    <button className="notification-dismiss" type="button" aria-label={`Dismiss ${notification.title}`} onClick={() => onDismiss(notification.id)}><X size={16} /></button>
    {notification.persistence !== "persistent" && <i aria-hidden="true" />}
  </article>;
}
