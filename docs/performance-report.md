**Your suspicion is partly correct: substantial employee data work stays active while Admin is open.** The reverse behaves differently: switching to Employee unmounts the Admin page and stops its page polling, although some admin notification services remain active.

I also found several concrete performance problems beyond the view split: unnecessary cache saves, repeated background requests, oversized “compact” responses, eager pagination, and expensive dashboard queries. **The strongest recent regression candidate is the new seven-day Insights request added to Today on November 3**, compounded by an existing data-loading path that reads far more tasks than the screen needs.

I inspected `WrazyAI/work-os` at [`e47a92c`](https://github.com/WrazyAI/work-os/commit/e47a92cba13cdd0f045992862fb1d02ddee29285), compared the relevant code with the latest published companion release, [0.5.20](https://github.com/WrazyAI/work-os/releases/tag/work-os-companion-internal-v0.5.20), and checked the corresponding backend sources in Agent OS. I built the desktop frontend and reproduced the behaviors below using the actual application code with synthetic data. The relevant problems are present in the release code.

**These are confirmed sources of unnecessary work. Their exact contribution to the slowdown on your machine still needs a native CPU/memory profile and live database timings.**

## 1. Employee data loading really does continue inside Admin

The central problem is the bootstrap gate:

```ts
personalBootstrapEnabled: mapped && !blocked
```

For an admin account linked to an employee record, that remains enabled regardless of the selected workspace. Many employee queries use this flag without also checking whether Employee is visible. [Bootstrap gate](https://github.com/WrazyAI/work-os/blob/e47a92cba13cdd0f045992862fb1d02ddee29285/desktop/work-os-companion/src/adminOtto/bootstrap.ts#L108-L124)

I mounted the actual App in a React DOM test environment, opened Administration, and inspected both intercepted requests and active query subscriptions.

**With Administration visibly open, nine personal query families were active:**

| Personal data loaded | Needed for the visible Admin page? |
|---|---|
| Compact employee day | Some shared status may be useful; the full response is excessive |
| Employee onboarding/profile | Useful when personal settings need it |
| Employee task history | No visible employee task-history screen |
| Entire open-task backlog | A notification count does not require every task |
| Seven-day personal Insights | Employee Today is hidden |
| Screenshot-gallery metadata | Employee EOD gallery is hidden |
| Outstanding EODs | Used by shared personal notifications |
| Memory/review candidates | Used by shared personal notifications |
| Activity/recap intervals | Used by shared personal notifications |

The screenshot request is for **metadata**, so this finding does not mean every screenshot image is being downloaded. The enabling conditions are in [the App’s query declarations](https://github.com/WrazyAI/work-os/blob/e47a92cba13cdd0f045992862fb1d02ddee29285/desktop/work-os-companion/src/App.tsx#L1746-L1835).

During a 65-second virtual-time observation with Admin open, employee day, memory, recap intervals, and attendance observation all made another request, alongside the Admin Overview refresh. This establishes that employee work is actively running.

### The behavior is asymmetric

| Situation | What I verified |
|---|---|
| Mapped admin using Admin | Employee data queries remain active alongside Admin |
| Same account switches to Employee | Admin Overview loses its observer and stops polling |
| Ordinary employee account | Personal queries run; admin requests do not start |
| Admin without an employee mapping | Personal day queries stay disabled |

After clicking the real **“Switch to employee view”** button, Admin Overview went from **one observer to zero**, and the next 65 seconds contained no Overview request. The code conditionally mounts one workspace and one admin section at a time. [Admin section mounting](https://github.com/WrazyAI/work-os/blob/e47a92cba13cdd0f045992862fb1d02ddee29285/desktop/work-os-companion/src/admin/AdminWorkspace.tsx#L104-L116)

There is another complication: the selected employee tab survives workspace switching. If you visit employee Tasks or Review and then return to Admin, additional employee queries can remain enabled because their conditions check the retained employee tab rather than the visible workspace. [Detail-query conditions](https://github.com/WrazyAI/work-os/blob/e47a92cba13cdd0f045992862fb1d02ddee29285/desktop/work-os-companion/src/App.tsx#L1365-L1376)

**Recommended correction:** separate the small amount of shared notification/status data from employee page data. Gate page queries by the active workspace and visible tab, and load personal settings when needed.

## 2. A recent change adds an expensive Insights request to startup

The November 3 Today redesign added `dashboardInsightsQuery`. It requests seven-day personal Insights when the retained employee view is `"day"`—the default—even while Admin is visible. [Introducing commit](https://github.com/WrazyAI/work-os/commit/fa43cbea05090e6fe5e4dd8029416892a610e15e) · [Current caller](https://github.com/WrazyAI/work-os/blob/e47a92cba13cdd0f045992862fb1d02ddee29285/desktop/work-os-companion/src/App.tsx#L1806-L1811)

That small dashboard summary triggers substantial backend work:

- It reads up to **2,500 organization tasks**, including full task rows and project data.
- It loads task events across the current and previous comparison periods.
- It hydrates assignee information **before filtering tasks to the employee**.
- It constructs **14 daily projections**: seven for the displayed week and seven for the comparison week. [Insights implementation](https://github.com/WrazyAI/work-os/blob/e47a92cba13cdd0f045992862fb1d02ddee29285/src/lib/work-os-insights.ts#L262-L306) · [Current and previous period projections](https://github.com/WrazyAI/work-os/blob/e47a92cba13cdd0f045992862fb1d02ddee29285/src/lib/work-os-insights.ts#L380-L385)

Running the actual route, authentication code, data helpers, and SQL builder against a fixture database produced **20 SQL statements with warm module caches**, plus those 14 projections. That is a reproduced query count, **not a production latency measurement**.

This is a strong explanation for a recent increase in startup work: an existing expensive endpoint is now called automatically by a commonly opened screen, including when that screen is hidden behind Admin.

**Recommended correction:** first restrict it to the visible employee Today screen and defer it until essential day data is ready. Then provide a smaller dashboard summary or narrow the server reads before task hydration.

## 3. “Compact day” does not actually bound the expensive work

This is the most significant underlying data-loading problem I found.

The compact endpoint asks for 24 tasks, but the backend first:

1. Reads up to **2,500 organization tasks**.
2. Reads the organization’s task events for the day.
3. Hydrates assignees across the fetched task set.
4. Filters employee attribution in JavaScript.
5. Builds the daily projection.
6. Applies filtering, sorting, and finally the 24-task page limit.

The page limit comes **after** the broad read and processing. [Daily workspace implementation](https://github.com/WrazyAI/work-os/blob/e47a92cba13cdd0f045992862fb1d02ddee29285/src/lib/work-os-daily-workspace.ts#L349-L455)

### The response can still contain thousands of tasks

There is a separate payload problem: `carryOverGroups` includes full records for overdue tasks. The compact page limit applies to the main task array, but not to these groups. [Carry-over construction](https://github.com/WrazyAI/work-os/blob/e47a92cba13cdd0f045992862fb1d02ddee29285/src/lib/work-os-daily-workspace.ts#L309-L322)

I reproduced this with 2,500 overdue synthetic tasks, each with roughly a 1 KB description:

| Result | Measured in the fixture |
|---|---:|
| Tasks in the main paginated array | 0 |
| Tasks inside carry-over groups | **2,500** |
| Serialized compact response | **4,671,096 bytes**, about **4.67 MB** |

That is not your actual response size. It proves that requesting a compact day does **not** guarantee a compact payload.

This matters because the day is refreshed repeatedly, processed in the frontend, and included in the persisted query cache. A large backlog can therefore increase server work, response size, client processing, and cache serialization together.

### The endpoint also repeats context reads

The warm fixture route issued **29 SQL statements**. Its trace included repeated timezone, schedule, schedule-exception, daily-plan, organization-policy, and related reads.

There is also a serial tail: `getWorkday()` starts only after the workspace/report block finishes, then loads overlapping inputs again. [Day endpoint assembly](https://github.com/WrazyAI/work-os/blob/e47a92cba13cdd0f045992fb1d02ddee29285/src/lib/work-os-day-view.ts#L24-L86)

**Recommended correction:**

- Resolve eligible employee task IDs before fetching full rows and hydrating identities.
- Return carry-over counts and a bounded page with minimal fields.
- Reuse request-scoped timezone, schedule, policy, and plan inputs.
- Move independent reads off the serial response path.

The workday helper can also perform state transitions, so this should be a deliberate refactor that preserves workday behavior. Simply caching the whole response or parallelizing every call would need care.

## 4. Routine renders cause unnecessary cache saves—and sometimes extra admin requests

This is a concrete client-side amplification problem.

### Cache persistence runs on every query-cache event

The persistence subscription responds to **all** query-cache events, including observer-option changes. After a 2.5-second debounce, it serializes the entire eligible successful cache and calls `saveQueryCache`. It does not first establish that persisted data changed. [Persistence subscription](https://github.com/WrazyAI/work-os/blob/e47a92cba13cdd0f045992862fb1d02ddee29285/desktop/work-os-companion/src/queryClient.ts#L80-L100)

I reproduced both of these cases:

- Five observer-option changes with identical query data → **five cache-save calls**.
- Two updates to admin queries—which are excluded from the saved cache → **two saves of unchanged employee cache data**.

The native save path encodes the cache into the Stronghold store and calls `stronghold.save()`. That makes this relevant to serialization and storage work, although I did not measure native disk cost here. [Vault write path](https://github.com/WrazyAI/work-os/blob/e47a92cba13cdd0f045992862fb1d02ddee29285/desktop/work-os-companion/src/vault.ts#L128-L131)

### Normal mascot heartbeats trigger the chain

The mascot sends an activity heartbeat every eight seconds. Receiving a valid heartbeat stores a new React state object, even when the reported activity is still idle. [Heartbeat implementation](https://github.com/WrazyAI/work-os/blob/e47a92cba13cdd0f045992862fb1d02ddee29285/desktop/work-os-companion/src/useMascotRuntime.ts#L92-L119)

In the actual App harness, two idle heartbeat events produced:

| Change | Observed delta |
|---|---:|
| Query-data update events | **0** |
| Query-result update events | **0** |
| Observer-option update events | **42** |
| Cache-save calls | **2** |
| Admin inbox GET requests | **2** |
| Admin delivery-claim POST requests | **2** |

The inbox behavior has a specific scope: **this test exercised the main window as recap-delivery owner**, which is the fallback when the avatar is unavailable. It does not establish the same extra traffic while the avatar owns delivery.

The cause is identifiable: a callback depends on the whole query-result object; another callback depends on that callback; the delivery effect depends on the second callback. An unrelated render can therefore restart the controller, whose startup immediately polls the inbox. [Callback dependency](https://github.com/WrazyAI/work-os/blob/e47a92cba13cdd0f045992862fb1d02ddee29285/desktop/work-os-companion/src/App.tsx#L865-L900) · [Delivery effect and immediate poll](https://github.com/WrazyAI/work-os/blob/e47a92cba13cdd0f045992862fb1d02ddee29285/desktop/work-os-companion/src/App.tsx#L1605-L1669)

**Recommended correction:** persist only when eligible persisted data changes, coalesce writes, and keep delivery-controller subscriptions stable across unrelated renders. This is a focused fix with a clear reproduction.

## 5. Admin Overview itself does a large amount of work every minute

Even after fixing the hidden employee workload, the visible Admin Overview deserves optimization.

Its source assembles:

- **33 direct database reads**.
- **10 additional reads** for organization readiness.
- **One more read** when active teams require membership data.

That is **43–44 application-level database reads per Overview request**, before authentication, embedded-relation hydration, or cold metadata queries. This figure is a source-derived count, not a measured production SQL trace. [Overview assembly](https://github.com/WrazyAI/work-os/blob/e47a92cba13cdd0f045992862fb1d02ddee29285/src/lib/work-os-admin-overview.ts#L162-L301)

The readiness calculation reloads people, memberships, teams, schedules, configuration, and **every unfinished task**. That task read has no row limit and includes task-completeness text fields. The backend then makes multiple JavaScript passes to count missing fields. [Readiness reads](https://github.com/WrazyAI/work-os/blob/e47a92cba13cdd0f045992862fb1d02ddee29285/src/lib/work-os-readiness-report.ts#L13-L28)

This entire assembly repeats on the Overview’s **60-second poll** while active. The database pool defaults to **16 connections**, so the fan-out can queue and compete with employee/background requests. Actual production pool configuration and contention remain unmeasured. [Overview polling](https://github.com/WrazyAI/work-os/blob/e47a92cba13cdd0f045992862fb1d02ddee29285/desktop/work-os-companion/src/admin/OverviewPage.tsx#L52-L62) · [Pool configuration](https://github.com/WrazyAI/work-os/blob/e47a92cba13cdd0f045992862fb1d02ddee29285/src/lib/db/pool.ts#L14-L22)

**Recommended correction:** give readiness/configuration its own refresh lifecycle, invalidate it when setup changes, calculate completeness and chart totals with SQL aggregates, and consolidate overlapping reads. Keep exact totals separate from capped detail lists so optimization does not introduce undercounting.

## 6. Pagination is undermined in two places

### The backlog automatically fetches every page

`fetchTaskBacklog()` walks up to **40 sequential pages of 50 tasks**. Because the query is enabled during personal bootstrap, this can happen before the Tasks screen is opened—and while Admin is visible. [Backlog loader](https://github.com/WrazyAI/work-os/blob/e47a92cba13cdd0f045992862fb1d02ddee29285/desktop/work-os-companion/src/workOsQueries.ts#L147-L180)

The actual loader reproduced:

| Synthetic backlog | HTTP calls | Maximum concurrency |
|---|---:|---:|
| 120 tasks | 3 | 1 |
| 2,100 tasks | 40, stopping at the safety cap | 1 |

This converts pagination into a serial “download the backlog” operation. **It is not a 40-request-per-minute timer**; the cost occurs when that query fetches or refetches.

### Recap polling refetches previously loaded history pages

The notification bell shares an infinite query with the recap-history screen. The bell only uses the first page, but once the user loads additional pages, a refetch reloads those pages too.

Using the actual query options and installed query observer, I seeded three pages and triggered a refetch: **three API calls**, even though the bell only needs the newest recap. That shared query is configured to poll every minute. [Shared recap query](https://github.com/WrazyAI/work-os/blob/e47a92cba13cdd0f045992862fb1d02ddee29285/desktop/work-os-companion/src/workOsQueries.ts#L278-L303) · [Bell consumption](https://github.com/WrazyAI/work-os/blob/e47a92cba13cdd0f045992862fb1d02ddee29285/desktop/work-os-companion/src/App.tsx#L1818-L1827)

**Recommended correction:** demand-load backlog pages, provide lightweight counts, and separate the live notification query from paginated recap history.

## 7. Multiple native windows duplicate work and increase startup cost

The native configuration creates three windows: main, avatar, and an initially hidden debugger. All three receive flags disabling browser background throttling. [Window configuration](https://github.com/WrazyAI/work-os/blob/e47a92cba13cdd0f045992862fb1d02ddee29285/desktop/work-os-companion/src-tauri/tauri.conf.json#L10-L54)

There are overlapping data responsibilities:

- The main window polls employee day data and watches attendance.
- The avatar independently refreshes session/day data and watches attendance.
- These are separate webviews with separate JavaScript query-client instances.
- The avatar’s raw timers do not gate day refreshes on visibility. [Avatar polling and attendance](https://github.com/WrazyAI/work-os/blob/e47a92cba13cdd0f045992862fb1d02ddee29285/desktop/work-os-companion/src/AvatarApp.tsx#L1182-L1199)

Some React Query intervals pause when the document is hidden, so **I would not claim every query runs continuously in every hidden-window state**. The raw timer paths are a separate issue.

The background-throttling flags were added on October 19 to allow voice/transcription work to finish. The fix should preserve that requirement while reducing background page work. [Voice/backgrounding change](https://github.com/WrazyAI/work-os/commit/430127f6ef2ded25642e843bd9a3846e3050d3aa)

Startup also loads a broad bundle. The production frontend build produced approximately **1.54 MB of JavaScript and 697 KB of CSS** across the main entry and shared assets. Main and avatar are imported together, and admin screens are eagerly imported. This is a secondary startup/memory optimization opportunity; the build size alone does not establish the cause of severe slowness. [Main entry imports](https://github.com/WrazyAI/work-os/blob/e47a92cba13cdd0f045992862fb1d02ddee29285/desktop/work-os-companion/src/main.tsx#L1-L4)

**Recommended correction:** use one owner for shared attendance/day monitoring, distribute small updates to the windows, create the debugger on demand, and split avatar/admin code into appropriate bundles.

## Why it may have become worse recently

The broad employee workload and oversized day projection are older problems. Recent changes add load to those paths:

- **November 2:** assignee hydration was added before employee filtering in broad task-loading paths. [Task/companion change](https://github.com/WrazyAI/work-os/commit/c25a48dadb5960e85ff1b7fb2f4ce4eb4c71a038)
- **November 3:** Today began requesting seven-day Insights automatically. This is the clearest recent addition to normal startup work.
- **October 28:** the callback/dependency chain involved in the main-window recap-controller restart entered the code.
- **October 19:** background-throttling flags were added for voice completion.

My assessment is that **recent features are amplifying existing over-fetching and lifecycle problems**. Growing task and recap histories can further increase the cost. I have not established one commit as the sole cause of your reported slowdown.

## Fix order I recommend

| Priority | Change | Purpose |
|---|---|---|
| **First** | Gate employee page queries by workspace/tab; defer dashboard Insights | Remove substantial work immediately when its screen is hidden |
| **First** | Persist only changed data; stabilize recap-delivery effects | Stop repeated saves and render-triggered requests |
| **First** | Bound compact-day payloads and narrow task reads before hydration | Reduce work paid by every day refresh |
| Next | Separate Admin readiness from minute polling; aggregate in SQL | Reduce dashboard database load |
| Next | Give shared monitoring one window/service owner | Remove duplicate day/attendance activity |
| Next | Make backlog loading demand-driven; separate recap notifications/history | Keep loading proportional to what the user opens |
| Afterward | Split bundles and create the debugger on demand | Reduce startup and resident-resource overhead |

### Verification and remaining limits

The investigation included a successful production frontend build, **31 passing focused existing tests**, **five passing targeted reproduction tests**, the actual React App lifecycle harness, and actual backend routes running against an intercepted database transport.

The React lifecycle tests ran in **jsdom**, so they establish mounting, requests, timers, and cache behavior—not native rendering performance. The remaining measurements are a release-build CPU/memory profile, real response sizes, database query plans, and pool-wait timings while switching workspaces and hiding windows.

**No application source was changed, merged, deployed, or released.** The investigation produced specific, reproducible fix targets; the first three priorities above are the strongest starting point.
