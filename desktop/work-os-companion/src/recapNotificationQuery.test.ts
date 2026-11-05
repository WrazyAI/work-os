import { QueryObserver, type InfiniteData } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { createWorkOsQueryClient, workOsKeys } from "./queryClient";
import { activityIntervalNotificationOptions } from "./workOsQueries";
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
