import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { DeltaStat, FlowKey, FlowSlice, HeatmapCell, InsightSeriesPoint, UpdateKindSlice } from "./insights";
import { durationLabel, heatmapColumns, minutesLabel, sharePercent, trendAxis, trendLineSegments, trendSummary } from "./insights";
import { edgeClasses, useScrollEdges } from "./ScrollFadeRegion";
import { formatWorkOsDate } from "./dateFormat";

/** Bespoke SVG/CSS chart primitives for the Insights page. Every chart keeps a
 * single evidence class per scale, exposes exact values for assistive tech, and
 * reserves its geometry while loading. Charts never scroll vertically; wide
 * charts scroll horizontally with edge fades. */

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
      : stat.unit === "percent"
        ? `${Math.abs(stat.delta)}pp`
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

export function TrendChart({ points, rangeLabel }: { points: InsightSeriesPoint[]; rangeLabel: string }) {
  const [active, setActive] = useState<number | null>(null);
  const axis = trendAxis(Math.max(...points.map((point) => point.observedMinutes), 0));
  const segments = trendLineSegments(points);
  const summary = trendSummary(points);
  const hasCompletion = segments.length > 0;
  const slots = Math.max(1, points.length);
  const labelStride = points.length <= 12 ? 1 : Math.ceil(points.length / 10);
  const position = (index: number) => ((index + 0.5) / slots) * 100;
  const activePoint = active === null ? null : points[active];
  return (
    <div className="trend-chart-wrap">
      <div className="trend-split">
        <div className="trend-plot">
          <div className="trend-axis trend-axis-left" aria-hidden="true">
            {axis.ticks.map((tick, index) => (
              <span key={tick} style={{ bottom: `${axis.percents[index]}%` }}>{axisTickLabel(tick)}</span>
            ))}
          </div>
          <div className="trend-canvas" onMouseLeave={() => setActive(null)}>
            <div className="trend-grid" aria-hidden="true">
              {axis.percents.map((percent) => <i key={percent} style={{ bottom: `${percent}%` }} />)}
            </div>
            {hasCompletion ? (
              <svg className="trend-line-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                {segments.map((segment, index) => segment.points.length > 1 ? (
                  <path
                    key={`line-${index}`}
                    className="trend-line"
                    d={segment.points.map((point, order) => `${order ? "L" : "M"}${(((point.index + 0.5) / slots) * 100).toFixed(2)} ${(100 - point.percent).toFixed(2)}`).join(" ")}
                  />
                ) : null)}
              </svg>
            ) : null}
            <div className="trend-days" role="group" aria-label={`Observed work time and planned-commitment completion by day for ${rangeLabel}`}>
              {points.map((point, index) => {
                const label = `${formatWorkOsDate(point.date)}: ${minutesLabel(point.observedMinutes)} observed, ${point.completionPercent === null ? "no planned commitments" : `${point.completionPercent}% of planned commitments completed`}, ${point.outcomes} outcome${point.outcomes === 1 ? "" : "s"}, ${point.updates} update${point.updates === 1 ? "" : "s"}${point.blocked ? `, ${point.blocked} blocker${point.blocked === 1 ? "" : "s"}` : ""}`;
                const showLabel = index % labelStride === 0 || index === points.length - 1;
                return (
                  <div className="trend-day" key={point.date}>
                    <button
                      type="button"
                      className={`trend-day-hit${active === index ? " active" : ""}`}
                      aria-label={label}
                      onMouseEnter={() => setActive(index)}
                      onFocus={() => setActive(index)}
                      onBlur={() => setActive(null)}
                    >
                      <span
                        className={`trend-bar${point.observedMinutes > 0 ? "" : " empty"}`}
                        style={point.observedMinutes > 0 ? { height: `${Math.min(100, (point.observedMinutes / axis.max) * 100)}%` } : undefined}
                      />
                    </button>
                    <span className={`trend-day-label${showLabel ? "" : " sparse"}`}>{showLabel ? point.label : ""}</span>
                  </div>
                );
              })}
            </div>
            {hasCompletion ? segments.flatMap((segment) => segment.points.map((point) => (
              <i key={`dot-${point.index}`} className="trend-dot" aria-hidden="true" style={{ left: `${position(point.index)}%`, bottom: `${Math.min(100, point.percent)}%` }} />
            ))) : null}
            {activePoint ? (
              <div className="chart-tooltip" style={{ left: `${position(active!)}%` }} aria-hidden="true">
                <strong>{formatWorkOsDate(activePoint.date)}</strong>
                <span><i className="swatch observed" /> {minutesLabel(activePoint.observedMinutes)} observed</span>
                <span><i className="swatch completion" /> {activePoint.completionPercent === null ? "No planned commitments" : `${activePoint.completionPercent}% of commitments completed`}</span>
                <span>{activePoint.outcomes} outcome{activePoint.outcomes === 1 ? "" : "s"} · {activePoint.updates} update{activePoint.updates === 1 ? "" : "s"}{activePoint.blocked ? ` · ${activePoint.blocked} blocker` : ""}</span>
              </div>
            ) : null}
          </div>
          <div className="trend-axis trend-axis-right" aria-hidden="true">
            {axis.percents.slice().reverse().map((percent) => (
              <span key={percent} style={{ bottom: `${percent}%` }}>{percent}%</span>
            ))}
          </div>
          <div className="trend-labels">
            {points.map((point, index) => (
              <span className="trend-day-label" key={point.date} aria-hidden="true">{index % labelStride === 0 || index === points.length - 1 ? point.label : ""}</span>
            ))}
          </div>
        </div>
        <aside className="trend-summary">
          <p className="trend-summary-title">Range summary</p>
          <dl>
            <div><dt>Peak day</dt><dd>{summary.peak ? `${summary.peak.label} · ${minutesLabel(summary.peak.observedMinutes)}` : "—"}</dd></div>
            <div><dt>Avg recorded day</dt><dd>{minutesLabel(summary.averageMinutes)}</dd></div>
            <div><dt>Days recorded</dt><dd>{summary.recordedDays} of {points.length}</dd></div>
            <div><dt>Commitment rate</dt><dd>{summary.averageCompletionPercent === null ? "—" : `${summary.averageCompletionPercent}%`}</dd></div>
          </dl>
          <div className="trend-legend">
            <span><i aria-hidden="true" /><span className="trend-legend-copy">Observed session time<small>minutes on the left scale</small></span></span>
            <span><b aria-hidden="true" /><span className="trend-legend-copy">Planned commitments completed<small>0–100% on the right scale</small></span></span>
          </div>
        </aside>
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

/** Whole hours read as "2h"; part hours keep minutes ("2h 30m"). */
function axisTickLabel(minutes: number) {
  return minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60}h` : minutesLabel(minutes);
}

const FLOW_TONE: Record<FlowKey, string> = {
  completed: "slice-completed",
  progressed: "slice-progressed",
  deferred: "slice-deferred",
  carried: "slice-carried",
  unplanned: "slice-unplanned",
};

export function FlowDonut({ slices, ariaLabel }: { slices: FlowSlice[]; ariaLabel: string }) {
  const [hover, setHover] = useState<FlowKey | null>(null);
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const gap = slices.filter((slice) => slice.value > 0).length > 1 ? 3 : 0;
  let offset = 0;
  const segments = slices.filter((slice) => slice.value > 0).map((slice) => {
    const fraction = slice.value / total;
    const dash = Math.max(0.5, fraction * circumference - gap);
    const segment = { slice, dash, offset: offset * circumference + gap / 2 };
    offset += fraction;
    return segment;
  });
  const active = hover === null ? null : slices.find((slice) => slice.key === hover) ?? null;
  return (
    <div className="donut-split">
      <div className="donut-figure">
        <svg viewBox="0 0 132 132" role="img" aria-label={ariaLabel}>
          <circle className="donut-track" cx="66" cy="66" r={radius} />
          <g transform="rotate(-90 66 66)">
            {segments.map(({ slice, dash, offset: dashOffset }, index) => (
              <circle
                key={slice.key}
                className={`donut-slice ${FLOW_TONE[slice.key]}${hover !== null && hover !== slice.key ? " dimmed" : ""}`}
                cx="66" cy="66" r={radius}
                strokeDasharray={`${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}`}
                strokeDashoffset={-dashOffset}
                style={{ ["--slice-index" as string]: index } as React.CSSProperties}
                onMouseEnter={() => setHover(slice.key)}
                onMouseLeave={() => setHover(null)}
              >
                <title>{`${slice.label}: ${slice.value}`}</title>
              </circle>
            ))}
          </g>
        </svg>
        <div className="donut-center" aria-hidden="true">
          <strong>{active ? active.value : total}</strong>
          <small>{active ? `${active.label} · ${sharePercent(active.value, total)}%` : "records"}</small>
        </div>
      </div>
      <ul className="donut-legend">
        {slices.map((slice) => (
          <li
            key={slice.key}
            className={`${slice.value === 0 ? "zero" : ""}${hover === slice.key ? " active" : ""}`.trim()}
            onMouseEnter={() => setHover(slice.key)}
            onMouseLeave={() => setHover(null)}
          >
            <i className={FLOW_TONE[slice.key]} aria-hidden />
            <span>{slice.label}</span>
            <b>{slice.value}<small> · {sharePercent(slice.value, total)}%</small></b>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BarBreakdown({ rows, ariaLabel, total, emptyNote }: {
  rows: Array<{ key: string; label: string; value: number; detail?: string; attention?: boolean }>;
  ariaLabel: string;
  total?: number;
  emptyNote?: string;
}) {
  const sum = total ?? rows.reduce((accumulator, row) => accumulator + row.value, 0);
  if (!sum) return <p className="insight-empty-note">{emptyNote ?? "Nothing recorded in this range."}</p>;
  return (
    <ul className="bar-breakdown" aria-label={ariaLabel}>
      {rows.map((row, index) => {
        const share = sharePercent(row.value, sum);
        return (
          <li key={row.key} className={row.value > 0 && row.attention ? "attention" : undefined}>
            <span className="bar-head">
              <i className="bar-swatch" aria-hidden="true" />
              <span className="bar-label">{row.label}{row.value > 0 && row.attention ? <em>needs attention</em> : null}</span>
              <b>{row.value}<small>{row.detail ? ` ${row.detail}` : ""} · {share}%</small></b>
            </span>
            <span className="bar-track" aria-hidden="true">
              <i
                style={{ width: `${row.value > 0 ? Math.max(share, 2) : 0}%`, ["--bar-index" as string]: index } as React.CSSProperties}
              />
            </span>
          </li>
        );
      })}
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

export function DailyRhythmStrip({ points, rangeLabel }: { points: InsightSeriesPoint[]; rangeLabel: string }) {
  const maxOutcomes = Math.max(1, ...points.map((point) => point.outcomes));
  return (
    <div className="daily-rhythm-strip" role="list" aria-label={`Daily outcomes and commitment completion for ${rangeLabel}`}>
      {points.map((point) => (
        <div className="daily-rhythm-day" role="listitem" key={point.date}>
          <span className="daily-rhythm-label">{point.label}</span>
          <span className="daily-rhythm-plot" aria-hidden="true">
            <i className="daily-rhythm-outcomes" style={{ height: `${point.outcomes > 0 ? Math.max(18, (point.outcomes / maxOutcomes) * 100) : 0}%` }} />
            {point.completionPercent !== null ? <b style={{ bottom: `${Math.min(100, point.completionPercent)}%` }} /> : null}
          </span>
          <strong>{point.outcomes}</strong>
          <small>{point.completionPercent === null ? "No plan" : `${point.completionPercent}% plan`}</small>
          <span className="sr-only">{formatWorkOsDate(point.date)}: {point.outcomes} completed outcome{point.outcomes === 1 ? "" : "s"}; {point.completionPercent === null ? "no planned commitments" : `${point.completionPercent}% of planned commitments completed`}.</span>
        </div>
      ))}
      <div className="daily-rhythm-legend" aria-hidden="true">
        <span><i /> Outcomes</span>
        <span><b /> Plan completion</span>
      </div>
    </div>
  );
}

export function HeatmapGrid({ cells, rangeLabel }: { cells: HeatmapCell[]; rangeLabel: string }) {
  const [active, setActive] = useState<string | null>(null);
  const { ref, edges } = useScrollEdges<HTMLDivElement>("x");
  const columns = heatmapColumns(cells);
  if (!cells.length) return <p className="heatmap-empty">No days recorded in this range.</p>;
  const activeCell = active ? cells.find((cell) => cell.date === active) ?? null : null;
  return (
    <div className="heatmap-wrap" onMouseLeave={() => setActive(null)}>
      <div ref={ref} className={`heatmap-scroll${edgeClasses(edges, "fade-start", "fade-end")}`}>
        <div
          className="heatmap"
          role="group"
          aria-label={`Completed outcomes per day for ${rangeLabel}`}
          style={{ ["--heatmap-weeks" as string]: columns.length } as React.CSSProperties}
        >
          <span className="heatmap-corner" aria-hidden="true" />
          {columns.map((column) => (
            <span className="heatmap-month" key={`month-${column.index}`} style={{ gridColumn: column.index + 2 }} aria-hidden="true">{column.monthLabel ?? ""}</span>
          ))}
          <div className="heatmap-weekdays" aria-hidden="true">
            <span>Mon</span><span /><span>Wed</span><span /><span>Fri</span><span /><span>Sun</span>
          </div>
          {columns.map((column) => column.days.map((cell, weekday) => cell ? (
            <button
              key={cell.date}
              type="button"
              className={`heatmap-cell bucket-${cell.bucket}${active === cell.date ? " active" : ""}`}
              style={{ gridRow: weekday + 2, gridColumn: column.index + 2 }}
              aria-label={`${formatWorkOsDate(cell.date)}: ${cell.value} completed outcome${cell.value === 1 ? "" : "s"}`}
              onMouseEnter={() => setActive(cell.date)}
              onFocus={() => setActive(cell.date)}
              onBlur={() => setActive(null)}
            />
          ) : (
            <span key={`${column.index}-${weekday}`} className="heatmap-cell blank" style={{ gridRow: weekday + 2, gridColumn: column.index + 2 }} aria-hidden="true" />
          )))}
        </div>
      </div>
      <div className="heatmap-foot">
        <p className="heatmap-readout">
          {activeCell
            ? <><strong>{formatWorkOsDate(activeCell.date)}</strong> · {activeCell.value} completed outcome{activeCell.value === 1 ? "" : "s"}</>
            : "Completed outcomes per day · darker means more completed work"}
        </p>
        <span className="heatmap-scale" aria-hidden="true">Less <i className="bucket-1" /><i className="bucket-2" /><i className="bucket-3" /><i className="bucket-4" /> More</span>
      </div>
    </div>
  );
}

export function UpdateKindChart({ slices }: { slices: UpdateKindSlice[] }) {
  return (
    <BarBreakdown
      ariaLabel="Progress updates by kind, including blockers and priority changes"
      rows={slices.map((slice) => ({ key: slice.key, label: slice.label, value: slice.value, attention: slice.attention }))}
      emptyNote="No updates recorded in this range."
    />
  );
}

export function ConsistencyChips({ chips }: { chips: Array<{ key: string; label: string; value: string; detail: string }> }) {
  if (!chips.length) return null;
  return (
    <ul className="consistency-rows">
      {chips.map((chip) => (
        <li key={chip.key}>
          <span><small>{chip.label}</small><span className="consistency-detail">{chip.detail}</span></span>
          <strong>{chip.value}</strong>
        </li>
      ))}
    </ul>
  );
}

export function TrackedBars({ points, rangeLabel }: { points: InsightSeriesPoint[]; rangeLabel: string }) {
  const max = Math.max(1, ...points.map((point) => point.trackedMinutes));
  const stride = points.length <= 14 ? 1 : Math.ceil(points.length / 8);
  return (
    <div className="tracked-bars" role="img" aria-label={`Tracked activity minutes per day for ${rangeLabel}`}>
      <div className="tracked-bars-plot" aria-hidden="true">
        {points.map((point) => (
          <span className="tracked-bar-slot" key={point.date}>
            {point.trackedMinutes > 0 ? <i className="tracked-bar" style={{ height: `${Math.max((point.trackedMinutes / max) * 100, 4)}%` }} /> : null}
          </span>
        ))}
      </div>
      <div className="tracked-bars-labels" aria-hidden="true">
        {points.map((point, index) => <span key={point.date}>{index % stride === 0 || index === points.length - 1 ? point.label : ""}</span>)}
      </div>
    </div>
  );
}
