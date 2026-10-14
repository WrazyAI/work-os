import { dayLabel, formatMinutes, shortDate } from "./data";
import type { AdminTimeSeriesPoint } from "./types";

/** Hand-rolled charts for the administration workspace.
 *
 * The companion avoids a charting dependency; these are DOM/CSS bars with a
 * per-segment browser title, a named legend, and a visually hidden exact-value
 * list so a chart never carries the only copy of a number. */

export const ADMIN_PALETTE = [
  "var(--ink)",
  "#82bd39",
  "#2e617d",
  "#c8845a",
  "#c9b56a",
  "#8b5cf6",
  "#0d9488",
  "#a9ada2",
] as const;

function assignColors(people: Array<{ personId: string; name: string; minutes: number }>) {
  const sorted = [...people].sort((left, right) => right.minutes - left.minutes || left.name.localeCompare(right.name));
  const colors = new Map<string, string>();
  sorted.forEach((person, index) => colors.set(person.personId, ADMIN_PALETTE[index % ADMIN_PALETTE.length]));
  return { colors, order: sorted };
}

function labelStride(count: number) {
  if (count <= 8) return 1;
  return Math.ceil(count / 8);
}

/** Stacked daily bars where each segment is one teammate's observed work time.
 * Observed time is activity context, never completion. */
export function StackedTimeBars({ points, ariaLabel }: { points: AdminTimeSeriesPoint[]; ariaLabel: string }) {
  const totals = new Map<string, { personId: string; name: string; minutes: number }>();
  for (const point of points) {
    for (const person of point.people) {
      const existing = totals.get(person.personId);
      if (existing) existing.minutes += person.minutes;
      else totals.set(person.personId, { personId: person.personId, name: person.name, minutes: person.minutes });
    }
  }
  const { colors, order } = assignColors([...totals.values()].filter((person) => person.minutes > 0));
  const max = Math.max(1, ...points.map((point) => point.totalMinutes));
  if (!points.some((point) => point.totalMinutes > 0)) {
    return <p className="admin-empty-note">No observed work time was recorded in this range.</p>;
  }
  const stride = labelStride(points.length);
  return (
    <figure className="admin-chart">
      <div className="admin-stack" role="img" aria-label={ariaLabel}>
        {points.map((point) => (
          <div className="admin-stack-col" key={point.date} title={`${dayLabel(point.date)} · ${formatMinutes(point.totalMinutes)} observed`}>
            {[...point.people]
              .filter((person) => person.minutes > 0)
              .sort((left, right) => right.minutes - left.minutes)
              .map((person) => (
                <i
                  key={person.personId}
                  style={{ height: `${Math.max(1.5, (person.minutes / max) * 100)}%`, background: colors.get(person.personId) ?? ADMIN_PALETTE[0] }}
                  title={`${person.name}: ${formatMinutes(person.minutes)}`}
                />
              ))}
          </div>
        ))}
      </div>
      <div className="admin-stack-axis" aria-hidden>
        {points.map((point, index) => <span key={point.date}>{index % stride === 0 ? shortDate(`${point.date}T12:00:00Z`) : ""}</span>)}
      </div>
      {order.length ? (
        <ul className="admin-chart-legend" aria-label="Legend: teammate by color">
          {order.map((person) => (
            <li key={person.personId}>
              <i style={{ background: colors.get(person.personId) }} aria-hidden />
              {person.name}
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="sr-only">
        {points.map((point) => (
          <li key={point.date}>
            {dayLabel(point.date)}: {formatMinutes(point.totalMinutes)} observed
            {point.people.filter((person) => person.minutes > 0).map((person) => `, ${person.name} ${formatMinutes(person.minutes)}`).join("")}
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** Grouped daily bars for a small set of count series. */
export function GroupedBars({ points, series, ariaLabel }: {
  points: Array<{ label: string; values: Record<string, number> }>;
  series: Array<{ key: string; label: string; color: string }>;
  ariaLabel: string;
}) {
  const max = Math.max(1, ...points.flatMap((point) => series.map((entry) => point.values[entry.key] ?? 0)));
  if (!points.length || max <= 1 && points.every((point) => series.every((entry) => !point.values[entry.key]))) {
    return <p className="admin-empty-note">Nothing was recorded in this range yet.</p>;
  }
  const stride = labelStride(points.length);
  return (
    <figure className="admin-chart">
      <div className="admin-grouped" role="img" aria-label={ariaLabel}>
        {points.map((point) => (
          <div className="admin-grouped-col" key={point.label} title={point.label}>
            {series.map((entry) => {
              const value = point.values[entry.key] ?? 0;
              return (
                <i
                  key={entry.key}
                  style={{ height: `${Math.max(value > 0 ? 2 : 0, (value / max) * 100)}%`, background: entry.color }}
                  title={`${point.label} · ${entry.label}: ${value}`}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="admin-stack-axis" aria-hidden>
        {points.map((point, index) => <span key={point.label}>{index % stride === 0 ? point.label : ""}</span>)}
      </div>
      <ul className="admin-chart-legend" aria-label="Legend">
        {series.map((entry) => (
          <li key={entry.key}><i style={{ background: entry.color }} aria-hidden />{entry.label}</li>
        ))}
      </ul>
      <ul className="sr-only">
        {points.map((point) => (
          <li key={point.label}>{point.label}: {series.map((entry) => `${entry.label} ${point.values[entry.key] ?? 0}`).join(", ")}</li>
        ))}
      </ul>
    </figure>
  );
}

/** Horizontal share bars for a categorical mix (evidence sources, update kinds). */
export function ShareBars({ items, ariaLabel }: { items: Array<{ label: string; value: number; note?: string }>; ariaLabel: string }) {
  const ranked = [...items].sort((left, right) => right.value - left.value);
  const max = Math.max(1, ...ranked.map((item) => item.value));
  const total = ranked.reduce((sum, item) => sum + item.value, 0);
  if (!total) return <p className="admin-empty-note">Nothing to summarise in this range yet.</p>;
  return (
    <ul className="admin-share" aria-label={ariaLabel}>
      {ranked.map((item) => (
        <li key={item.label}>
          <span className="admin-share-label">{item.label}{item.note ? <small>{item.note}</small> : null}</span>
          <span className="admin-share-track" aria-hidden><i style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }} /></span>
          <b>{item.value}<small>{Math.round((item.value / total) * 100)}%</small></b>
        </li>
      ))}
    </ul>
  );
}
