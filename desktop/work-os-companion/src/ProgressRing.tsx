import type { ReactNode } from "react";

/** Animated SVG progress ring shared by task rows, dashboard cards, the day
 * hero, and the task-detail subtask header (design §10.2, §27.3).
 *
 * The stroke offset transitions, so progress interpolates after a change
 * instead of jumping, and the track/fill are plain strokes rather than a
 * conic-gradient with a paper-colored center mask, so the ring works on any
 * row or card surface. Small rings render a tabular `3/5` beside them; the
 * hero passes center content and a visible label instead. */
export function ProgressRing({
  completed,
  total,
  label,
  size = 20,
  stroke = 2.5,
  trailing = null,
  className = "",
  children,
}: {
  completed: number;
  total: number;
  /** Used in the accessible name: `3 of 5 subtasks, 60%`. */
  label: string;
  size?: number;
  stroke?: number;
  /** Visible label after the ring (hero only; requires children). */
  trailing?: ReactNode;
  className?: string;
  /** Center content for the large ring; when set the fraction is not drawn. */
  children?: ReactNode;
}) {
  const safeTotal = Math.max(0, Math.trunc(total) || 0);
  const safeCompleted = Math.min(safeTotal, Math.max(0, Math.trunc(completed) || 0));
  const progress = safeTotal > 0 ? safeCompleted / safeTotal : 0;
  const radius = Math.max(0, (size - stroke) / 2);
  const circumference = 2 * Math.PI * radius;
  const percentage = Math.round(progress * 100);
  return (
    <span
      className={`progress-ring ${className}`.trim()}
      role="img"
      aria-label={`${safeCompleted} of ${safeTotal} ${label}, ${percentage}%`}
    >
      <span className="progress-ring-visual">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle className="progress-ring-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} />
          <circle
            className="progress-ring-fill"
            cx={size / 2}
            cy={size / 2}
            r={radius}
            strokeWidth={stroke}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progress)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
        {children ? <span className="progress-ring-center" aria-hidden="true">{children}</span> : null}
      </span>
      {children
        ? (trailing ? <em className="progress-ring-label">{trailing}</em> : null)
        : <em className="progress-ring-fraction">{safeCompleted}/{safeTotal}</em>}
    </span>
  );
}
