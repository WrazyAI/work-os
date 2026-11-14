import { InfiniteQueryObserver, QueryObserver } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { createWorkOsQueryClient, workOsKeys } from "./queryClient";
import { applyMemoryReviewToCaches, memoryFactsQueryOptions, memoryQueryOptions, requestMemoryFactPage } from "./workOsQueries";
vi.mock("./vault", () => ({ secureState: { session: async () => ({ token: "fixture", apiBase: "https://fixture.invalid", organizationId: "org", expiresAt: "2099-01-01" }) } }));
afterEach(() => vi.unstubAllGlobals());

it("pages saved memories independently and invalidates both lanes after a decision", async () => {
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    urls.push(url);
    const params = new URL(url).searchParams;
    const status = params.get("status");
    return Response.json({ facts: [{ id: `${status}-${params.get("cursor") ?? "first"}`, review_status: status }], total: 2,
      nextCursor: params.has("cursor") ? null : "next" });
  });
  const client = createWorkOsQueryClient();
  const saved = new InfiniteQueryObserver(client, memoryFactsQueryOptions("confirmed", false));
  const proposed = new InfiniteQueryObserver(client, memoryFactsQueryOptions("candidate", false));
  const off = [saved.subscribe(() => undefined), proposed.subscribe(() => undefined)];
  try {
    await saved.refetch();
    await proposed.refetch();
    await saved.fetchNextPage();
    expect(saved.getCurrentResult().data?.pages.flatMap(page => page.facts).map(fact => fact.id)).toEqual(["confirmed-first", "confirmed-next"]);
    expect(proposed.getCurrentResult().data?.pages).toHaveLength(1);
    expect(urls.filter(url => url.includes("status=candidate"))).toHaveLength(1);
    await client.invalidateQueries({ queryKey: workOsKeys.memory(), refetchType: "none" });
    expect(client.getQueryState([...workOsKeys.memory(), "facts", "confirmed"])?.isInvalidated).toBe(true);
    expect(client.getQueryState([...workOsKeys.memory(), "facts", "candidate"])?.isInvalidated).toBe(true);
  } finally { off.forEach(stop => stop()); client.clear(); }
});

it("a summary refresh updates loaded fact pages, including arrivals and external removals", async () => {
  let generation = 0;
  vi.stubGlobal("fetch", async (url: string) => new URL(url).searchParams.has("status")
    ? Response.json({ facts: [{ id: `saved-${generation}`, review_status: "confirmed" }], total: 1, nextCursor: null })
    : Response.json({ facts: [], recent: [], factTotals: { confirmed: 1, candidate: 0 } }));
  const client = createWorkOsQueryClient();
  const saved = new InfiniteQueryObserver(client, memoryFactsQueryOptions("confirmed", true));
  const off = saved.subscribe(() => undefined);
  try {
    await saved.refetch();
    expect(saved.getCurrentResult().data?.pages[0].facts[0].id).toBe("saved-0");
    generation = 1;
    const summary = new QueryObserver(client, memoryQueryOptions({ enabled: false }, client));
    await summary.refetch();
    await vi.waitFor(() => expect(saved.getCurrentResult().data?.pages[0].facts[0].id).toBe("saved-1"));
  } finally { off(); client.clear(); }
});

it("retry after an exhausted collection refresh fails actually makes a new request", async () => {
  let fail = false;
  let calls = 0;
  vi.stubGlobal("fetch", async () => {
    calls++;
    if (fail) return Response.json({ error: "Read unavailable" }, { status: 500 });
    return Response.json({ facts: [{ id: "saved", review_status: "confirmed" }], total: 1, nextCursor: null });
  });
  const client = createWorkOsQueryClient();
  const observer = new InfiniteQueryObserver(client, { ...memoryFactsQueryOptions("confirmed", false), retry: false });
  try {
    await observer.refetch();
    fail = true;
    await observer.refetch();
    expect(observer.getCurrentResult().isRefetchError).toBe(true);
    fail = false;
    const before = calls;
    await requestMemoryFactPage(observer.getCurrentResult());
    expect(calls).toBe(before + 1);
    expect(observer.getCurrentResult().isError).toBe(false);
  } finally { client.clear(); }
});

it("a confirmed save remains moved out of proposals when revalidation fails", async () => {
  const client = createWorkOsQueryClient();
  const fact = { id: "kept", content: "Review migrations first", review_status: "candidate" as const, fact_key: null, local_date: null, occurred_at: "2026-11-13T00:00:00Z" };
  const other = { ...fact, id: "other" };
  const proposedKey = [...workOsKeys.memory(), "facts", "candidate"];
  const savedKey = [...workOsKeys.memory(), "facts", "confirmed"];
  client.setQueryData(proposedKey, { pages: [{ facts: [fact, other], total: 2, nextCursor: null }], pageParams: [null] });
  client.setQueryData(savedKey, { pages: [{ facts: [], total: 0, nextCursor: null }], pageParams: [null] });
  client.setQueryData(workOsKeys.memory(), { facts: [fact, other], recent: [], factTotals: { confirmed: 0, candidate: 2 } });
  try {
    applyMemoryReviewToCaches(client, fact, "confirmed");
    // A failed background read keeps cached data: it must already carry the receipt.
    const proposed = new InfiniteQueryObserver(client, { ...memoryFactsQueryOptions("candidate", false), retry: false,
      queryFn: async () => { throw new Error("offline"); } });
    await proposed.refetch();
    expect(proposed.getCurrentResult().data?.pages[0].facts.map(row => row.id)).toEqual(["other"]);
    expect(proposed.getCurrentResult().data?.pages[0].total).toBe(1);
    expect(client.getQueryData<{ pages: Array<{ facts: typeof fact[]; total: number }> }>(savedKey)?.pages[0].facts[0]).toMatchObject({ id: fact.id, review_status: "confirmed" });
    expect(client.getQueryData<{ factTotals: unknown }>(workOsKeys.memory())?.factTotals).toEqual({ confirmed: 1, candidate: 1 });
    applyMemoryReviewToCaches(client, other, "rejected");
    expect(client.getQueryData<{ pages: Array<{ facts: unknown[] }> }>(proposedKey)?.pages[0].facts).toEqual([]);
  } finally { client.clear(); }
});

it("memory page requests retain a deadline as well as query cancellation", async () => {
  const deadlines: number[] = [];
  const signals: AbortSignal[] = [];
  const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => {
    deadlines.push(ms); return new AbortController().signal;
  });
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    signals.push(init.signal as AbortSignal);
    return Response.json({ facts: [], total: 0, nextCursor: null });
  });
  const client = createWorkOsQueryClient();
  try {
    await client.fetchInfiniteQuery(memoryFactsQueryOptions("confirmed", false));
    expect(deadlines).toContain(20_000);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
  } finally { timeout.mockRestore(); client.clear(); }
});
