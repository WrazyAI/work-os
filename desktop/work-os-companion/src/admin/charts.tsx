import { useId, useState } from "react";
import { dayLabel, formatMinutes, shortDate } from "./data";
import type { AdminTimeSeriesPoint } from "./types";

/** Hand-rolled charts for the administration workspace.
 *
 * The companion avoids a charting dependency; these are DOM/CSS bars. Every
 * chart keeps its named legend and its visually hidden exact-value list, and
 * adds one keyboard-reachable plot: hovering or focusing a point opens a shared
 * readout that stays inside the plot box (it flips near the edges), arrow keys
 * walk the days and the segments or series inside a day, and a polite live
 * region announces the focused point. Numbers are never hover-only. */

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

/* --- Shared readout ------------------------------------------------------ */

type ReadoutEdge = "start" | "end" | null;

interface ChartReadoutRow {
  /** Swatch color for the hovered series; omitted when the row is a summary. */
  swatch?: string;
  label: string;
  value: string;
}

interface ChartReadoutState {
  /** Column centre as a percentage of the plot box; omitted for row readouts. */
  left?: number;
  edge?: ReadoutEdge;
  /** Width cap that keeps a centred readout inside the plot box. */
  maxWidth?: string;
  /** Row readouts sit above their row unless the row is near the top. */
  align?: "above" | "below";
  title: string;
  rows: ChartReadoutRow[];
  detail?: string;
}

export interface ChartReadoutPlacement {
  left: number;
  edge: ReadoutEdge;
  maxWidth: string;
}

/** Readout geometry: the point's centre inside the plot box. Columns sitting in
 * the outer fifth of the plot pin the readout to that edge; the centred ones
 * get a width cap that keeps both of their edges inside the plot. Either way
 * the readout can never clip at the card or viewport edge. */
export function chartReadoutPlacement(index: number, count: number): ChartReadoutPlacement {
  const last = Math.max(0, count - 1);
  const clamped = Math.min(Math.max(Math.round(index), 0), last);
  const left = count > 1 ? ((clamped + 0.5) / count) * 100 : 50;
  if (left <= 20) return { left: 0, edge: "start", maxWidth: "min(240px, 100%)" };
  if (left >= 80) return { left: 100, edge: "end", maxWidth: "min(240px, 100%)" };
  return { left, edge: null, maxWidth: `min(240px, ${(Math.min(left, 100 - left) * 2).toFixed(2)}%)` };
}

/** The one readout shared by the three chart primitives. It is decorative:
 * aria-hidden, pointer-events: none, and always inside the chart box. The
 * visually hidden exact-value list stays the accessible source of truth. */
function ChartReadout({ readout }: { readout: ChartReadoutState }) {
  const isRow = readout.left === undefined;
  const classes = ["admin-chart-readout"];
  if (isRow) classes.push("is-row");
  if (readout.edge) classes.push(`edge-${readout.edge}`);
  if (readout.align === "below") classes.push("align-below");
  // The trailing pair anchors with `right` rather than `left: 100%`, which
  // would leave the shrink-to-fit box no width to size against.
  const style = isRow || readout.edge === "end"
    ? { right: 0, maxWidth: readout.maxWidth }
    : { left: `${readout.left}%`, maxWidth: readout.maxWidth };
  return (
    <div className={classes.join(" ")} style={style} aria-hidden="true">
      <strong>{readout.title}</strong>
      {readout.rows.map((row, index) => (
        <span key={`${row.label}-${index}`}>
          {row.swatch ? <i style={{ background: row.swatch }} /> : null}
          <span className="admin-chart-readout-label">{row.label}</span>
          <b>{row.value}</b>
        </span>
      ))}
      {readout.detail ? <small>{readout.detail}</small> : null}
    </div>
  );
}

const PLOT_HINT = "Use the arrow keys to review each point; the exact values are listed after the chart.";
const SHARE_HINT = "Use the arrow keys to review each row; every row states its value and share.";

/* --- Stacked daily time -------------------------------------------------- */

/** Stacked daily bars where each segment is one teammate's observed work time.
 * Observed time is activity context, never completion. */
export function StackedTimeBars({ points, ariaLabel, onSelectPerson }: {
  points: AdminTimeSeriesPoint[];
  ariaLabel: string;
  /** Optional drill-down: activating a legend entry opens the caller's person
   * drawer for that teammate. Overview reads the chart without it. */
  onSelectPerson?: (personId: string) => void;
}) {
  const [active, setActive] = useState<{ day: number; personId: string } | null>(null);
  const [legendHover, setLegendHover] = useState<string | null>(null);
  const [legendFocus, setLegendFocus] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const hintId = useId();

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
  const days = points.map((point) => ({
    point,
    segments: [...point.people]
      .filter((person) => person.minutes > 0)
      .sort((left, right) => right.minutes - left.minutes),
  }));
  if (!points.some((point) => point.totalMinutes > 0)) {
    return <p className="admin-empty-note">No observed work time was recorded in this range.</p>;
  }
  const stride = labelStride(points.length);
  const highlight = legendFocus ?? legendHover;
  const activeDay = active && active.day >= 0 && active.day < days.length ? active.day : -1;
  const activePerson = activeDay < 0 ? null : days[activeDay].segments.find((person) => person.personId === active?.personId) ?? null;

  const focusPoint = (day: number, personId?: string) => {
    const segments = day >= 0 && day < days.length ? days[day].segments : [];
    if (!segments.length) return;
    const target = (personId ? segments.find((person) => person.personId === personId) : undefined) ?? segments[0];
    setActive({ day, personId: target.personId });
    setAnnouncement(`${dayLabel(days[day].point.date)}: ${target.name}, ${formatMinutes(target.minutes)} observed.`);
  };
  const edgeDay = (direction: 1 | -1) => {
    if (direction === 1) return days.findIndex((day) => day.segments.length > 0);
    for (let index = days.length - 1; index >= 0; index -= 1) {
      if (days[index].segments.length) return index;
    }
    return -1;
  };
  const neighbourDay = (from: number, direction: 1 | -1) => {
    for (let index = from + direction; index >= 0 && index < days.length; index += direction) {
      if (days[index].segments.length) return index;
    }
    return from;
  };
  const handlePlotKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const key = event.key;
    if (key === "Escape") {
      setActive(null);
      setAnnouncement("");
      setLegendFocus(null);
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(key)) return;
    event.preventDefault();
    if (!days.length) return;
    if (!active) {
      const day = key === "ArrowLeft" || key === "End" ? edgeDay(-1) : edgeDay(1);
      const segments = day < 0 ? [] : days[day].segments;
      const person = key === "ArrowUp" || key === "End" ? segments[segments.length - 1] : segments[0];
      focusPoint(day, person?.personId);
      return;
    }
    const segments = days[active.day].segments;
    const index = Math.max(0, segments.findIndex((person) => person.personId === active.personId));
    if (key === "ArrowRight" || key === "ArrowLeft") {
      // Keep the ordinal position, not the person: walking right lands on the
      // same "slot" of the next recorded day, so the readout moves one step.
      const day = neighbourDay(active.day, key === "ArrowRight" ? 1 : -1);
      const next = days[day].segments;
      focusPoint(day, next[Math.min(index, next.length - 1)]?.personId);
      return;
    }
    if (key === "ArrowUp") {
      focusPoint(active.day, segments[Math.min(index + 1, segments.length - 1)]?.personId);
      return;
    }
    if (key === "ArrowDown") {
      focusPoint(active.day, segments[Math.max(index - 1, 0)]?.personId);
      return;
    }
    if (key === "Home") {
      const day = edgeDay(1);
      focusPoint(day, day < 0 ? undefined : days[day].segments[0]?.personId);
      return;
    }
    const day = edgeDay(-1);
    const segments2 = day < 0 ? [] : days[day].segments;
    focusPoint(day, segments2[segments2.length - 1]?.personId);
  };

  const readout: ChartReadoutState | null = activePerson && activeDay >= 0 ? {
    ...chartReadoutPlacement(activeDay, days.length),
    title: dayLabel(days[activeDay].point.date),
    rows: [{
      swatch: colors.get(activePerson.personId) ?? ADMIN_PALETTE[0],
      label: activePerson.name,
      value: formatMinutes(activePerson.minutes),
    }],
    detail: `${formatMinutes(days[activeDay].point.totalMinutes)} observed that day`,
  } : null;

  return (
    <figure className="admin-chart" onKeyDown={(event) => { if (event.key === "Escape") setLegendFocus(null); }}>
      <div
        className="admin-stack"
        role="group"
        aria-label={ariaLabel}
        aria-describedby={hintId}
        tabIndex={0}
        onKeyDown={handlePlotKeyDown}
        onMouseLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
      >
        {days.map((day, dayIndex) => (
          <div
            className={`admin-stack-col${activeDay === dayIndex ? " is-active" : ""}`}
            key={day.point.date}
            onMouseMove={(event) => {
              if (event.target !== event.currentTarget) return;
              const top = day.segments[0];
              if (!top) return;
              setActive({ day: dayIndex, personId: top.personId });
              setAnnouncement("");
            }}
          >
            {day.segments.map((person) => {
              const isPoint = activeDay === dayIndex && active?.personId === person.personId;
              const classes = [isPoint ? "is-active" : "", highlight ? (highlight === person.personId ? "is-highlighted" : "is-dimmed") : ""];
              return (
                <i
                  key={person.personId}
                  className={classes.filter(Boolean).join(" ")}
                  style={{ height: `${Math.max(1.5, (person.minutes / max) * 100)}%`, background: colors.get(person.personId) ?? ADMIN_PALETTE[0] }}
                  onMouseEnter={() => {
                    setActive({ day: dayIndex, personId: person.personId });
                    setAnnouncement("");
                  }}
                />
              );
            })}
          </div>
        ))}
        {readout ? <ChartReadout key={`${activeDay}-${activePerson?.personId}`} readout={readout} /> : null}
      </div>
      <div className="admin-stack-axis" aria-hidden>
        {points.map((point, index) => <span key={point.date}>{index % stride === 0 ? shortDate(`${point.date}T12:00:00Z`) : ""}</span>)}
      </div>
      {order.length ? (
        <ul className="admin-chart-legend is-interactive" aria-label="Legend: teammate by color" onMouseLeave={() => setLegendHover(null)}>
          {order.map((person) => {
            const pressed = legendFocus === person.personId;
            return (
              <li key={person.personId}>
                <button
                  type="button"
                  className="admin-legend-button"
                  aria-pressed={pressed}
                  onMouseEnter={() => setLegendHover(person.personId)}
                  onMouseLeave={() => setLegendHover((current) => (current === person.personId ? null : current))}
                  onFocus={() => setLegendHover(person.personId)}
                  onBlur={() => setLegendHover((current) => (current === person.personId ? null : current))}
                  onClick={() => {
                    if (pressed) {
                      setLegendFocus(null);
                      return;
                    }
                    setLegendFocus(person.personId);
                    onSelectPerson?.(person.personId);
                  }}
                >
                  <i style={{ background: colors.get(person.personId) }} aria-hidden />
                  {person.name}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <p className="sr-only admin-chart-hint" id={hintId}>{PLOT_HINT}</p>
      <p className="sr-only admin-chart-live" role="status">{announcement}</p>
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

/* --- Grouped daily counts ------------------------------------------------ */

/** Grouped daily bars for a small set of count series. */
export function GroupedBars({ points, series, ariaLabel }: {
  points: Array<{ label: string; values: Record<string, number> }>;
  series: Array<{ key: string; label: string; color: string }>;
  ariaLabel: string;
}) {
  const [active, setActive] = useState<{ day: number; key: string } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const hintId = useId();
  const max = Math.max(1, ...points.flatMap((point) => series.map((entry) => point.values[entry.key] ?? 0)));
  if (!points.length || max <= 1 && points.every((point) => series.every((entry) => !point.values[entry.key]))) {
    return <p className="admin-empty-note">Nothing was recorded in this range yet.</p>;
  }
  const stride = labelStride(points.length);
  const activeDay = active ? Math.min(Math.max(active.day, 0), points.length - 1) : -1;
  const activeSeries = active ? series.find((entry) => entry.key === active.key) ?? series[0] : null;
  const activeValue = activeDay < 0 || !activeSeries ? 0 : points[activeDay].values[activeSeries.key] ?? 0;
  const dayTotal = activeDay < 0 ? 0 : series.reduce((sum, entry) => sum + (points[activeDay].values[entry.key] ?? 0), 0);

  const focusPoint = (day: number, key?: string) => {
    if (day < 0 || day >= points.length || !series.length) return;
    const target = series.find((entry) => entry.key === key) ?? series[0];
    setActive({ day, key: target.key });
    setAnnouncement(`${points[day].label}: ${target.label}, ${points[day].values[target.key] ?? 0}.`);
  };
  const handlePlotKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const key = event.key;
    if (key === "Escape") {
      setActive(null);
      setAnnouncement("");
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(key)) return;
    event.preventDefault();
    if (!points.length || !series.length) return;
    if (!active) {
      focusPoint(key === "ArrowLeft" || key === "End" ? points.length - 1 : 0, key === "ArrowUp" || key === "End" ? series[series.length - 1].key : series[0].key);
      return;
    }
    const index = Math.max(0, series.findIndex((entry) => entry.key === active.key));
    if (key === "ArrowRight") {
      focusPoint(Math.min(active.day + 1, points.length - 1), series[index].key);
      return;
    }
    if (key === "ArrowLeft") {
      focusPoint(Math.max(active.day - 1, 0), series[index].key);
      return;
    }
    if (key === "ArrowUp") {
      focusPoint(active.day, series[Math.min(index + 1, series.length - 1)].key);
      return;
    }
    if (key === "ArrowDown") {
      focusPoint(active.day, series[Math.max(index - 1, 0)].key);
      return;
    }
    if (key === "Home") {
      focusPoint(0, series[0].key);
      return;
    }
    focusPoint(points.length - 1, series[series.length - 1].key);
  };

  const readout = active && activeSeries ? {
    ...chartReadoutPlacement(activeDay, points.length),
    title: points[activeDay].label,
    rows: [{ swatch: activeSeries.color, label: activeSeries.label, value: String(activeValue) }],
    detail: `${dayTotal} recorded that day`,
  } : null;

  return (
    <figure className="admin-chart">
      <div
        className="admin-grouped"
        role="group"
        aria-label={ariaLabel}
        aria-describedby={hintId}
        tabIndex={0}
        onKeyDown={handlePlotKeyDown}
        onMouseLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
      >
        {points.map((point, dayIndex) => (
          <div
            className={`admin-grouped-col${activeDay === dayIndex ? " is-active" : ""}`}
            key={point.label}
            onMouseMove={(event) => {
              if (event.target !== event.currentTarget || !series.length) return;
              setActive({ day: dayIndex, key: series[0].key });
              setAnnouncement("");
            }}
          >
            {series.map((entry) => {
              const value = point.values[entry.key] ?? 0;
              return (
                <i
                  key={entry.key}
                  className={active && activeDay === dayIndex && active.key === entry.key ? "is-active" : undefined}
                  style={{ height: `${Math.max(value > 0 ? 2 : 0, (value / max) * 100)}%`, background: entry.color }}
                  onMouseEnter={() => {
                    setActive({ day: dayIndex, key: entry.key });
                    setAnnouncement("");
                  }}
                />
              );
            })}
          </div>
        ))}
        {readout ? <ChartReadout key={`${activeDay}-${activeSeries?.key}`} readout={readout} /> : null}
      </div>
      <div className="admin-stack-axis" aria-hidden>
        {points.map((point, index) => <span key={point.label}>{index % stride === 0 ? point.label : ""}</span>)}
      </div>
      <ul className="admin-chart-legend" aria-label="Legend">
        {series.map((entry) => (
          <li key={entry.key}><i style={{ background: entry.color }} aria-hidden />{entry.label}</li>
        ))}
      </ul>
      <p className="sr-only admin-chart-hint" id={hintId}>{PLOT_HINT}</p>
      <p className="sr-only admin-chart-live" role="status">{announcement}</p>
      <ul className="sr-only">
        {points.map((point) => (
          <li key={point.label}>{point.label}: {series.map((entry) => `${entry.label} ${point.values[entry.key] ?? 0}`).join(", ")}</li>
        ))}
      </ul>
    </figure>
  );
}

/* --- Horizontal share bars ----------------------------------------------- */

/** Horizontal share bars for a categorical mix (evidence sources, update kinds).
 * Every row already states its value and share; the plot adds one focusable
 * target whose arrow keys walk the rows and whose readout names the hovered or
 * focused one. */
export function ShareBars({ items, ariaLabel }: { items: Array<{ label: string; value: number; note?: string }>; ariaLabel: string }) {
  const [active, setActive] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const hintId = useId();
  const ranked = [...items].sort((left, right) => right.value - left.value);
  const max = Math.max(1, ...ranked.map((item) => item.value));
  const total = ranked.reduce((sum, item) => sum + item.value, 0);
  if (!total) return <p className="admin-empty-note">Nothing to summarise in this range yet.</p>;
  const shareOf = (value: number) => Math.round((value / total) * 100);
  const handleListKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    const key = event.key;
    if (key === "Escape") {
      setActive(null);
      setAnnouncement("");
      return;
    }
    const step = key === "ArrowDown" || key === "ArrowRight" ? 1 : key === "ArrowUp" || key === "ArrowLeft" ? -1 : 0;
    if (!step && key !== "Home" && key !== "End") return;
    event.preventDefault();
    const index = key === "Home" ? 0 : key === "End" ? ranked.length - 1 : Math.min(Math.max((active ?? -1) + step, 0), ranked.length - 1);
    const item = ranked[index];
    if (!item) return;
    setActive(index);
    setAnnouncement(`${item.label}: ${item.value}${item.note ? ` ${item.note}` : ""}, ${shareOf(item.value)}% of this range.`);
  };

  return (
    <figure className="admin-chart admin-chart-share">
      <ul
        className="admin-share"
        aria-label={ariaLabel}
        aria-describedby={hintId}
        tabIndex={0}
        onKeyDown={handleListKeyDown}
        onMouseLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
      >
        {ranked.map((item, index) => {
          const share = shareOf(item.value);
          const isActive = active === index;
          return (
            <li
              key={item.label}
              className={isActive ? "is-active" : undefined}
              onMouseEnter={() => {
                setActive(index);
                setAnnouncement("");
              }}
              onMouseLeave={() => setActive((current) => (current === index ? null : current))}
            >
              <span className="admin-share-label">{item.label}{item.note ? <small>{item.note}</small> : null}</span>
              <span className="admin-share-track" aria-hidden><i style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }} /></span>
              <b>{item.value}<small>{share}%</small></b>
              {isActive ? (
                <ChartReadout readout={{
                  align: index * 2 < ranked.length ? "below" : "above",
                  maxWidth: "min(240px, 100%)",
                  title: item.label,
                  rows: [
                    { label: item.note ? "Tracked time" : "Recorded items", value: `${item.value}${item.note ? ` ${item.note}` : ""}` },
                    { label: "Share of range", value: `${share}%` },
                  ],
                }} />
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="sr-only admin-chart-hint" id={hintId}>{SHARE_HINT}</p>
      <p className="sr-only admin-chart-live" role="status">{announcement}</p>
    </figure>
  );
}
