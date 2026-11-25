import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AlertTriangle, Check, Info, X } from "lucide-react";
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

/** Optional form for shared surfaces that are also rendered in isolated
 * previews/tests without the app-level provider. Production always has one. */
export function useNotificationsOrNull() {
  return useContext(NotificationContext);
}

export function useNotifications() {
  const value = useContext(NotificationContext);
  if (!value) throw new Error("useNotifications must be used inside NotificationProvider");
  return value;
}

const STACK_GAP_PX = 8;
const STACK_PEEK_PX = 10;
const STACK_MAX_VISIBLE_BEHIND = 2;

/** Orders notifications front-to-back for the floating stack: newest transient
 * receipts sit at the front so fresh feedback is immediately visible, followed
 * by newest persistent notices stacked cleanly behind them. */
export function orderNotificationStack(notifications: AppNotification[]): AppNotification[] {
  const transient = notifications.filter((notification) => (notification.persistence ?? "transient") === "transient").reverse();
  const persistent = notifications.filter((notification) => notification.persistence === "persistent").reverse();
  return [...transient, ...persistent];
}

function measureCardNaturalHeight(card: HTMLElement): number {
  const prevTransition = card.style.transition;
  const prevHeight = card.style.height;
  card.style.transition = "none";
  card.style.height = "auto";
  const measured = Math.ceil(card.getBoundingClientRect().height);
  card.style.height = prevHeight;
  card.style.transition = prevTransition;
  return measured;
}

export function NotificationFlyouts({ notifications, onDismiss }: { notifications: AppNotification[]; onDismiss: (id: string) => void }) {
  const ordered = useMemo(() => orderNotificationStack(notifications), [notifications]);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const stackRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const stacked = ordered.length > 1;
  const expanded = stacked && (hovered || focused);
  const paused = ordered.length > 0 && (hovered || focused);

  useEffect(() => {
    if (ordered.length === 0) {
      setHovered(false);
      setFocused(false);
    }
  }, [ordered.length]);

  // Keyboard users tab into a collapsed deck, which then fans out; a control that
  // lands below a short viewport must scroll into reach once the cards settle.
  useEffect(() => {
    if (!expanded || !focused || typeof window === "undefined") return;
    const timer = window.setTimeout(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && stackRef.current?.contains(active)) active.scrollIntoView({ block: "nearest" });
    }, 240);
    return () => window.clearTimeout(timer);
  }, [expanded, focused]);

  const measureAll = useCallback(() => {
    if (typeof window === "undefined") return;
    const next: Record<string, number> = {};
    for (const item of ordered) {
      const node = cardRefs.current.get(item.id);
      if (!node) continue;
      const h = measureCardNaturalHeight(node);
      if (h > 0) next[item.id] = h;
    }
    setHeights((current) => {
      const keys = Object.keys(next);
      if (keys.length === Object.keys(current).length && keys.every((key) => current[key] === next[key])) return current;
      return next;
    });
  }, [ordered]);

  useLayoutEffect(() => {
    measureAll();
  }, [measureAll]);

  useEffect(() => {
    const container = stackRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    let lastWidth = Math.round(container.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const width = Math.round(entries[0]?.contentRect.width ?? lastWidth);
      if (width !== lastWidth) {
        lastWidth = width;
        measureAll();
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [measureAll, ordered.length]);

  const registerCard = useCallback((id: string, node: HTMLDivElement | null) => {
    if (node) cardRefs.current.set(id, node);
    else cardRefs.current.delete(id);
  }, []);

  const handleDismiss = useCallback((id: string) => {
    const focusInside = typeof document !== "undefined" && stackRef.current?.contains(document.activeElement);
    const index = ordered.findIndex((item) => item.id === id);
    const nextId = index >= 0 ? (ordered[index + 1]?.id ?? ordered[index - 1]?.id ?? null) : null;
    onDismiss(id);
    if (focusInside && nextId && typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        const nextNode = cardRefs.current.get(nextId);
        nextNode?.querySelector<HTMLElement>("button")?.focus();
      });
    }
  }, [onDismiss, ordered]);

  const measured = ordered.length > 0 && ordered.every((item) => (heights[item.id] ?? 0) > 0);
  const frontHeight = ordered[0] ? (heights[ordered[0].id] ?? 0) : 0;
  const offsets: number[] = [];
  let expandedHeight = 0;
  for (let index = 0; index < ordered.length; index += 1) {
    offsets.push(expandedHeight);
    expandedHeight += (heights[ordered[index]!.id] ?? 0) + (index < ordered.length - 1 ? STACK_GAP_PX : 0);
  }
  const collapsedHeight = frontHeight + Math.min(Math.max(ordered.length - 1, 0), STACK_MAX_VISIBLE_BEHIND) * STACK_PEEK_PX;
  const stackStyle = stacked && measured
    ? ({
        "--stack-height": `${expanded ? expandedHeight : collapsedHeight}px`,
        "--front-height": `${frontHeight}px`,
      } as CSSProperties)
    : undefined;

  return (
    <section
      className="notification-flyouts"
      aria-label="Application notifications"
      data-stacked={stacked ? "true" : "false"}
      data-expanded={expanded ? "true" : "false"}
      data-measured={measured ? "true" : "false"}
      data-paused={paused ? "true" : "false"}
    >
      {ordered.length > 0 && (
        <div
          ref={stackRef}
          className="notification-stack"
          style={stackStyle}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onFocus={() => setFocused(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && expanded) {
              setHovered(false);
              setFocused(false);
              (document.activeElement as HTMLElement | null)?.blur?.();
            }
          }}
        >
          {ordered.map((notification, index) => (
            <NotificationCard
              key={notification.id}
              notification={notification}
              index={index}
              total={ordered.length}
              offset={offsets[index] ?? 0}
              cardHeight={heights[notification.id]}
              paused={paused}
              onRegister={registerCard}
              onDismiss={handleDismiss}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function NotificationCard({
  notification,
  index,
  total,
  offset,
  cardHeight,
  paused,
  onRegister,
  onDismiss,
}: {
  notification: AppNotification;
  index: number;
  total: number;
  offset: number;
  cardHeight?: number;
  paused: boolean;
  onRegister: (id: string, node: HTMLDivElement | null) => void;
  onDismiss: (id: string) => void;
}) {
  const duration = notificationAutoDismissMs(notification);
  const remainingRef = useRef<number | null>(duration);
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    remainingRef.current = duration;
  }, [duration, notification.id]);

  useEffect(() => {
    if (duration === null) return;
    if (paused) {
      if (startedAtRef.current !== null && remainingRef.current !== null) {
        remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAtRef.current));
        startedAtRef.current = null;
      }
      return;
    }
    const wait = remainingRef.current ?? duration;
    if (wait <= 0) {
      onDismiss(notification.id);
      return;
    }
    startedAtRef.current = Date.now();
    const timer = window.setTimeout(() => onDismiss(notification.id), wait);
    return () => {
      window.clearTimeout(timer);
      if (startedAtRef.current !== null && remainingRef.current !== null) {
        remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAtRef.current));
        startedAtRef.current = null;
      }
    };
  }, [duration, notification.id, onDismiss, paused]);

  const Icon = notification.tone === "success" ? Check : notification.tone === "error" || notification.tone === "warning" ? AlertTriangle : Info;
  const actions = notification.actions ?? (notification.action ? [{ ...notification.action, kind: "primary" as const }] : []);
  const progress = notification.progress;
  const progressPercent = progress && progress.value !== null && progress.max > 0 ? Math.max(0, Math.min(100, Math.round((progress.value / progress.max) * 100))) : null;
  const cardStyle: CSSProperties = {
    ...(duration === null ? {} : { "--notification-duration": `${duration}ms` }),
    ...(cardHeight ? { "--card-height": `${cardHeight}px`, "--stack-offset": `${offset}px` } : {}),
    zIndex: total - index,
  } as CSSProperties;

  return <div
    ref={(node) => onRegister(notification.id, node)}
    className={`notification-flyout ${notification.tone} ${notification.persistence ?? "transient"}${notification.locked ? " locked" : ""}`}
    role={notificationAriaRole(notification.tone)}
    aria-atomic="true"
    data-stack-index={index}
    data-stack-behind={index > STACK_MAX_VISIBLE_BEHIND ? "hidden" : undefined}
    style={cardStyle}
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
      {actions.length > 0 && <div className="notification-actions">{actions.map((entry, actionIndex) => <button
        key={`${entry.label}-${actionIndex}`}
        className={`notification-action${entry.kind === "quiet" ? " quiet" : ""}`}
        type="button"
        onClick={entry.onClick}
      >{entry.label}</button>)}</div>}
    </div>
    {!notification.locked && <button className="notification-dismiss" type="button" aria-label={`Dismiss ${notification.title}`} onClick={() => onDismiss(notification.id)}><X size={14} /></button>}
    {notification.persistence !== "persistent" && <i aria-hidden="true" />}
  </div>;
}
