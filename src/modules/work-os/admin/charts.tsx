"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatDuration } from "./ui";

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

/** Categorical palette for stacked-by-person charts: semantic workspace
 * tokens where one exists, plus fixed mid-tone hexes chosen to stay legible
 * against both the light and dark workspace surfaces. */
export const CHART_PALETTE = [
  "var(--accent)",
  "var(--status-observed)",
  "var(--status-warn)",
  "var(--status-error)",
  "#8b5cf6",
  "#d946ef",
  "#0d9488",
  "#f97316",
  "#6366f1",
  "var(--text-tertiary)",
] as const;

export interface StackedTimePerson {
  personId: string;
  name: string;
  minutes: number;
}

export interface StackedTimePoint {
  date: string;
  totalMinutes: number;
  people: StackedTimePerson[];
}

function dayLabel(date: string) {
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

interface StackedTooltipEntry {
  name?: string | number;
  value?: number | string;
  color?: string;
  fill?: string;
  payload?: { totalMinutes?: number } | null;
}

/** Hover content for the stacked time chart: every teammate with minutes that
 * day, strongest first, then the day's total. */
function StackedTimeTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: ReadonlyArray<StackedTooltipEntry>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  const entries = payload
    .filter((entry) => Number(entry.value ?? 0) > 0)
    .sort((left, right) => Number(right.value ?? 0) - Number(left.value ?? 0));
  if (!entries.length) return null;
  const total = Number(payload[0]?.payload?.totalMinutes ?? entries.reduce((sum, entry) => sum + Number(entry.value ?? 0), 0));
  return (
    <div style={TOOLTIP_STYLE}>
      <p style={{ margin: 0, fontWeight: 600 }}>{label}</p>
      <ul style={{ margin: "5px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 3 }}>
        {entries.map((entry, index) => (
          <li key={`${String(entry.name)}:${index}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              <span aria-hidden style={{ width: 8, height: 8, borderRadius: 2, background: entry.color ?? entry.fill ?? "var(--text-tertiary)" }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name}</span>
            </span>
            <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-secondary)" }}>{formatDuration(Number(entry.value ?? 0) * 60)}</span>
          </li>
        ))}
      </ul>
      <p style={{ margin: "5px 0 0", color: "var(--text-tertiary)" }}>Total {formatDuration(total * 60)}</p>
    </div>
  );
}

/** Stacked daily bars where each segment is one teammate's observed work time.
 * The legend and hover tooltip name the person behind every color; observed
 * time is activity context, never completion. Renders nothing when the range
 * holds no minutes so the caller can show honest empty copy. */
export function StackedTimeBars({ data, ariaLabel }: {
  data: StackedTimePoint[];
  ariaLabel: string;
}) {
  const reduced = useReducedMotion();
  const totals = new Map<string, { personId: string; name: string; minutes: number }>();
  for (const point of data) {
    for (const person of point.people) {
      const existing = totals.get(person.personId);
      if (existing) existing.minutes += person.minutes;
      else totals.set(person.personId, { personId: person.personId, name: person.name, minutes: person.minutes });
    }
  }
  const people = [...totals.values()]
    .filter((person) => person.minutes > 0)
    .sort((left, right) => right.minutes - left.minutes || left.name.localeCompare(right.name))
    .map((person, index) => ({ ...person, color: CHART_PALETTE[index % CHART_PALETTE.length] }));
  if (!people.length) return null;
  const rows = data.map((point) => {
    const row: Record<string, string | number> = { label: dayLabel(point.date), totalMinutes: point.totalMinutes };
    for (const person of point.people) row[person.personId] = person.minutes;
    return row;
  });
  return (
    <div className="w-full">
      <div role="img" aria-label={ariaLabel} className="h-[190px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 6, right: 6, bottom: 0, left: -18 }} barCategoryGap="26%">
            <CartesianGrid vertical={false} stroke="var(--border-subtle)" strokeDasharray="3 3" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS_TICK} interval="preserveStartEnd" />
            <YAxis
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              tick={AXIS_TICK}
              width={36}
              tickFormatter={(value) => {
                const minutes = Number(value);
                if (!minutes) return "0";
                if (minutes % 60 === 0) return `${minutes / 60}h`;
                return `${(minutes / 60).toFixed(1)}h`;
              }}
            />
            <Tooltip content={<StackedTimeTooltip />} cursor={{ fill: "var(--accent-subtle)" }} isAnimationActive={false} />
            {people.map((person) => (
              <Bar
                key={person.personId}
                dataKey={person.personId}
                stackId="time"
                name={person.name}
                fill={person.color}
                isAnimationActive={!reduced}
                maxBarSize={22}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5" aria-label="Chart legend: employees by color">
        {people.map((person) => (
          <li key={person.personId} className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
            <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: person.color }} />
            {person.name}
          </li>
        ))}
      </ul>
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

/** Stacked daily counts split by teammate (for example EOD submissions per
 * day). One segment per person, sized by that person's count for the day, with
 * a legend that maps each color to a teammate. */
export function StackedCountBars({ data, ariaLabel }: {
  data: Array<{ date: string; people: Array<{ personId: string; name: string; submitted: number }> }>;
  ariaLabel: string;
}) {
  const reduced = useReducedMotion();
  const people = [...new Map(data.flatMap((point) => point.people).map((person) => [person.personId, person.name])).entries()]
    .map(([personId, name], index) => ({ personId, name, color: CHART_PALETTE[index % CHART_PALETTE.length] }));
  if (!data.length || !people.length) return null;
  const chartData = data.map((point) => {
    const row: Record<string, string | number> = { label: point.date.slice(5).replace("-", "/") };
    for (const person of people) row[person.personId] = point.people.find((entry) => entry.personId === person.personId)?.submitted ?? 0;
    return row;
  });
  return (
    <div className="flex flex-wrap items-start gap-5">
      <div role="img" aria-label={ariaLabel} className="min-w-[240px] flex-1">
        <ResponsiveContainer width="100%" height={190}>
          <BarChart data={chartData} margin={{ top: 6, right: 6, bottom: 0, left: -18 }} barCategoryGap="26%">
            <CartesianGrid vertical={false} stroke="var(--border-subtle)" strokeDasharray="3 3" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS_TICK} interval="preserveStartEnd" />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={AXIS_TICK} width={36} />
            <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "var(--accent-subtle)" }} isAnimationActive={false} />
            {people.map((person) => (
              <Bar
                key={person.personId}
                dataKey={person.personId}
                name={person.name}
                stackId="reports"
                fill={person.color}
                isAnimationActive={!reduced}
                maxBarSize={26}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="grid gap-1.5 text-[11.5px]">
        {people.map((person) => (
          <li key={person.personId} className="flex items-center gap-2 text-[var(--text-secondary)]">
            <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: person.color }} />
            <span className="min-w-0 flex-1 truncate">{person.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
