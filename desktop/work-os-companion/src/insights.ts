import type { DayData } from "./types";

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
