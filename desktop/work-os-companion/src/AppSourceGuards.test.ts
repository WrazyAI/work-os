import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(resolve(root, "src/App.tsx"), "utf8").replace(/\r\n/g, "\n");

describe("App memory payload resilience", () => {
  it("treats a memory response without a facts array as empty", () => {
    expect(app).toContain("memoryQuery.data?.facts?.filter");
    expect(app).toContain("memoryQuery.data?.facts?.find");
    expect(app).not.toContain("memoryQuery.data?.facts.filter");
  });
});

describe("Tasks date ownership", () => {
  it("follows the live workday instead of a cached snapshot or a rollover", () => {
    // The cached day snapshot may describe yesterday. Letting it choose the
    // Tasks date silently hides the view tabs and Add action in history mode.
    expect(app).not.toContain("setPlanHistoryDate(snapshot.shiftDate)");
    expect(app).toContain("setPlanHistoryDate((current) => resolveTaskHistoryDate(current, nextDay.shiftDate, taskDatePinnedRef.current));");
    expect(app).toContain("taskDatePinnedRef.current = !!date && date !== (visibleDay?.shiftDate ?? \"\");");
  });
});
