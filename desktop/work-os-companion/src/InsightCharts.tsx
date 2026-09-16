import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { DeltaStat, FlowSlice, HeatmapCell, InsightSeriesPoint, UpdateKindSlice } from "./insights";
import { durationLabel, minutesLabel } from "./insights";
import { formatWorkOsDate } from "./dateFormat";

/** Bespoke SVG/CSS chart primitives for the Insights page. Every chart keeps a
 * single evidence class per scale, exposes exact values for assistive tech, and
 * reserves its geometry while loading. */

export function Sparkline({ values, label, className = "" }: { values: number[]; label: string; className?: string }) {
  const width = 104;
  const height = 30;
  const pad = 3;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  const points = (values.length ? values : [0]).map((value, index) => {
    const x = pad + index * step;
    const y = height - pad - (Math.max(0, value) / max) * (height - pad * 2);
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  const line = points.map((point, index) => `${index ? "L" : "M"}${point}`).join(" ");
  const area = `${line} L${(pad + Math.max(0, values.length - 1) * step).toFixed(1)} ${height - pad} L${pad} ${height - pad} Z`;
  return (
    <svg className={`sparkline ${className}`.trim()} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <path className="sparkline-area" d={area} />
      <path className="sparkline-line" d={line} />
    </svg>
  );
}

export function MetricTile({ icon: Icon, label, value, detail, children }: {
  icon: typeof Minus;
  label: string;
  value: string;
  detail?: string;
  children?: React.ReactNode;
}) {
  return (
    <article className="metric insight-metric">
      <Icon size={18} />
      <small>{label}</small>
      <strong>{value}</strong>
      {detail ? <span className="insight-metric-detail">{detail}</span> : null}
      {children}
    </article>
  );
}

export function DeltaBadge({ stat }: { stat: DeltaStat }) {
  const direction = stat.delta === 0 ? "flat" : stat.delta > 0 ? "up" : "down";
  const magnitude = stat.unit === "minutes"
    ? minutesLabel(Math.abs(stat.delta))
    : stat.unit === "hours"
      ? durationLabel(Math.abs(stat.delta) * 3600)
      : String(Math.abs(stat.delta));
  const tone = stat.delta === 0 || stat.goodDirection === null
    ? "neutral"
    : (stat.delta > 0 ? stat.goodDirection : !stat.goodDirection)
      ? "better"
      : "worse";
  const Arrow = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : Minus;
  return (
    <span className={`delta-badge ${tone}`} title={`${stat.label}: ${stat.current} now, ${stat.previous} in the equal earlier period`}>
      <Arrow size={12} aria-hidden />
      <b>{direction === "flat" ? "no change" : `${direction === "up" ? "+" : "−"}${magnitude}`}</b>
      <small>vs earlier period</small>
    </span>
  );
}

export interface TrendTooltipState {
  index: number;
}

export function TrendChart({ points, rangeLabel, showTracked }: { points: InsightSeriesPoint[]; rangeLabel: string; showTracked?: boolean }) {
  const [active, setActive] = useState<TrendTooltipState | null>(null);
  const observedMax = Math.max(1, ...points.map((point) => point.observedMinutes));
  const top = observedMax;
  const completionPoints = points.map((point, index) => ({ index, value: point.completionPercent }));
  const hasCompletion = completionPoints.some((point) => point.value !== null);
  const slots = Math.max(1, points.length);
  const linePath = hasCompletion
    ? completionPoints
      .filter((point): point is { index: number; value: number } => point.value !== null)
      .map((point, position) => `${position ? "L" : "M"}${(((point.index + 0.5) / slots) * 100).toFixed(2)} ${(100 - point.value).toFixed(2)}`)
      .join(" ")
    : "";
  const activePoint = active ? points[active.index] : null;
  const labelStride = points.length <= 12 ? 1 : Math.ceil(points.length / 10);
  return (
    <div className={`trend-chart-wrap${showTracked ? " with-tracked" : ""}`}>
      <div className={`trend-plot${hasCompletion ? "" : " single-scale"}`}>
        <div className="trend-axis" aria-hidden="true">
          <span>{minutesLabel(top)}</span>
          <span>{minutesLabel(top / 2)}</span>
          <span>0m</span>
        </div>
        <div className="trend-canvas" onMouseLeave={() => setActive(null)}>
          <div className="trend-grid" aria-hidden="true"><i /><i /><i /></div>
          {hasCompletion ? (
            <svg className="trend-line-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <path className="trend-line" d={linePath} />
            </svg>
          ) : null}
          <div className="trend-days" role="group" aria-label={`Observed work time and planned-commitment completion by day for ${rangeLabel}`}>
            {points.map((point, index) => {
              const observedPercent = top ? Math.min(100, (point.observedMinutes / top) * 100) : 0;
              const label = `${formatWorkOsDate(point.date)}: ${minutesLabel(point.observedMinutes)} observed, ${point.completionPercent === null ? "no planned commitments" : `${point.completionPercent}% of planned commitments completed`}, ${point.outcomes} outcome${point.outcomes === 1 ? "" : "s"}, ${point.updates} update${point.updates === 1 ? "" : "s"}${point.blocked ? `, ${point.blocked} blocker${point.blocked === 1 ? "" : "s"}` : ""}`;
              const showLabel = index % labelStride === 0 || index === points.length - 1;
              return (
                <div className="trend-day" key={point.date}>
                  <button
                    type="button"
                    className={`trend-bar${active?.index === index ? " active" : ""}`}
                    style={{ height: `${Math.max(observedPercent, point.observedMinutes > 0 ? 3 : 0)}%`, ["--bar-index" as string]: index } as React.CSSProperties}
                    aria-label={label}
                    onMouseEnter={() => setActive({ index })}
                    onFocus={() => setActive({ index })}
                    onBlur={() => setActive(null)}
                  />
                  <span className={`trend-day-label${showLabel ? "" : " sparse"}`}>{showLabel ? point.label : ""}</span>
                </div>
              );
            })}
          </div>
          {activePoint ? (
            <div
              className="chart-tooltip"
              style={{ left: `${((active!.index + 0.5) / slots) * 100}%` } as React.CSSProperties}
              aria-hidden="true"
            >
              <strong>{formatWorkOsDate(activePoint.date)}</strong>
              <span><i className="swatch observed" /> {minutesLabel(activePoint.observedMinutes)} observed</span>
              <span><i className="swatch completion" /> {activePoint.completionPercent === null ? "No planned commitments" : `${activePoint.completionPercent}% of commitments completed`}</span>
              <span>{activePoint.outcomes} outcome{activePoint.outcomes === 1 ? "" : "s"} · {activePoint.updates} update{activePoint.updates === 1 ? "" : "s"}{activePoint.blocked ? ` · ${activePoint.blocked} blocker` : ""}</span>
            </div>
          ) : null}
        </div>
        {hasCompletion ? (
          <div className="trend-axis trend-axis-right" aria-hidden="true">
            <span>100%</span>
            <span>50%</span>
            <span>0%</span>
          </div>
        ) : null}
      </div>
      <div className="trend-legend">
        <span><i /> Observed session time <small>minutes on the left scale</small></span>
        <span><b /> Planned commitments completed <small>0–100% on the same plot height</small></span>
      </div>
      <table className="trend-chart-table">
        <caption>Observed time and planned-commitment completion by day</caption>
        <thead><tr><th scope="col">Day</th><th scope="col">Observed</th><th scope="col">Commitments</th><th scope="col">Outcomes</th><th scope="col">Updates</th></tr></thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.date}>
              <th scope="row">{formatWorkOsDate(point.date)}</th>
              <td>{minutesLabel(point.observedMinutes)}</td>
              <td>{point.completionPercent === null ? "—" : `${point.completionPercent}%`}</td>
              <td>{point.outcomes}</td>
              <td>{point.updates}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const FLOW_TONE: Record<FlowSlice["key"], string> = {
  completed: "slice-completed",
  progressed: "slice-progressed",
  deferred: "slice-deferred",
  carried: "slice-carried",
  unplanned: "slice-unplanned",
};

export function FlowDonut({ slices, ariaLabel }: { slices: FlowSlice[]; ariaLabel: string }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const segments = slices.filter((slice) => slice.value > 0).map((slice) => {
    const fraction = slice.value / total;
    const segment = { slice, dash: fraction * circumference, offset: offset * circumference };
    offset += fraction;
    return segment;
  });
  return (
    <div className="donut-wrap">
      <div className="donut-figure">
        <svg viewBox="0 0 140 140" role="img" aria-label={ariaLabel}>
          <circle className="donut-track" cx="70" cy="70" r={radius} />
          <g transform="rotate(-90 70 70)">
            {segments.map(({ slice, dash, offset: dashOffset }, index) => (
              <circle
                key={slice.key}
                className={`donut-slice ${FLOW_TONE[slice.key]}`}
                cx="70" cy="70" r={radius}
                strokeDasharray={`${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}`}
                strokeDashoffset={-dashOffset}
                style={{ ["--slice-index" as string]: index } as React.CSSProperties}
              >
                <title>{`${slice.label}: ${slice.value}`}</title>
              </circle>
            ))}
          </g>
        </svg>
        <div className="donut-center" aria-hidden="true">
          <strong>{total}</strong>
          <small>records</small>
        </div>
      </div>
      <ul className="donut-legend">
        {slices.map((slice) => (
          <li key={slice.key} className={slice.value === 0 ? "empty" : ""}>
            <i className={FLOW_TONE[slice.key]} aria-hidden />
            <span>{slice.label}</span>
            <b>{slice.value}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BarBreakdown({ rows, ariaLabel }: {
  rows: Array<{ key: string; label: string; value: number; detail?: string; attention?: boolean }>;
  ariaLabel: string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <ul className="bar-breakdown" aria-label={ariaLabel}>
      {rows.map((row, index) => (
        <li key={row.key} className={row.attention ? "attention" : undefined}>
          <span className="bar-label">{row.label}{row.attention ? <em>needs attention</em> : null}</span>
          <span className="bar-track" aria-hidden="true">
            <i style={{ width: `${(row.value / max) * 100}%`, ["--bar-index" as string]: index } as React.CSSProperties} />
          </span>
          <b>{row.value}{row.detail ? <small>{row.detail}</small> : null}</b>
        </li>
      ))}
    </ul>
  );
}

export function OnTimeBar({ onTime, late, percent }: { onTime: number; late: number; percent: number | null }) {
  const total = onTime + late;
  return (
    <div className="on-time">
      <div className="on-time-bar" role="img" aria-label={total ? `${onTime} of ${total} outcomes with a due date landed on time` : "No outcomes with a due date in this range"}>
        {total > 0 ? (
          <>
            <i className="on-time-fill" style={{ width: `${(onTime / total) * 100}%` } as React.CSSProperties} />
            <i className="late-fill" style={{ width: `${(late / total) * 100}%` } as React.CSSProperties} />
          </>
        ) : null}
      </div>
      <div className="on-time-legend">
        <span><i className="swatch on-time" /> {onTime} on time</span>
        <span><i className="swatch late" /> {late} late</span>
        <b>{percent === null ? "No dated outcomes" : `${percent}% on time`}</b>
      </div>
    </div>
  );
}

export function HeatmapGrid({ cells, rangeLabel }: { cells: HeatmapCell[]; rangeLabel: string }) {
  const [active, setActive] = useState<string | null>(null);
  if (!cells.length) return <p className="heatmap-empty">No days recorded in this range.</p>;
  const weeks = Math.max(...cells.map((cell) => cell.weekIndex)) + 1;
  const columns = Array.from({ length: weeks }, (_, week) => cells.filter((cell) => cell.weekIndex === week));
  const activeCell = active ? cells.find((cell) => cell.date === active) : null;
  return (
    <div className="heatmap-wrap" onMouseLeave={() => setActive(null)}>
      <div className="heatmap" role="group" aria-label={`Completed outcomes per day for ${rangeLabel}`}>
        <div className="heatmap-weekdays" aria-hidden="true">
          <span>Mon</span><span /><span>Wed</span><span /><span>Fri</span><span /><span>Sun</span>
        </div>
        {columns.map((column, weekIndex) => (
          <div className="heatmap-week" key={weekIndex}>
            {Array.from({ length: 7 }, (_, weekday) => {
              const cell = column.find((item) => item.weekday === weekday);
              if (!cell) return <span className="heatmap-cell empty" key={weekday} aria-hidden="true" />;
              return (
                <button
                  key={cell.date}
                  type="button"
                  className={`heatmap-cell bucket-${cell.bucket}${active === cell.date ? " active" : ""}`}
                  aria-label={`${formatWorkOsDate(cell.date)}: ${cell.value} completed outcome${cell.value === 1 ? "" : "s"}`}
                  onMouseEnter={() => setActive(cell.date)}
                  onFocus={() => setActive(cell.date)}
                  onBlur={() => setActive(null)}
                />
              );
            })}
          </div>
        ))}
      </div>
      {activeCell ? (
        <p className="heatmap-readout" aria-hidden="true"><strong>{formatWorkOsDate(activeCell.date)}</strong> · {activeCell.value} completed outcome{activeCell.value === 1 ? "" : "s"}</p>
      ) : (
        <p className="heatmap-readout muted">Completed outcomes per day · darker means more completed work</p>
      )}
    </div>
  );
}

export function UpdateKindChart({ slices }: { slices: UpdateKindSlice[] }) {
  return (
    <BarBreakdown
      ariaLabel="Progress updates by kind, including blockers and priority changes"
      rows={slices.map((slice) => ({ key: slice.key, label: slice.label, value: slice.value, attention: slice.attention && slice.value > 0 }))}
    />
  );
}

export function ConsistencyChips({ chips }: { chips: Array<{ key: string; label: string; value: string; detail: string }> }) {
  if (!chips.length) return null;
  return (
    <ul className="consistency-chips">
      {chips.map((chip) => (
        <li key={chip.key}>
          <small>{chip.label}</small>
          <strong>{chip.value}</strong>
          <span>{chip.detail}</span>
        </li>
      ))}
    </ul>
  );
}
