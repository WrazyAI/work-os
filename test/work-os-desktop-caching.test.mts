import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../desktop/work-os-companion");
const read = (relativePath: string) => readFileSync(resolve(root, relativePath), "utf8");

const queryClient = read("src/queryClient.ts");
const main = read("src/main.tsx");
const app = read("src/App.tsx");
const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };

// Provider wiring
assert.match(main, /QueryClientProvider/);
assert.match(main, /queryClient/);

// Client defaults per the caching plan
assert.match(queryClient, /networkMode: "offlineFirst"/);
assert.match(queryClient, /refetchOnWindowFocus: true/);
assert.match(queryClient, /refetchOnReconnect: true/);
assert.match(queryClient, /gcTime: 30 \* 60_000/);
assert.match(queryClient, /isSyncBypassActive\(\)\) return false/);
assert.match(queryClient, /failure\.retryable && failureCount < 1/);

// Cache windows match the plan table
assert.match(queryClient, /day: 60_000/);
assert.match(queryClient, /taskHistory: 2 \* 60_000/);
assert.match(queryClient, /taskDetails: 2 \* 60_000/);
assert.match(queryClient, /insights: 15 \* 60_000/);
assert.match(queryClient, /options: 60 \* 60_000/);
assert.match(queryClient, /planHistory: 5 \* 60_000/);
assert.match(queryClient, /onboarding: 10 \* 60_000/);

// Canonical keys are used by the queries (no ad-hoc key arrays in App.tsx)
assert.match(app, /queryKey: queryKeys\.day/);
assert.match(app, /queryKey: queryKeys\.onboarding/);
assert.match(app, /queryKey: queryKeys\.insights\(/);
assert.match(app, /queryKey: queryKeys\.taskHistory/);
assert.match(app, /queryKey: queryKeys\.options/);
assert.match(app, /useInfiniteQuery/);
// The only ad-hoc root key allowed is the logout cache wipe; queries use the helpers
assert.equal((app.match(/queryKey: \["workos"\]/g) ?? []).length, 1);
assert.match(app, /removeQueries\(\{ queryKey: \["workos"\] \}\)/);

// Zero-network by construction: every query fetcher checks the bypass first
const dayQueryFn = app.slice(app.indexOf("const dayQuery = useQuery"), app.indexOf("const onboardingQuery = useQuery"));
assert.match(dayQueryFn, /if \(isSyncBypassActive\(\)\) return dayFixture\(\)/);
const insightsQueryFn = app.slice(app.indexOf("const insightsQuery = useQuery"), app.indexOf("const taskHistoryQuery = useInfiniteQuery"));
assert.match(insightsQueryFn, /isSyncBypassActive\(\)\) return insightsFixture/);

// Mutations write the cache instead of blanket-refreshing
assert.match(app, /setDayCache/);
assert.match(app, /queryClient\.setQueryData\(queryKeys\.onboarding/);
assert.match(app, /queryClient\.removeQueries\(\{ queryKey: \["workos"\] \}\)/);
assert.match(app, /invalidateQueries\(\{ queryKey: queryKeys\.day \}\)/);

// The post-action path is targeted: act() must not blanket-refresh
const actBody = app.slice(app.indexOf("async function act("), app.indexOf("async function act(") + 6000);
assert.doesNotMatch(actBody, /await refresh\(\)/);

// User-initiated provider sync keeps parallel refetches
assert.match(app, /Promise\.allSettled/);

// Dependency is declared
assert.ok(pkg.dependencies["@tanstack/react-query"]);

console.log("work-os-desktop-caching: all assertions passed");
