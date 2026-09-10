import { useId, type CSSProperties } from "react";

/* Loading language for the desktop companion.
 * Wave: major waits (launch, gate, long drafting).
 * FadeArc: minor inline waits (buttons, refresh, small fetches).
 * Skeleton: content-shaped placeholders for lists and dashboards. */

const WAVE_BAR_HEIGHTS = ["50%", "75%", "100%", "75%", "50%"] as const;

export function Wave({ className, ...props }: React.ComponentProps<"span">) {
  return <span role="status" className={`loading-wave${className ? ` ${className}` : ""}`} {...props}>
    {WAVE_BAR_HEIGHTS.map((height, index) => <span key={index} aria-hidden="true" className="loading-wave-bar" style={{ height, animationDelay: `calc(var(--delay, 100ms) * ${index})` }} />)}
    <span className="sr-only">Loading</span>
  </span>;
}

export function FadeArc({ className, size = 16, style, ...props }: React.ComponentProps<"svg"> & { size?: number }) {
  const baseId = useId().replace(/:/g, "");
  const leadingGradientId = `${baseId}-leading`;
  const trailingGradientId = `${baseId}-trailing`;
  return <svg
    viewBox="0 0 24 24"
    fill="none"
    width={size}
    height={size}
    role="status"
    aria-label="Loading"
    className={`loading-arc${className ? ` ${className}` : ""}`}
    style={{
      animationName: "loading-ui-fade-arc-spin",
      animationDuration: "var(--duration, 1s)",
      animationTimingFunction: "linear",
      animationIterationCount: "infinite",
      ...style,
    }}
    {...props}
  >
    <defs>
      <linearGradient id={leadingGradientId} x1="50%" x2="50%" y1="5.271%" y2="91.793%">
        <stop offset="0%" stopColor="currentColor" />
        <stop offset="100%" stopColor="currentColor" stopOpacity="0.55" />
      </linearGradient>
      <linearGradient id={trailingGradientId} x1="50%" x2="50%" y1="15.24%" y2="87.15%">
        <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
        <stop offset="100%" stopColor="currentColor" stopOpacity="0.55" />
      </linearGradient>
    </defs>
    <g fill="none">
      <path
        d="M8.749.021a1.5 1.5 0 0 1 .497 2.958A7.5 7.5 0 0 0 3 10.375a7.5 7.5 0 0 0 7.5 7.5v3c-5.799 0-10.5-4.7-10.5-10.5C0 5.23 3.726.865 8.749.021"
        fill={`url(#${leadingGradientId})`}
        transform="translate(1.5 1.625)"
      />
      <path
        d="M15.392 2.673a1.5 1.5 0 0 1 2.119-.115A10.48 10.48 0 0 1 21 10.375c0 5.8-4.701 10.5-10.5 10.5v-3a7.5 7.5 0 0 0 5.007-13.084a1.5 1.5 0 0 1-.115-2.118"
        fill={`url(#${trailingGradientId})`}
        transform="translate(1.5 1.625)"
      />
    </g>
  </svg>;
}

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden="true" className={`skeleton${className ? ` ${className}` : ""}`} style={style} />;
}

/** Whole-dashboard placeholder shown while the first day payload is in flight. */
export function DashboardSkeleton() {
  return <main className="page dashboard-skeleton" aria-busy="true" aria-label="Loading your workday">
    <div className="skeleton-grid">
      <div className="skeleton-block skeleton-hero">
        <Skeleton className="skeleton-line skeleton-kicker" />
        <Skeleton className="skeleton-line skeleton-title" />
        <Skeleton className="skeleton-line skeleton-body" />
        <Skeleton className="skeleton-line skeleton-button" />
      </div>
      <div className="skeleton-block skeleton-pulse">
        <Skeleton className="skeleton-line skeleton-kicker" />
        <Skeleton className="skeleton-line skeleton-title" />
        <Skeleton className="skeleton-line skeleton-body" />
      </div>
    </div>
    <div className="skeleton-kpi-row">
      {Array.from({ length: 4 }, (_, index) => <div className="skeleton-block skeleton-kpi" key={index}>
        <Skeleton className="skeleton-line skeleton-kicker" />
        <Skeleton className="skeleton-line skeleton-value" />
        <Skeleton className="skeleton-line skeleton-meta" />
      </div>)}
    </div>
    <div className="skeleton-block skeleton-tasks">
      <Skeleton className="skeleton-line skeleton-kicker" />
      <div className="skeleton-card-row">
        {Array.from({ length: 3 }, (_, index) => <div className="skeleton-card" key={index}>
          <Skeleton className="skeleton-line skeleton-chip" />
          <Skeleton className="skeleton-line skeleton-body" />
          <Skeleton className="skeleton-line skeleton-meta" />
          <Skeleton className="skeleton-line skeleton-ticks" />
        </div>)}
      </div>
    </div>
  </main>;
}

/** Placeholder rows for the Tasks workspace while its history loads. */
export function TaskListSkeleton({ rows = 5 }: { rows?: number }) {
  return <div className="skeleton-task-list" aria-busy="true" aria-label="Loading tasks">
    {Array.from({ length: rows }, (_, index) => <div className="skeleton-task-row" key={index}>
      <Skeleton className="skeleton-check" />
      <div className="skeleton-task-copy">
        <Skeleton className="skeleton-line skeleton-task-title" style={{ width: `${58 + ((index * 13) % 30)}%` }} />
        <Skeleton className="skeleton-line skeleton-task-meta" style={{ width: `${34 + ((index * 9) % 22)}%` }} />
      </div>
      <Skeleton className="skeleton-pill" />
    </div>)}
  </div>;
}

export function TaskDetailSkeleton() {
  return <div className="skeleton-detail" aria-busy="true" aria-label="Loading task details">
    <Skeleton className="skeleton-line skeleton-title" />
    <Skeleton className="skeleton-line skeleton-body" />
    <Skeleton className="skeleton-line skeleton-body short" />
    <div className="skeleton-subtask-rows">
      {Array.from({ length: 3 }, (_, index) => <div className="skeleton-subtask-row" key={index}>
        <Skeleton className="skeleton-check" />
        <Skeleton className="skeleton-line skeleton-task-title" style={{ width: `${52 + ((index * 17) % 34)}%` }} />
      </div>)}
    </div>
  </div>;
}

export function InsightsSkeleton() {
  return <div className="skeleton-insights" aria-busy="true" aria-label="Building your work record">
    <div className="skeleton-kpi-row">
      {Array.from({ length: 3 }, (_, index) => <div className="skeleton-block skeleton-kpi" key={index}>
        <Skeleton className="skeleton-line skeleton-kicker" />
        <Skeleton className="skeleton-line skeleton-value" />
      </div>)}
    </div>
    <div className="skeleton-block skeleton-chart">
      <Skeleton className="skeleton-line skeleton-kicker" />
      <div className="skeleton-bars">{Array.from({ length: 7 }, (_, index) => <Skeleton className="skeleton-bar" key={index} style={{ height: `${34 + ((index * 23) % 56)}%` }} />)}</div>
    </div>
  </div>;
}
