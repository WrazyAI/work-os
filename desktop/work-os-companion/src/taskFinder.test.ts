import { describe, expect, it } from "vitest";
import { taskFinderDatePreset, taskFinderRangeError, filterFinderTasks } from "./taskFinderFilters";

describe("finder dates", () => {
  it("uses inclusive Monday weeks without local timezone shifts", () => {
    expect(taskFinderDatePreset("this_week", "2026-11-11")).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    expect(taskFinderDatePreset("last_week", "2026-01-01")).toEqual({ from: "2025-12-22", to: "2025-12-28" });
    expect(taskFinderDatePreset("this_week", "2026-11-15")).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    expect(taskFinderDatePreset("today", "2028-02-29")).toEqual({ from: "2028-02-29", to: "2028-02-29" });
  });
  it("rejects impossible and reversed ranges but permits future dates", () => {
    expect(taskFinderRangeError("2026-02-29", "")).toMatch(/valid date/);
    expect(taskFinderRangeError("2026-11-12", "2026-11-11")).toMatch(/end/);
    expect(taskFinderRangeError("2027-01-01", "2027-01-31")).toBe("");
  });
  it("keeps completion and overdue precedence in local sources", () => {
    const rows = [{ id: "done", completed: true, due_date: "2026-11-01" }, { id: "late", workflow_status: "in_progress", due_date: "2026-11-01" }, { id: "working", workflow_status: "in_progress" }];
    expect(filterFinderTasks(rows, { search: "", status: "overdue", from: "", to: "" }, "2026-11-11").map(t => t.id)).toEqual(["late"]);
    expect(filterFinderTasks(rows, { search: "", status: "in_progress", from: "", to: "" }, "2026-11-11").map(t => t.id)).toEqual(["working"]);
  });
});
