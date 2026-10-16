import { describe, expect, it } from "vitest";
import type { AdminTaskRow } from "./admin/data";
import { TASK_SORT_COLUMNS, nextTaskSort, sortTaskRows, type TaskSortState } from "./admin/TasksPage";

/** A fixed workday keeps the Status ranks deterministic: the fixture dates
 * below are chosen around it (2026-10-16). */
const TODAY = "2026-10-16";

function row(id: string, overrides: Partial<AdminTaskRow> = {}): AdminTaskRow {
  return { id, title: id, completed: false, ...overrides };
}

function labels(rows: AdminTaskRow[]) {
  return rows.map((task) => String(task.title ?? task.name ?? ""));
}

const asc = (key: TaskSortState["key"]): TaskSortState => ({ key, direction: "asc" });
const desc = (key: TaskSortState["key"]): TaskSortState => ({ key, direction: "desc" });

describe("administration task ordering", () => {
  it("opens in recency order: most recently updated first, missing timestamps last", () => {
    const rows = [
      row("t-old", { title: "Old", updated_at: "2026-10-10T09:00:00.000Z" }),
      row("t-new-b", { title: "Beta", updated_at: "2026-10-15T11:00:00.000Z" }),
      row("t-none", { title: "Undated", updated_at: null }),
      row("t-new-a", { title: "Alpha", updated_at: "2026-10-15T11:00:00.000Z" }),
    ];
    expect(labels(sortTaskRows(rows, null, TODAY))).toEqual(["Alpha", "Beta", "Old", "Undated"]);
  });

  it("breaks equal keys by title A→Z and then id, so the order never jitters", () => {
    const same = "2026-10-15T11:00:00.000Z";
    const rows = [
      row("t-2", { title: "Same", updated_at: same }),
      row("t-1", { title: "Same", updated_at: same }),
      row("t-3", { title: "alpha", updated_at: same }),
    ];
    expect(sortTaskRows(rows, null, TODAY).map((task) => task.id)).toEqual(["t-3", "t-1", "t-2"]);
    const reversed = [...rows].reverse();
    expect(sortTaskRows(reversed, null, TODAY).map((task) => task.id)).toEqual(["t-3", "t-1", "t-2"]);
  });

  it("sorts Task A→Z first and Z→A second, with missing titles last both ways", () => {
    const rows = [
      row("t-banana", { title: "banana" }),
      row("t-apple", { title: "Apple" }),
      row("t-named", { title: null, name: "cherry" }),
      row("t-missing", { title: null, name: null }),
    ];
    expect(labels(sortTaskRows(rows, asc("task"), TODAY))).toEqual(["Apple", "banana", "cherry", ""]);
    expect(labels(sortTaskRows(rows, desc("task"), TODAY))).toEqual(["cherry", "banana", "Apple", ""]);
  });

  it("sorts Assignees A→Z first, Z→A second, and keeps Unassigned and missing last both ways", () => {
    const rows = [
      row("t-unassigned", { assignees: [{ displayName: "Unassigned" }] }),
      row("t-zoe", { assignees: [{ displayName: "Zoe" }] }),
      row("t-adam", { assignees: [{ displayName: "adam" }] }),
      row("t-empty", { assignees: [] }),
      row("t-none"),
    ];
    expect(labels(sortTaskRows(rows, asc("assignees"), TODAY))).toEqual(["t-adam", "t-zoe", "t-empty", "t-none", "t-unassigned"]);
    expect(labels(sortTaskRows(rows, desc("assignees"), TODAY))).toEqual(["t-zoe", "t-adam", "t-empty", "t-none", "t-unassigned"]);
  });

  it("sorts Due earliest first, latest first second, missing last both ways", () => {
    const rows = [
      row("t-late", { due_date: "2026-10-20" }),
      row("t-early", { due_date: "2026-10-10" }),
      row("t-none", { due_date: null }),
    ];
    expect(labels(sortTaskRows(rows, asc("due"), TODAY))).toEqual(["t-early", "t-late", "t-none"]);
    expect(labels(sortTaskRows(rows, desc("due"), TODAY))).toEqual(["t-late", "t-early", "t-none"]);
  });

  it("ranks Status by attention — Overdue, Open, Done — reverses it second, and keeps unstated flags last", () => {
    const rows = [
      row("t-done", { completed: true, due_date: "2026-10-10" }),
      row("t-open", { completed: false, due_date: "2026-10-20" }),
      row("t-overdue", { completed: false, due_date: "2026-10-10" }),
      row("t-unknown", { completed: null, due_date: "2026-10-10" }),
    ];
    expect(labels(sortTaskRows(rows, asc("status"), TODAY))).toEqual(["t-overdue", "t-open", "t-done", "t-unknown"]);
    expect(labels(sortTaskRows(rows, desc("status"), TODAY))).toEqual(["t-done", "t-open", "t-overdue", "t-unknown"]);
  });

  it("treats a task due today as Open, not Overdue", () => {
    const rows = [row("t-today", { due_date: TODAY }), row("t-past", { due_date: "2026-10-15" })];
    expect(labels(sortTaskRows(rows, asc("status"), TODAY))).toEqual(["t-past", "t-today"]);
  });

  it("starts each column at its natural direction, reverses on the second activation, and switches columns", () => {
    expect(nextTaskSort(null, "task")).toEqual({ key: "task", direction: "asc" });
    expect(nextTaskSort({ key: "task", direction: "asc" }, "task")).toEqual({ key: "task", direction: "desc" });
    expect(nextTaskSort({ key: "task", direction: "desc" }, "task")).toEqual({ key: "task", direction: "asc" });
    expect(nextTaskSort({ key: "task", direction: "desc" }, "due")).toEqual({ key: "due", direction: "asc" });
    expect(nextTaskSort({ key: "status", direction: "desc" }, "status")).toEqual({ key: "status", direction: "asc" });
  });

  it("documents the natural first direction and wording for every sortable column", () => {
    expect(TASK_SORT_COLUMNS.map((column) => [column.key, column.firstDirection, column.directions.asc, column.directions.desc])).toEqual([
      ["task", "asc", "A to Z", "Z to A"],
      ["assignees", "asc", "A to Z", "Z to A"],
      ["due", "asc", "earliest first", "latest first"],
      ["status", "asc", "overdue first", "done first"],
    ]);
  });
});
