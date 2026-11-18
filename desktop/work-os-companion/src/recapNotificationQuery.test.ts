import { QueryObserver, type InfiniteData } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { createWorkOsQueryClient, isPersistedQueryKey, workOsKeys } from "./queryClient";
import { activityIntervalNotificationOptions, fetchLatestActivityInterval, latestActivityIntervalOptions } from "./workOsQueries";
import type { ActivityIntervalsData } from "./types";
vi.mock("./vault", () => ({ secureState: { session: async () => ({ token: "fixture", apiBase: "https://fixture.invalid", organizationId: "org", expiresAt: "2099-01-01" }) } }));
afterEach(() => vi.unstubAllGlobals());

it("refreshes one live recap page without touching three loaded history pages", async () => {
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => { urls.push(url); return Response.json({ intervals: [], total: 36, date: "2026-11-04", nextCursor: "next" }); });
  const client = createWorkOsQueryClient();
  const history: InfiniteData<ActivityIntervalsData> = { pages: [0, 1, 2].map(() => ({ intervals: [], total: 36, date: "2026-11-04", nextCursor: "next" }) as any), pageParams: [null, "one", "two"] };
  client.setQueryData(workOsKeys.activityIntervals("2026-11-04"), history);
  const observer = new QueryObserver(client, { ...activityIntervalNotificationOptions({ date: "2026-11-04", enabled: false, pollMs: 60_000 }) });
  const off = observer.subscribe(() => undefined);
  await observer.refetch();
  expect(urls).toHaveLength(1);
  expect(urls[0]).not.toContain("cursor=");
  expect(client.getQueryData(workOsKeys.activityIntervals("2026-11-04"))).toBe(history);
  off(); client.clear();
});

it("both notice observers read latest without touching three history pages", async () => {
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => { urls.push(url); return Response.json({ interval: null, pendingCount: 0, scope: { organizationId: "org", personId: "person" } }); });
  const scope = { organizationId: "org", personId: "person" };
  for (const window of ["main", "avatar"]) {
    const client = createWorkOsQueryClient();
    const history = { pages: [{ intervals: [] }, { intervals: [] }, { intervals: [] }], pageParams: [null, "one", "two"] };
    client.setQueryData(workOsKeys.activityIntervals("2026-11-12"), history);
    const options = latestActivityIntervalOptions({ scope, enabled: false, pollMs: 60_000 });
    const observer = new QueryObserver(client, options);
    const stop = observer.subscribe(() => {});
    await observer.refetch();
    expect(client.getQueryData(workOsKeys.activityIntervals("2026-11-12")), window).toBe(history);
    expect(isPersistedQueryKey(options.queryKey)).toBe(false);
    stop(); client.clear();
  }
  expect(urls).toHaveLength(2);
  expect(urls.every(url => url.endsWith("/activity-intervals/latest"))).toBe(true);
});

it("scope changes cannot reuse or display a late previous-account response", async () => {
  let release!: (value: Response) => void;
  vi.stubGlobal("fetch", async () => new Promise<Response>(resolve => { release = resolve; }));
  const client = createWorkOsQueryClient();
  const a = { organizationId: "org", personId: "a" }, b = { organizationId: "other", personId: "b" };
  const observer = new QueryObserver(client, latestActivityIntervalOptions({ scope: a, enabled: false }));
  const stop = observer.subscribe(() => {});
  const pending = observer.refetch();
  await new Promise(resolve => setTimeout(resolve, 0));
  observer.setOptions(latestActivityIntervalOptions({ scope: b, enabled: false }));
  expect(observer.getCurrentResult().data).toBeUndefined();
  release(Response.json({ interval: { id: "private-a" }, pendingCount: 9 }));
  await pending;
  expect(observer.getCurrentResult().data).toBeUndefined();
  expect(latestActivityIntervalOptions({ scope: null, enabled: true }).enabled).toBe(false);
  stop(); client.clear();
});

it("a latest read refuses a different organization before sending the request", async () => {
  let requests = 0;
  vi.stubGlobal("fetch", async () => { requests++; return Response.json({ interval: null, pendingCount: 0 }); });
  await expect(fetchLatestActivityInterval(undefined, { organizationId: "different-org", personId: "person" })).rejects.toThrow(/workspace/i);
  expect(requests).toBe(0);
});

it("same-organization credentials cannot cache another person's latest under an old key", async () => {
  vi.stubGlobal("fetch", async () => Response.json({ interval: { id: "private-b" }, pendingCount: 1, scope: { organizationId: "org", personId: "b" } }));
  await expect(fetchLatestActivityInterval(undefined, { organizationId: "org", personId: "a" })).rejects.toThrow(/workspace|identity/i);
});
