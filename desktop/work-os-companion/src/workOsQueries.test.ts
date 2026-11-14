import { describe, expect, it } from "vitest";
import { ACTIVITY_INTERVAL_ENSURE_TIMEOUT_MS, ACTIVITY_INTERVALS_PAGE_SIZE, activityIntervalDecisionBody, activityIntervalsUrl, dashboardInsightsUrl, latestActivityIntervalUrl, openTaskCountUrl } from "./workOsQueries";
import { taskFinderQueryOptions, updateTaskHistoryPages } from "./workOsQueries";
import { workOsKeys } from "./queryClient";
import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";

describe("task finder query", () => {
  it("does not insert an unfiltered optimistic task into a filtered finder", () => {
    const client = new QueryClient();
    const page = { pages: [{ tasks: [{ id: "matching" }], totalCount: 1, nextCursor: null }], pageParams: [null] };
    const historyKey = ["work-os", "task-history", "all"];
    const finderKey = ["work-os", "task-history", "finder", "scope", "completed"];
    client.setQueryData(historyKey, page); client.setQueryData(finderKey, page);
    updateTaskHistoryPages(client, current => ({ ...current, pages: current.pages.map(p => ({ ...p, tasks: [{ id: "pending" }, ...p.tasks] })) }));
    expect(client.getQueryData<typeof page>(historyKey)?.pages[0].tasks.map(t => t.id)).toEqual(["pending", "matching"]);
    expect(client.getQueryData<typeof page>(finderKey)?.pages[0].tasks.map(t => t.id)).toEqual(["matching"]);
    client.clear();
  });
  it("does not reuse stale local-source pages on reopening after a local edit", async () => {
    const client = new QueryClient();
    let title = "Before edit";
    const options = taskFinderQueryOptions({ enabled: true, currentDate: "2026-11-11", filters: { search: "", status: "all", from: "", to: "" },
      source: async () => ({ tasks: [{ id: "1", title }], totalCount: 1, nextCursor: null }),
    });
    const first = new InfiniteQueryObserver(client, options);
    const stop = first.subscribe(() => {}); await first.refetch(); stop();
    await new Promise(resolve => setTimeout(resolve, 10));
    title = "After edit";
    const second = new InfiniteQueryObserver(client, options);
    expect(second.getCurrentResult().data).toBeUndefined();
    const stopSecond = second.subscribe(() => {}); await second.refetch();
    expect(second.getCurrentResult().data?.pages[0].tasks[0].title).toBe("After edit");
    stopSecond(); client.clear();
  });
  it("isolates every filter under the history prefix and disables closed reads", () => {
    const filters = { search: "needle", status: "overdue" as const, from: "2026-11-01", to: "2026-11-11" };
    const a = taskFinderQueryOptions({ enabled: false, currentDate: "2026-11-11", filters });
    expect(a.enabled).toBe(false);
    expect(a.queryKey.slice(0, 3)).toEqual(["work-os", "task-history", "finder"]);
    expect(a.queryKey).not.toEqual(taskFinderQueryOptions({ enabled: true, currentDate: "2026-11-11", filters: { ...filters, status: "all" } }).queryKey);
    expect(a.initialPageParam).toBeNull();
    expect(a.queryKey).not.toEqual(taskFinderQueryOptions({ enabled: true, currentDate: "2026-11-11", scope: "other-workspace", filters }).queryKey);
  });
  it("aborts an obsolete filter read instead of putting it in the new result", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const filters = { search: "", status: "all" as const, from: "", to: "" };
    let aborted = false;
    const observer = new InfiniteQueryObserver(client, taskFinderQueryOptions({ enabled: true, currentDate: "2026-11-11", filters,
      source: async (_filters, _cursor, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => { aborted = true; reject(new DOMException("Aborted", "AbortError")); });
      }),
    }));
    const unsubscribe = observer.subscribe(() => {});
    observer.setOptions(taskFinderQueryOptions({ enabled: true, currentDate: "2026-11-11", filters: { ...filters, search: "new" },
      source: async () => ({ tasks: [{ id: "new" }], totalCount: 1, nextCursor: null }),
    }));
    await observer.refetch();
    expect(aborted).toBe(true);
    expect(observer.getCurrentResult().data?.pages[0].tasks).toEqual([{ id: "new" }]);
    unsubscribe(); client.clear();
  });
});

describe("activityIntervalDecisionBody", () => {
  it("echoes the review version, including zero for an unreviewed recap", () => {
    expect(JSON.parse(JSON.stringify(activityIntervalDecisionBody("confirm", undefined, 0))))
      .toEqual({ action: "confirm", expectedReviewVersion: 0 });
  });

  it("sends amended words with the reviewed version", () => {
    expect(JSON.parse(JSON.stringify(activityIntervalDecisionBody("amend", "I only read the queue.", 2))))
      .toEqual({ action: "amend", feedback: "I only read the queue.", expectedReviewVersion: 2 });
  });

  it("stays compatible with older servers that expose no review version", () => {
    expect(activityIntervalDecisionBody("confirm")).toEqual({ action: "confirm" });
    expect(activityIntervalDecisionBody("confirm", undefined, undefined)).not.toHaveProperty("expectedReviewVersion");
  });

  it("never sends an invalid number or the generation revision field", () => {
    for (const value of [-1, 1.5, Number.NaN]) {
      expect(activityIntervalDecisionBody("confirm", undefined, value)).toEqual({ action: "confirm" });
    }
    const body = activityIntervalDecisionBody("confirm", undefined, 3);
    expect(body).not.toHaveProperty("revision");
    expect(body.expectedReviewVersion).toBe(3);
  });
});

describe("latestActivityIntervalUrl", () => {
  it("reads the owner-scoped latest recap and pending count", () => {
    expect(latestActivityIntervalUrl()).toBe("/api/work-os/me/activity-intervals/latest");
    expect(workOsKeys.activityIntervalLatest()).toEqual(["work-os", "activity-intervals", "latest"]);
  });
});

describe("openTaskCountUrl", () => {
  it("asks for one row with exact counts, excluding My day", () => {
    const url = openTaskCountUrl("2026-11-04");
    expect(url).toContain("view=open&limit=1");
    expect(url).toContain("excludeToday=true");
    expect(url).toContain("date=2026-11-04");
    expect(openTaskCountUrl()).not.toContain("date=");
  });
});

describe("dashboardInsightsUrl", () => {
  it("asks for the bounded Today summary instead of the full seven-day report", () => {
    expect(dashboardInsightsUrl("2026-11-04")).toBe("/api/work-os/me/insights?range=7d&summary=1&through=2026-11-04");
  });
});

describe("activityIntervalsUrl", () => {
  it("waits long enough for a recap that is still analysing screenshots", () => {
    expect(ACTIVITY_INTERVAL_ENSURE_TIMEOUT_MS).toBe(180_000);
  });

  it("asks for one bounded page on the first request", () => {
    expect(activityIntervalsUrl("2026-09-28", null))
      .toBe(`/api/work-os/me/activity-intervals?date=2026-09-28&days=30&limit=${ACTIVITY_INTERVALS_PAGE_SIZE}`);
  });

  it("carries the keyset cursor for the next contiguous page", () => {
    const next = activityIntervalsUrl("2026-09-28", "2026-09-28T15:17:00.000Z|interval-1");
    expect(next).toContain("limit=12");
    expect(next).toContain(`cursor=${encodeURIComponent("2026-09-28T15:17:00.000Z|interval-1")}`);
  });
});
