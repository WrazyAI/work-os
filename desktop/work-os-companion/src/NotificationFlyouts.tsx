import { createContext, useCallback, useContext, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { AlertTriangle, Check, Info, X } from "lucide-react";

export type NotificationTone = "success" | "error" | "info";

export type AppNotification = {
  id: string;
  tone: NotificationTone;
  title: string;
  message: string;
  action?: { label: string; onClick: () => void };
};

type NotificationInput = Omit<AppNotification, "id">;
type NotificationContextValue = {
  notify: (tone: NotificationTone, message: string, title?: string, action?: AppNotification["action"]) => void;
  success: (message: string, title?: string, action?: AppNotification["action"]) => void;
  error: (message: string, title?: string, action?: AppNotification["action"]) => void;
  info: (message: string, title?: string, action?: AppNotification["action"]) => void;
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

export function appendNotification(current: AppNotification[], input: NotificationInput, maximum = 4): AppNotification[] {
  const duplicate = current.find((item) => item.tone === input.tone && item.title === input.title && item.message === input.message);
  const next = duplicate ? current.filter((item) => item.id !== duplicate.id) : current;
  return [...next, { ...input, id: notificationId() }].slice(-maximum);
}

export function notificationTimeoutMs(tone: NotificationTone) {
  return tone === "error" ? 10_000 : tone === "success" ? 6_000 : 7_000;
}

export function notificationAriaRole(tone: NotificationTone) {
  return tone === "error" ? "alert" : "status";
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const dismiss = useCallback((id: string) => setNotifications((current) => current.filter((item) => item.id !== id)), []);
  const notify = useCallback((tone: NotificationTone, message: string, title = DEFAULT_TITLES[tone], action?: AppNotification["action"]) => {
    const cleanMessage = message.trim();
    if (!cleanMessage) return;
    setNotifications((current) => appendNotification(current, { tone, title, message: cleanMessage, action }));
  }, []);
  const value = useMemo<NotificationContextValue>(() => ({
    notify,
    success: (message, title, action) => notify("success", message, title, action),
    error: (message, title, action) => notify("error", message, title, action),
    info: (message, title, action) => notify("info", message, title, action),
  }), [notify]);

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
  const duration = notificationTimeoutMs(notification.tone);
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(notification.id), duration);
    return () => window.clearTimeout(timer);
  }, [duration, notification.id, onDismiss]);
  const Icon = notification.tone === "success" ? Check : notification.tone === "error" ? AlertTriangle : Info;
  return <article
    className={`notification-flyout ${notification.tone}`}
    role={notificationAriaRole(notification.tone)}
    aria-atomic="true"
    style={{ "--notification-duration": `${duration}ms` } as CSSProperties}
  >
    <span className="notification-icon"><Icon size={18} /></span>
    <div><strong>{notification.title}</strong><p>{notification.message}</p>{notification.action && <button className="notification-action" type="button" onClick={notification.action.onClick}>{notification.action.label}</button>}</div>
    <button className="notification-dismiss" type="button" aria-label={`Dismiss ${notification.title}`} onClick={() => onDismiss(notification.id)}><X size={16} /></button>
    <i aria-hidden="true" />
  </article>;
}
