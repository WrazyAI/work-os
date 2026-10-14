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
    <span className="delta-badge-wrap" title={`${stat.label}: ${stat.current} now, ${stat.previous} in the equal earlier period`}>
      <span className={`delta-badge ${tone}`}>
        <Arrow size={12} aria-hidden />
        <b>{direction === "flat" ? "no change" : `${direction === "up" ? "+" : "−"}${magnitude}`}</b>
      </span>
      <small className="delta-caption">vs earlier period</small>
    </span>
  );
}

/** One tile in the insights KPI strip: the recorded value leads, the equal-
 * period pill and an optional per-day sparkline give it context. The value
 * always renders as text — a chart never carries the only copy of a number. */
export function KpiCard({ label, value, delta, detail, spark, sparkLabel, attention = false }: {
  label: string;
  value: string;
  delta?: DeltaStat | null;
  detail?: string;
  spark?: number[];
  sparkLabel?: string;
  attention?: boolean;
}) {
  return (
    <article className={`insight-kpi${attention ? " attention" : ""}`}>
      <small>{label}</small>
      <strong>{value}</strong>
      <div className="insight-kpi-foot">
        {delta ? <DeltaBadge stat={delta} /> : detail ? <span className="insight-kpi-detail">{detail}</span> : null}
      </div>
      {spark && spark.length > 1 ? <Sparkline values={spark} label={sparkLabel ?? `${label} per day`} /> : null}
    </article>
  );
}

export interface ReliabilityRow {
  key: string;
  label: string;
  percent: number | null;
  detail: string;
  tone?: "ok" | "warn" | "neutral";
}

/** Goal-style ratio rows: the exact recorded percentage, a bounded progress
 * track, and the counts behind it. Percentages are ratios from the record,
 * never targets invented for the employee. */
export function PlanReliability({ rows }: { rows: ReliabilityRow[] }) {
  return (
    <ul className="ratio-rows">
      {rows.map((row) => {
        const percent = row.percent === null ? null : Math.max(0, Math.min(100, Math.round(row.percent)));
        return (
          <li key={row.key} className={`ratio-row ${row.tone ?? "neutral"}`}>
            <div className="ratio-head">
              <span>{row.label}</span>
              <strong>{percent === null ? "—" : `${percent}%`}</strong>
            </div>
            <div className="ratio-track" role="img" aria-label={`${row.label}: ${percent === null ? "not recorded in this range" : `${percent}%`}`}>
              {percent !== null ? <i style={{ width: `${percent}%` }} /> : null}
            </div>
            <p className="ratio-detail">{row.detail}</p>
          </li>
        );
      })}
    </ul>
  );
}

/** Record mix: one tinted stage block per flow state, sized by its share of
 * the range's recorded items, with exact counts and shares in the legend.
 * The stages form a composition of this range — they are not a sequence and
 * no conversion is implied. */
export function FlowStages({ slices, ariaLabel }: { slices: FlowSlice[]; ariaLabel: string }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const positive = slices.filter((slice) => slice.value > 0);
  if (total <= 0 || !positive.length) return <p className="insight-empty-note">Nothing was recorded in this range yet.</p>;
  const max = Math.max(...positive.map((slice) => slice.value));
  return (
    <div className="flow-stages">
      <div className="flow-stage-plot" role="img" aria-label={ariaLabel}>
        {positive.map((slice) => (
          <div className="flow-stage" key={slice.key}>
            <i
              className={FLOW_TONE[slice.key]}
              title={`${slice.label}: ${slice.value} · ${sharePercent(slice.value, total)}%`}
              style={{ height: `${Math.max(16, Math.round((slice.value / max) * 100))}%` }}
            />
          </div>
        ))}
      </div>
      <ul className="flow-stage-legend">
        {slices.map((slice) => (
          <li key={slice.key} className={slice.value === 0 ? "zero" : undefined}>
            <i className={FLOW_TONE[slice.key]} aria-hidden />
            <span>{slice.label}</span>
            <b>{slice.value}<small> · {sharePercent(slice.value, total)}%</small></b>
          </li>
        ))}
      </ul>
    </div>
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
              <div className={`chart-tooltip${active !== null && active <= 1 ? " edge-start" : active !== null && active >= points.length - 2 ? " edge-end" : ""}`} style={{ left: `${position(active!)}%` }} aria-hidden="true">
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

export function ActivityDonut({ items, total, ariaLabel }: {
  items: Array<{ name: string; minutes: number }>;
  total: number;
  ariaLabel: string;
}) {
  const [activeName, setActiveName] = useState<string | null>(null);
  const positive = items.filter((item) => item.minutes > 0);
  const listedTotal = positive.reduce((sum, item) => sum + item.minutes, 0);
  const chartTotal = Math.max(total, listedTotal);
  const residual = Math.max(0, chartTotal - listedTotal);
  const slices = residual > 0 ? [...positive, { name: "Other apps/sites", minutes: residual }] : positive;
  if (chartTotal <= 0 || !slices.length) return <p className="insight-empty-note">No tracked app activity in this range.</p>;
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const gap = slices.length > 1 ? 3 : 0;
  let offset = 0;
  const segments = slices.map((slice, index) => {
    const fraction = slice.minutes / chartTotal;
    const dash = Math.max(0.5, fraction * circumference - gap);
    const segment = { slice, index, dash, offset: offset * circumference + gap / 2 };
    offset += fraction;
    return segment;
  });
  const active = activeName ? slices.find((slice) => slice.name === activeName) ?? null : null;
  return (
    <div className="activity-donut">
      <div className="activity-donut-figure">
        <svg viewBox="0 0 132 132" role="img" aria-label={ariaLabel}>
          <circle className="activity-donut-track" cx="66" cy="66" r={radius} />
          <g transform="rotate(-90 66 66)">
            {segments.map(({ slice, index, dash, offset: dashOffset }) => (
              <circle
                key={slice.name}
                className={`activity-donut-slice activity-tone-${index % 6}${activeName !== null && activeName !== slice.name ? " dimmed" : ""}`}
                cx="66" cy="66" r={radius}
                strokeDasharray={`${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}`}
                strokeDashoffset={-dashOffset}
                tabIndex={0}
                aria-label={`${slice.name}: ${minutesLabel(slice.minutes)}, ${sharePercent(slice.minutes, chartTotal)}% of tracked time`}
                onMouseEnter={() => setActiveName(slice.name)}
                onMouseLeave={() => setActiveName(null)}
                onFocus={() => setActiveName(slice.name)}
                onBlur={() => setActiveName(null)}
              />
            ))}
          </g>
        </svg>
        <div className="activity-donut-center" aria-hidden="true">
          <strong>{active ? minutesLabel(active.minutes) : minutesLabel(chartTotal)}</strong>
          <small>{active ? `${sharePercent(active.minutes, chartTotal)}% · ${active.name}` : "tracked"}</small>
        </div>
      </div>
      <ul className="activity-donut-legend">
        {slices.map((slice, index) => (
          <li key={slice.name} className={activeName === slice.name ? "active" : undefined}>
            <button
              type="button"
              onMouseEnter={() => setActiveName(slice.name)}
              onMouseLeave={() => setActiveName(null)}
              onFocus={() => setActiveName(slice.name)}
              onBlur={() => setActiveName(null)}
            >
              <i className={`activity-tone-${index % 6}`} aria-hidden="true" />
              <span>{slice.name}</span>
              <b>{minutesLabel(slice.minutes)}<small>{sharePercent(slice.minutes, chartTotal)}%</small></b>
            </button>
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
  const [active, setActive] = useState<number | null>(null);
  const maxOutcomes = Math.max(1, ...points.map((point) => point.outcomes));
  const segments = trendLineSegments(points);
  const slots = Math.max(1, points.length);
  const position = (index: number) => ((index + 0.5) / slots) * 100;
  const activePoint = active === null ? null : points[active];
  return (
    <div className="daily-rhythm-strip" style={{ ["--daily-rhythm-slots" as string]: Math.max(1, points.length) } as React.CSSProperties}>
      <div className="daily-rhythm-labels" aria-hidden="true">
        {points.map((point) => <span key={point.date}>{point.label}</span>)}
      </div>
      <div className="daily-rhythm-plot" onMouseLeave={() => setActive(null)}>
        <div className="daily-rhythm-grid" aria-hidden="true"><i /><i /><i /></div>
        <svg className="daily-rhythm-line-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {segments.map((segment, index) => segment.points.length > 1 ? (
            <path
              key={index}
              className="daily-rhythm-line"
              d={segment.points.map((point, order) => `${order ? "L" : "M"}${position(point.index).toFixed(2)} ${(100 - point.percent).toFixed(2)}`).join(" ")}
            />
          ) : null)}
        </svg>
        <div className="daily-rhythm-days" role="list" aria-label={`Daily outcomes and commitment completion for ${rangeLabel}`}>
          {points.map((point, index) => {
            const label = `${formatWorkOsDate(point.date)}: ${point.outcomes} completed outcome${point.outcomes === 1 ? "" : "s"}; ${point.completionPercent === null ? "no planned commitments" : `${point.completionPercent}% of planned commitments completed`}; ${minutesLabel(point.observedMinutes)} observed.`;
            return (
              <div className="daily-rhythm-day" role="listitem" key={point.date}>
                <button
                  type="button"
                  className={`daily-rhythm-hit${active === index ? " active" : ""}`}
                  aria-label={label}
                  onMouseEnter={() => setActive(index)}
                  onFocus={() => setActive(index)}
                  onBlur={() => setActive(null)}
                >
                  <i
                    className={`daily-rhythm-outcomes${point.outcomes > 0 ? "" : " empty"}`}
                    style={point.outcomes > 0 ? { height: `${Math.max(10, (point.outcomes / maxOutcomes) * 100)}%` } : undefined}
                    aria-hidden="true"
                  />
                </button>
              </div>
            );
          })}
        </div>
        {segments.flatMap((segment) => segment.points.map((point) => (
          <i key={`weekly-dot-${point.index}`} className="daily-rhythm-dot" aria-hidden="true" style={{ left: `${position(point.index)}%`, bottom: `${Math.min(100, point.percent)}%` }} />
        )))}
        {activePoint ? (
          <div className={`chart-tooltip daily-rhythm-tooltip${active !== null && active <= 1 ? " edge-start" : active !== null && active >= points.length - 2 ? " edge-end" : ""}`} style={{ left: `${position(active!)}%` }} aria-hidden="true">
            <strong>{formatWorkOsDate(activePoint.date)}</strong>
            <span><i className="swatch observed" /> {activePoint.outcomes} outcome{activePoint.outcomes === 1 ? "" : "s"}</span>
            <span><i className="swatch completion" /> {activePoint.completionPercent === null ? "No planned commitments" : `${activePoint.completionPercent}% of commitments completed`}</span>
            <span>{minutesLabel(activePoint.observedMinutes)} observed · {activePoint.updates} update{activePoint.updates === 1 ? "" : "s"}</span>
          </div>
        ) : null}
      </div>
      <div className="daily-rhythm-values" aria-hidden="true">
        {points.map((point) => <span key={point.date}><strong>{point.outcomes}</strong><small>{point.completionPercent === null ? "No plan" : `${point.completionPercent}% plan`}</small></span>)}
      </div>
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
