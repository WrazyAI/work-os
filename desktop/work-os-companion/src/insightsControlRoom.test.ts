import { describe, expect, it } from "vitest";
import { matrixBuckets } from "./admin/InsightsControlRoom";
import type { AdminInsights } from "./admin/types";

function series(dates: string[]): AdminInsights["series"] {
  return dates.map((date) => ({ date, outcomesCompleted: 0, updates: 0, eodSubmitted: 0, trackedMinutes: 0 }));
}

describe("insights matrix buckets", () => {
  it("uses the seven-day range's own workdays instead of an arbitrary slice", () => {
    const points = series(["2026-11-18", "2026-11-19", "2026-11-20", "2026-11-23", "2026-11-24"]);
    const buckets = matrixBuckets(points, "7d");
    expect(buckets.map((bucket) => bucket.key)).toEqual(points.map((point) => point.date));
    expect(buckets.every((bucket) => bucket.kind === "day")).toBe(true);
    expect(buckets[0]).toMatchObject({ start: "2026-11-18", end: "2026-11-18", days: ["2026-11-18"] });
  });

  it("groups longer ranges by the Monday of each week", () => {
    const points = series(["2026-11-18", "2026-11-19", "2026-11-20", "2026-11-23", "2026-11-24"]);
    const buckets = matrixBuckets(points, "30d");
    expect(buckets).toHaveLength(2);
    expect(buckets[0]).toMatchObject({
      key: "2026-11-16",
      start: "2026-11-18",
      end: "2026-11-20",
      days: ["2026-11-18", "2026-11-19", "2026-11-20"],
      kind: "week",
    });
    expect(buckets[1]).toMatchObject({
      key: "2026-11-23",
      start: "2026-11-23",
      end: "2026-11-24",
      days: ["2026-11-23", "2026-11-24"],
      kind: "week",
    });
  });
});
