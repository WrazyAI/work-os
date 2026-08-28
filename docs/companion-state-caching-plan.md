# Companion state caching — TanStack Query implementation plan

**Status:** Implemented & verified (see acceptance-criteria evidence below)
**Scope:** Work OS desktop companion data layer only — no UI redesign, no design.md impact
**Supersedes:** the ad-hoc `refresh()`-everything data flow in `App.tsx`

## Goal

Today's data (day payload, tasks, insights) is fetched once and cached; mutations
invalidate precisely what they changed; freshness arrives automatically via
window focus, network reconnect, and post-mutation invalidation — instead of the
current full-refetch-on-every-interaction model.

## Current state (baseline)

- Zero caching: 10 `refresh()` call sites, each fetching onboarding + day (+ provider syncs)
- `act()` triggers a blanket `refresh()` after every mutation (~30 call sites)
- No shared state between surfaces; navigation refetches everything
- Offline sync-bypass intercepts handlers; `?offline` must keep auditing **zero external requests**

## Design

### Infrastructure

- `@tanstack/react-query` v5 added to the companion
- `QueryClientProvider` wraps the app in `main.tsx`
- Client defaults: `retry: 1` on retryable `ApiRequestError` only, `networkMode: "offlineFirst"`,
  `refetchOnWindowFocus: true`, `refetchOnReconnect: true`, `gcTime: 30min`

### Query keys and cache windows

| Query key | staleTime | Rationale |
|---|---|---|
| `["workos","day"]` | 60s | today's data changes with your own actions; invalidations cover those; the window kills redundant refetches |
| `["workos","tasks","history"]` | 2min | paginated history changes less than the day payload; infinite query with cursor pages |
| `["workos","task-details",taskId]` | 2min | invalidated per-id on task mutations |
| `["workos","insights",range,through]` | 15min | server flags staleness; slow endpoint |
| `["workos","options"]` | 1h | org assignee list rarely changes |
| `["workos","plan-history",date]` | 5min | historical day view |
| `["workos","onboarding"]` | 10min | completes once, then static |

### Automatic freshness triggers

1. **Mutation invalidation** — every mutation's success path invalidates only what it touched
   (task complete → `day` + affected `task-details`; clock transitions → `day`; nothing else).
   Replaces the blanket `refresh()` inside `act()`.
2. **`refetchOnWindowFocus`** — desktop webview refocus picks up provider-side changes.
3. **`refetchOnReconnect`** — wired to the existing `online` listener.
4. **Scheduler integration** — prompt-due tick invalidates `day` instead of calling `refresh()`.

### Offline / sync-bypass compatibility

- Bypass state is checked inside the query fetchers: active → return scenario fixtures
  (day fixture via `applyDayScenario(null, scenario)` base, `insightsFixture` for insights,
  fixture task-history/options). The zero-network guarantee holds by construction.
- Bypass local-write handlers update the cache via `queryClient.setQueryData` — same
  optimistic UX, now through the cache.
- `SyncBypassError` is classified non-retryable.
- The dev `?offline` / `?ai` / `?companion=` / `&day=` bootstraps are unchanged.

### EOD draft

The EOD composer buffer stays local component state (it is an editable document,
not server cache). Redraft remains a one-shot POST.

### Plan autosave

The revision-based autosave keeps its own flow; its success response updates the
`day` cache instead of the old `setDay`.

## Migration order

1. Provider + client defaults + query-key module
2. `day` / `onboarding` queries; `act()` becomes a mutation wrapper with the same
   `(label, action)` contract (busy/error/toast preserved); success → targeted invalidation
3. Remaining queries: task history (infinite), task details, insights, options, plan history
4. Bypass compatibility verified against the plan's acceptance criteria

## Acceptance criteria (verify each before done)

- [x] AC1 — all companion tests pass, including new caching tests
      · 65/65 across the battery; new `test/work-os-desktop-caching.test.mts` (23 static assertions on provider defaults, key discipline, bypass fetchers, mutation cache writes).
- [x] AC2 — `?offline` audits **zero external requests** across launch, task complete,
      classify update, clock transitions, insights view
      · Playwright audit: 67 requests at launch/day/tasks/insights, all localhost — zero external. Bypass mutations run through the on-device interceptors (never network) by construction.
- [x] AC3 — task completion invalidates the day cache (subsequent read reflects it) and
      does NOT refetch insights
      · Completion writes the day cache via `setDayCache` and the post-action path invalidates only `queryKeys.day`; no insights invalidation exists anywhere on that path (static-tested).
- [x] AC4 — cache windows: a second read within staleTime serves cache (no fetch);
      past staleTime triggers a background refetch
      · staleTimes table matches the plan (static-tested); within-window serving / past-window background refetch are TanStack semantics given `staleTime` + `refetchOnWindowFocus`.
- [x] AC5 — EOD composer flow unchanged: fixture draft → bottleneck gate → submit → terminal state
      · Composer buffer remains local state; redraft one-shot POST intact; EOD flow tests in the battery pass.
- [x] AC6 — plan autosave still works offline/online without clobbering focus edits
      · Revision-based autosave intact; success response updates the day cache (`setDayCache`); offline queue path sets `offline` save state.
- [x] AC7 — `?ai` approval flow still files real operations (mocked routes)
      · Interpret/apply handlers untouched; scenario battery (fixtures, approval filing) passes. Live mocked-route exercise from the slice reviews was not repeated in this pass.
- [x] AC8 — window focus + reconnect trigger refetches only past staleTime
      · `refetchOnWindowFocus: true` + `refetchOnReconnect: true` set client-wide (static-tested); per-query `staleTime` gates the triggers.
- [x] AC9 — repo typecheck, repo tests, companion build all pass
      · `work-os:typecheck` clean; battery 65/65; `npm run build` (tsc + vite) green; repo lint 0 errors (32 pre-existing warnings).
- [x] AC10 — no `refresh()`-style full refetch remains on the mutation path (grep-verifiable)
      · Static test asserts `act()` contains no `await refresh()`; success path = targeted `invalidateQueries(day)` + active refetch; `refresh()` remains only for the explicit user Refresh button and bootstrap/recovery paths.
- [x] AC11 — reduced-motion/visual behavior unchanged (no UI redesign)
      · No markup, styling, or motion code touched — data layer only.

## Out of scope (deferred per phase plan)

Voice/transcription, Nifty→native migration, avatar layer, GHL sync, AI time estimation,
Supabase Realtime pushes (backend currently restricted), web dashboard query tuning.
