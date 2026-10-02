"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/** Recharts wrappers themed with the admin design tokens.
 *
 * Charts are supplementary to the tables below them: every chart carries an
 * accessible label, uses semantic tokens (never raw palette values), and skips
 * its mount animation when the reader prefers reduced motion. */

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

const AXIS_TICK = { fill: "var(--text-tertiary)", fontSize: 10 } as const;

const TOOLTIP_STYLE = {
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  boxShadow: "var(--shadow-md)",
  fontSize: 11,
  color: "var(--text-primary)",
  padding: "6px 10px",
} as const;

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
}

/** Grouped daily bars for two or three count series over a short range. */
export function TrendBars({ data, series, ariaLabel }: {
  data: Array<Record<string, string | number>>;
  series: ChartSeries[];
  ariaLabel: string;
}) {
  const reduced = useReducedMotion();
  return (
    <div role="img" aria-label={ariaLabel} className="h-[190px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -18 }} barCategoryGap="26%" barGap={2}>
          <CartesianGrid vertical={false} stroke="var(--border-subtle)" strokeDasharray="3 3" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS_TICK} interval="preserveStartEnd" />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={AXIS_TICK} width={36} />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "var(--accent-subtle)" }} isAnimationActive={false} />
          {series.map((entry) => (
            <Bar
              key={entry.key}
              dataKey={entry.key}
              name={entry.label}
              fill={entry.color}
              radius={[3, 3, 0, 0]}
              isAnimationActive={!reduced}
              maxBarSize={22}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Donut for a small categorical mix, with the total in the middle. */
export function MixDonut({ data, ariaLabel, centerLabel, centerValue }: {
  data: Array<{ key: string; label: string; value: number; color: string }>;
  ariaLabel: string;
  centerLabel?: string;
  centerValue?: string;
}) {
  const reduced = useReducedMotion();
  const slices = data.filter((entry) => entry.value > 0);
  if (!slices.length) return null;
  return (
    <div className="flex items-center gap-4">
      <div role="img" aria-label={ariaLabel} className="relative h-[150px] w-[150px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="label"
              innerRadius={48}
              outerRadius={68}
              paddingAngle={2}
              stroke="none"
              isAnimationActive={!reduced}
            >
              {slices.map((entry) => <Cell key={entry.key} fill={entry.color} />)}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} isAnimationActive={false} />
          </PieChart>
        </ResponsiveContainer>
        {centerValue ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <span>
              <span className="block text-[17px] font-semibold tabular-nums text-[var(--text-primary)]">{centerValue}</span>
              {centerLabel ? <span className="block text-[9.5px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">{centerLabel}</span> : null}
            </span>
          </div>
        ) : null}
      </div>
      <ul className="grid gap-1.5 text-[11.5px]">
        {data.map((entry) => (
          <li key={entry.key} className="flex items-center gap-2 text-[var(--text-secondary)]">
            <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: entry.color }} />
            <span className="min-w-0 flex-1">{entry.label}</span>
            <span className="tabular-nums text-[var(--text-primary)]">{entry.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Single-series line for a compact trend where bars would crowd. */
export function SparkTrend({ data, color, ariaLabel }: {
  data: Array<{ label: string; value: number }>;
  color: string;
  ariaLabel: string;
}) {
  const reduced = useReducedMotion();
  return (
    <div role="img" aria-label={ariaLabel} className="h-[64px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }} barCategoryGap="18%">
          <Bar dataKey="value" fill={color} radius={[2, 2, 0, 0]} isAnimationActive={!reduced} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Shared semantic colors so charts stay inside the token system. */
export const CHART_COLORS = {
  accent: "var(--accent)",
  observed: "var(--status-observed)",
  warn: "var(--status-warn)",
  error: "var(--status-error)",
  neutral: "var(--text-tertiary)",
} as const;

/** Horizontal per-person bars: one row per teammate, one bar per metric.
 * Suits small teams where a grouped vertical chart would crowd names. */
export function PulseBars({ data, series, ariaLabel }: {
  data: Array<Record<string, string | number>>;
  series: ChartSeries[];
  ariaLabel: string;
}) {
  const reduced = useReducedMotion();
  if (!data.length) return null;
  return (
    <div role="img" aria-label={ariaLabel} className="w-full" style={{ height: Math.max(120, data.length * 38) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 8 }} barCategoryGap="30%" barGap={2}>
          <CartesianGrid horizontal={false} stroke="var(--border-subtle)" strokeDasharray="3 3" />
          <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={AXIS_TICK} />
          <YAxis type="category" dataKey="label" width={92} tickLine={false} axisLine={false} tick={AXIS_TICK} />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "var(--accent-subtle)" }} isAnimationActive={false} />
          {series.map((entry) => (
            <Bar key={entry.key} dataKey={entry.key} name={entry.label} fill={entry.color} radius={[0, 3, 3, 0]} isAnimationActive={!reduced} maxBarSize={12} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
