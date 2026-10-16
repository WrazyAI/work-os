import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  QueryClient,
  QueryObserver,
  environmentManager,
  focusManager,
  hashKey,
} from "@tanstack/react-query";
import { ADMIN_DETAIL_STALE_MS, ADMIN_STALE_MS, adminKeys } from "./data";
import { createWorkOsQueryClient, isPersistedQueryKey } from "../queryClient";

/**
 * The administration workspace reads the organization's record, and every one
 * of those reads is served from the shared in-memory TanStack cache: switching
 * sections within the stale window shows the cached record immediately, a
 * stale remount revalidates in the background while the cached record stays on
 * screen, and the Overview snapshot is the one deliberate poll. These tests
 * bind the option contract (behavior through a QueryObserver with mocked
 * fetchers) to the page sources (a static guard over every `useQuery` under
 * `src/admin/`), because the pages themselves cannot be mounted in the node
 * test environment.
 */

const ADMIN_DIR = import.meta.dirname;

/** Every page source under `src/admin/` (no tests): the files that declare
 * administration queries. */
function adminPageSources(): Array<{ path: string; text: string }> {
  return readdirSync(ADMIN_DIR)
    .filter((name) => (name.endsWith(".tsx") || name.endsWith(".ts")) && !name.includes(".test."))
    .sort()
    .map((name) => ({ path: `admin/${name}`, text: readFileSync(resolve(ADMIN_DIR, name), "utf8") }));
}

/** The full source text of every `useQuery(...)` call expression — with or
 * without a generic — found by matching parentheses so each option set stays
 * one unit. `useQueryClient(` never matches. */
export function useQueryCalls(source: string): string[] {
  const calls: string[] = [];
  const pattern = /useQuery\s*(?:<[^>]*>\s*)?\(/g;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    const open = match.index + match[0].length - 1;
    let depth = 0;
    let end = open;
    for (; end < source.length; end += 1) {
      if (source[end] === "(") depth += 1;
      if (source[end] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    calls.push(source.slice(match.index, end + 1));
    pattern.lastIndex = end + 1;
  }
  return calls;
}

describe("administration source contract", () => {
  it("gives every administration query an explicit staleTime", () => {
    const missing: string[] = [];
    let queried = 0;
    for (const { path, text } of adminPageSources()) {
      for (const call of useQueryCalls(text)) {
        queried += 1;
        if (!/staleTime\s*:/.test(call)) missing.push(`${path}: ${call.slice(0, 80)}`);
      }
    }
    expect(queried).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });

  it("keeps the Overview poll the only interval, deliberate and foreground-only", () => {
    const intervalCalls: Array<{ path: string; call: string }> = [];
    for (const { path, text } of adminPageSources()) {
      for (const call of useQueryCalls(text)) {
        if (/refetchInterval\s*:/.test(call)) intervalCalls.push({ path, call });
      }
    }
    expect(intervalCalls.map((entry) => entry.path)).toEqual(["admin/OverviewPage.tsx"]);
    const [poll] = intervalCalls;
    expect(poll.call).toMatch(/staleTime:\s*30_000/);
    expect(poll.call).toMatch(/refetchInterval:\s*60_000/);
    // The poll pauses while the window is hidden instead of fetching unseen
    // snapshots: TanStack skips the tick unless `refetchIntervalInBackground`.
    expect(poll.call).toMatch(/refetchIntervalInBackground:\s*false/);
    for (const { path, text } of adminPageSources()) {
      expect(text, `${path} must not poll in the background`).not.toContain("refetchIntervalInBackground: true");
    }
  });

  it("keys administration reads structurally, so rebuilt filter objects stay one cache entry", () => {
    // Pages rebuild their filter object every render; TanStack hashes objects
    // by sorted keys, so insertion order must never fork the cache entry.
    expect(hashKey(adminKeys.tasks({ filter: "open", personId: "", projectId: "", limit: "200", completed: "false" })))
      .toBe(hashKey(adminKeys.tasks({ completed: "false", filter: "open", limit: "200", personId: "", projectId: "" })));
    expect(hashKey(adminKeys.evidence({ personId: "", source: "", from: "2026-10-01", to: "2026-10-16", correction: "", summary: "1", limit: "100" })))
      .toBe(hashKey(adminKeys.evidence({ limit: "100", summary: "1", correction: "", to: "2026-10-16", from: "2026-10-01", source: "", personId: "" })));
  });

  it("keeps the app client's revalidation defaults and the admin persistence exclusion", () => {
    const defaults = createWorkOsQueryClient().getDefaultOptions().queries;
    expect(defaults?.staleTime).toBe(60_000);
    expect(defaults?.gcTime).toBe(30 * 60_000);
    expect(defaults?.retry).toBe(1);
    expect(defaults?.refetchOnWindowFocus).toBe(true);
    expect(defaults?.refetchOnReconnect).toBe(true);
    // Administration reads belong to the workspace record, not this device's
    // employee session: they stay in memory and out of the on-disk cache.
    expect(isPersistedQueryKey(adminKeys.overview("2026-10-16"))).toBe(false);
    expect(isPersistedQueryKey(adminKeys.people())).toBe(false);
    expect(isPersistedQueryKey(adminKeys.person("p-1"))).toBe(false);
    expect(isPersistedQueryKey(["work-os", "day", "compact"])).toBe(true);
  });
});

/** One deferred result, so a test can hold a response open and watch what the
 * cache serves while the fetch is in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

type PeoplePayload = { people: Array<{ id: string }> };

function peopleObserver(
  client: QueryClient,
  queryFn: () => Promise<PeoplePayload>,
): QueryObserver<PeoplePayload, Error, PeoplePayload, readonly unknown[]> {
  return new QueryObserver<PeoplePayload, Error, PeoplePayload, readonly unknown[]>(client, {
    queryKey: adminKeys.people(),
    staleTime: ADMIN_STALE_MS,
    queryFn,
  });
}

describe("administration query caching", () => {
  // The test environment has no window, which TanStack treats as a server:
  // observers then never arm stale/interval timers. Production is a browser,
  // so the harness runs observers the way the app does.
  beforeAll(() => environmentManager.setIsServer(() => false));
  afterAll(() => environmentManager.setIsServer(() => true));
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fetches once on first mount and serves the cache when a section comes back inside the stale window", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    let fetches = 0;
    const queryFn = () => {
      fetches += 1;
      return Promise.resolve({ people: [{ id: "p-1" }] });
    };

    const first = peopleObserver(client, queryFn);
    const unmount = first.subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetches).toBe(1);
    expect(first.getCurrentResult().data).toEqual({ people: [{ id: "p-1" }] });

    // Switch sections: the observer goes away, the cache entry stays.
    unmount();
    await vi.advanceTimersByTimeAsync(ADMIN_STALE_MS - 5_000);

    const second = peopleObserver(client, queryFn);
    const unmountSecond = second.subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    // One shared cache entry: the remount renders the record with no request.
    expect(fetches).toBe(1);
    expect(second.getCurrentResult().data).toEqual({ people: [{ id: "p-1" }] });
    expect(second.getCurrentResult().isStale).toBe(false);
    unmountSecond();
  });

  it("revalidates a stale remount in the background while the cached record stays on screen", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    let fetches = 0;
    const fresh: PeoplePayload = { people: [{ id: "p-1" }] };
    const refreshed: PeoplePayload = { people: [{ id: "p-1" }, { id: "p-2" }] };
    const held = deferred<PeoplePayload>();
    let hold = false;
    const queryFn = () => {
      fetches += 1;
      return hold ? held.promise : Promise.resolve(fresh);
    };

    const first = peopleObserver(client, queryFn);
    const unmount = first.subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetches).toBe(1);
    unmount();

    await vi.advanceTimersByTimeAsync(ADMIN_STALE_MS + 1);
    hold = true;
    const second = peopleObserver(client, queryFn);
    const unmountSecond = second.subscribe(() => undefined);
    // The stale entry is served immediately; the refetch runs behind it.
    expect(fetches).toBe(2);
    const during = second.getCurrentResult();
    expect(during.data).toEqual(fresh);
    expect(during.isFetching).toBe(true);
    expect(during.isLoading).toBe(false);

    held.resolve(refreshed);
    await vi.advanceTimersByTimeAsync(0);
    const after = second.getCurrentResult();
    expect(after.data).toEqual(refreshed);
    expect(after.isFetching).toBe(false);
    unmountSecond();
  });

  it("runs the Overview-style interval only while the window is focused", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    let polls = 0;
    // The page's 60s value lands at the same contract; a short interval keeps
    // the test to fake-timer milliseconds instead of a real minute.
    const poll = new QueryObserver(client, {
      queryKey: adminKeys.overview("2026-10-16"),
      queryFn: () => {
        polls += 1;
        return Promise.resolve({});
      },
      staleTime: 30_000,
      refetchInterval: 25,
      refetchIntervalInBackground: false,
    });
    const unsubscribe = poll.subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(polls).toBe(1);

    // The delay is injected as 25ms; the poll behavior is TanStack's, and the
    // static guard above pins the page's own 60_000/30_000 values.
    await vi.advanceTimersByTimeAsync(25);
    expect(polls).toBe(2);

    // Hidden window: ticks keep firing, but the observer skips them.
    focusManager.setFocused(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(polls).toBe(2);

    // Visible again: the interval resumes.
    focusManager.setFocused(true);
    await vi.advanceTimersByTimeAsync(25);
    expect(polls).toBe(3);

    unsubscribe();
    focusManager.setFocused(true);
  });

  it("keeps the detail TTL longer than the list TTL, as the pages declare", () => {
    expect(ADMIN_STALE_MS).toBe(45_000);
    expect(ADMIN_DETAIL_STALE_MS).toBe(60_000);
    expect(ADMIN_DETAIL_STALE_MS).toBeGreaterThan(ADMIN_STALE_MS);
  });
});
