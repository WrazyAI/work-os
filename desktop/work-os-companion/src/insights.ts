import type { DayData, InsightConsistency, InsightDay, InsightUpdateKinds } from "./types";

export interface InsightSignal {
  label: string;
  value: number;
  percent: number;
}

export interface InsightChartData {
  signals: InsightSignal[];
  completedTasks: number;
  openTasks: number;
  completedPercent: number;
}

export function insightChartData(day: DayData | null): InsightChartData {
  const values = day?.signals ?? {
    employeeUpdates: 0,
    outputEvidence: day?.evidence.filter((item) => item.source !== "worktivity").length ?? 0,
    activityContext: day?.evidence.filter((item) => item.source === "worktivity").length ?? 0,
    completedTasks: day?.tasks.filter((item) => item.completed === true).length ?? 0,
    openTasks: day?.tasks.filter((item) => item.completed !== true).length ?? 0,
  };
  const rawSignals = [
    { label: "Employee updates", value: values.employeeUpdates },
    { label: "Output evidence", value: values.outputEvidence },
    { label: "Activity context", value: values.activityContext },
  ];
  const maxSignal = Math.max(1, ...rawSignals.map((item) => item.value));
  const totalTasks = values.completedTasks + values.openTasks;
  return {
    signals: rawSignals.map((item) => ({ ...item, percent: (item.value / maxSignal) * 100 })),
    completedTasks: values.completedTasks,
    openTasks: values.openTasks,
    completedPercent: totalTasks ? Math.round((values.completedTasks / totalTasks) * 100) : 0,
  };
}

/** Chart geometry helpers. Every series keeps its own unit and scale; nothing
 * here is ever combined into a composite score. */

export const durationLabel = (seconds: number) => `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
export const minutesLabel = (minutes: number) => (minutes >= 60 ? `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m` : `${Math.round(minutes)}m`);

export interface InsightSeriesPoint {
  date: string;
  label: string;
  observedMinutes: number;
  completionPercent: number | null;
  outcomes: number;
  updates: number;
  trackedMinutes: number;
  blocked: number;
}

function shortDateLabel(date: string) {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", timeZone: "UTC" }).format(parsed);
}

export function insightSeries(days: InsightDay[]): InsightSeriesPoint[] {
  return days.map((day) => ({
    date: day.date,
    label: shortDateLabel(day.date),
    observedMinutes: Math.round((Number(day.observedSeconds ?? 0) / 60) * 10) / 10,
    completionPercent: day.planned > 0 ? Math.round((Number(day.plannedCompleted ?? 0) / day.planned) * 100) : null,
    outcomes: Number(day.tasksCompleted ?? 0),
    updates: Number(day.updates ?? 0),
    trackedMinutes: Number(day.trackedMinutes ?? 0),
    blocked: Number(day.updatesByKind?.blocked ?? 0),
  }));
}

/** Rounds a maximum up to a readable axis top (1, 2, or 5 × 10^n). */
export function niceCeil(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const step = normalized < 1.5 ? 1 : normalized < 3.5 ? 2 : normalized < 7.5 ? 5 : 10;
  return step * magnitude;
}

export function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0 || count < 2) return [0];
  const step = niceStep(max / count);
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= top + step / 2; value += step) ticks.push(Math.round(value * 100) / 100);
  return ticks;
}

export type FlowKey = "completed" | "progressed" | "deferred" | "carried" | "unplanned";

export interface FlowSlice {
  key: FlowKey;
  label: string;
  value: number;
}

const FLOW_LABELS: Record<FlowKey, string> = {
  completed: "Outcomes completed",
  progressed: "Progress updates",
  deferred: "Deferred",
  carried: "Carried over",
  unplanned: "Unplanned",
};

export function flowBreakdown(days: InsightDay[]): FlowSlice[] {
  const pick = (key: FlowKey, read: (day: InsightDay) => number) => ({
    key,
    label: FLOW_LABELS[key],
    value: days.reduce((sum, day) => sum + Math.max(0, Number(read(day) ?? 0)), 0),
  });
  return [
    pick("completed", (day) => Number(day.tasksCompleted ?? 0)),
    pick("progressed", (day) => Number(day.progressed ?? 0)),
    pick("deferred", (day) => Number(day.deferred ?? 0)),
    pick("carried", (day) => Number(day.carried ?? day.carryOver ?? 0)),
    pick("unplanned", (day) => Number(day.unplanned ?? 0)),
  ];
}

export interface UpdateKindSlice {
  key: keyof InsightUpdateKinds;
  label: string;
  value: number;
  attention: boolean;
}

const UPDATE_KIND_FIELDS: Array<{ key: keyof InsightUpdateKinds; label: string; attention?: boolean }> = [
  { key: "progress", label: "Progress" },
  { key: "starting", label: "Starts" },
  { key: "completionClaim", label: "Completion claims" },
  { key: "blocked", label: "Blockers", attention: true },
  { key: "priorityChange", label: "Priority changes", attention: true },
  { key: "unplannedWork", label: "Unplanned work", attention: true },
];

const EMPTY_UPDATE_KINDS: InsightUpdateKinds = { progress: 0, starting: 0, completionClaim: 0, blocked: 0, priorityChange: 0, unplannedWork: 0 };

export function updateKindBreakdown(source: InsightUpdateKinds | InsightDay[] | null | undefined): UpdateKindSlice[] {
  let kinds = EMPTY_UPDATE_KINDS;
  if (Array.isArray(source)) {
    kinds = source.reduce<InsightUpdateKinds>((sum, day) => {
      const dayKinds = day.updatesByKind ?? EMPTY_UPDATE_KINDS;
      return {
        progress: sum.progress + Number(dayKinds.progress ?? 0),
        starting: sum.starting + Number(dayKinds.starting ?? 0),
        completionClaim: sum.completionClaim + Number(dayKinds.completionClaim ?? 0),
        blocked: sum.blocked + Number(dayKinds.blocked ?? 0),
        priorityChange: sum.priorityChange + Number(dayKinds.priorityChange ?? 0),
        unplannedWork: sum.unplannedWork + Number(dayKinds.unplannedWork ?? 0),
      };
    }, { ...EMPTY_UPDATE_KINDS });
  } else if (source) {
    kinds = { ...EMPTY_UPDATE_KINDS, ...source };
  }
  return UPDATE_KIND_FIELDS.map(({ key, label, attention }) => ({ key, label, value: Number(kinds[key] ?? 0), attention: attention === true }));
}

export function onTimeRate(days: InsightDay[]) {
  const onTime = days.reduce((sum, day) => sum + Number(day.outcomesOnTime ?? 0), 0);
  const late = days.reduce((sum, day) => sum + Number(day.outcomesLate ?? 0), 0);
  const total = onTime + late;
  return { onTime, late, total, percent: total ? Math.round((onTime / total) * 100) : null };
}

export interface DeltaStat {
  key: string;
  label: string;
  current: number;
  previous: number;
  delta: number;
  unit: "count" | "minutes" | "hours" | "percent";
  /** true = rising is better, false = falling is better, null = neutral. */
  goodDirection: boolean | null;
}

export function periodDeltas(totals: Partial<InsightDay> | null | undefined, previousTotals: Partial<InsightDay> | null | undefined): DeltaStat[] {
  const raw: Array<{ key: string; label: string; read: (row: Partial<InsightDay>) => number; unit: DeltaStat["unit"]; goodDirection: boolean | null }> = [
    { key: "tasksCompleted", label: "Outcomes", read: (row) => Number(row.tasksCompleted ?? 0), unit: "count", goodDirection: true },
    { key: "plannedCompleted", label: "Commitments done", read: (row) => Number(row.plannedCompleted ?? 0), unit: "count", goodDirection: true },
    { key: "updates", label: "Updates", read: (row) => Number(row.updates ?? 0), unit: "count", goodDirection: true },
    { key: "outcomesLate", label: "Late outcomes", read: (row) => Number(row.outcomesLate ?? 0), unit: "count", goodDirection: false },
    { key: "outputEvidence", label: "Output evidence", read: (row) => Number(row.outputEvidence ?? 0), unit: "count", goodDirection: true },
    { key: "observedMinutes", label: "Observed time", read: (row) => Math.round(Number(row.observedSeconds ?? 0) / 60), unit: "minutes", goodDirection: null },
    { key: "trackedMinutes", label: "Tracked context", read: (row) => Number(row.trackedMinutes ?? 0), unit: "minutes", goodDirection: null },
  ];
  if (!totals) return [];
  const previous = previousTotals ?? {};
  return raw.map(({ key, label, read, unit, goodDirection }) => {
    const current = read(totals);
    const before = read(previous);
    return { key, label, current, previous: before, delta: current - before, unit, goodDirection };
  });
}

export interface HeatmapCell {
  date: string;
  weekIndex: number;
  weekday: number;
  value: number;
  bucket: 0 | 1 | 2 | 3 | 4;
  label: string;
}

function weekdayIndex(date: string) {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return 0;
  return (parsed.getUTCDay() + 6) % 7; // Monday = 0
}

export function heatmapCells(days: InsightDay[]): HeatmapCell[] {
  if (!days.length) return [];
  const firstDate = Date.parse(`${days[0].date}T12:00:00Z`);
  const firstWeekday = weekdayIndex(days[0].date);
  return days.map((day) => {
    const value = Math.max(0, Number(day.tasksCompleted ?? 0));
    const dayOffset = Number.isFinite(firstDate) ? Math.round((Date.parse(`${day.date}T12:00:00Z`) - firstDate) / 86_400_000) : 0;
    return {
      date: day.date,
      weekIndex: Math.floor((Math.max(0, dayOffset) + firstWeekday) / 7),
      weekday: weekdayIndex(day.date),
      value,
      bucket: (value === 0 ? 0 : value === 1 ? 1 : value === 2 ? 2 : value <= 4 ? 3 : 4) as HeatmapCell["bucket"],
      label: shortDateLabel(day.date),
    };
  });
}

export interface ConsistencyChip {
  key: string;
  label: string;
  value: string;
  detail: string;
}

export function consistencyChips(consistency: InsightConsistency | null | undefined, days: InsightDay[]): ConsistencyChip[] {
  const fallbackUpdates = days.filter((day) => Number(day.updates ?? 0) > 0).length;
  const fallbackGoals = days.filter((day) => day.goalSet === true || String(day.goal?.text ?? "").trim().length > 0).length;
  const chips: ConsistencyChip[] = [];
  if (consistency) {
    chips.push({
      key: "goal",
      label: "Goals written",
      value: `${consistency.daysWithGoal}/${consistency.dayCount}`,
      detail: "workdays with a written goal",
    });
    chips.push({
      key: "update",
      label: "Updates recorded",
      value: `${consistency.daysWithUpdate}/${consistency.dayCount}`,
      detail: "workdays with a substantive update",
    });
    chips.push({
      key: "completion",
      label: "Days with outcomes",
      value: `${consistency.daysWithCompletion}/${consistency.dayCount}`,
      detail: "workdays with at least one completed outcome",
    });
    if (consistency.currentStreak > 0) {
      chips.push({
        key: "streak",
        label: "Current streak",
        value: `${consistency.currentStreak}d`,
        detail: "consecutive days ending with an update or completed work",
      });
    }
    if (consistency.commitmentRate !== null) {
      chips.push({
        key: "commitments",
        label: "Commitments completed",
        value: `${consistency.commitmentRate}%`,
        detail: "planned commitments completed in this range",
      });
    }
    if (consistency.bestDay) {
      chips.push({
        key: "best",
        label: "Largest day",
        value: `${consistency.bestDay.tasksCompleted}`,
        detail: `completed outcomes on ${consistency.bestDay.date}`,
      });
    }
    return chips;
  }
  if (days.length) {
    chips.push({ key: "goal", label: "Goals written", value: `${fallbackGoals}/${days.length}`, detail: "days with a written goal" });
    chips.push({ key: "update", label: "Updates recorded", value: `${fallbackUpdates}/${days.length}`, detail: "days with a substantive update" });
  }
  return chips;
}
