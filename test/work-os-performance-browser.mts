import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { spawn } from "node:child_process";
import { chromium, type Browser, type Page } from "playwright";
import { applyDayScenario, applyOnboardingScenario, DEFAULT_DEBUG_SCENARIO, insightsFixture } from "../desktop/work-os-companion/src/scenarios.ts";

// Real App, hooks, QueryClient, delivery controller and API client. Only HTTP
// transport is synthetic. No StrictMode totals are claimed as production totals.
const port = 14319;
let browser: Browser;
let server: ReturnType<typeof spawn>;
before(async () => {
  server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: new URL("../desktop/work-os-companion/", import.meta.url), stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error("Vite did not start")), 30_000);
    server.stdout!.on("data", (bytes) => { if (String(bytes).includes("Local:")) { clearTimeout(deadline); resolve(); } });
    server.once("exit", (code) => { clearTimeout(deadline); reject(new Error(`Vite exited ${code}`)); });
  });
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); server?.kill(); });

async function boot(role: "admin" | "employee", mapped = true) {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    localStorage.setItem("work-os.workspace-mode", "admin");
    // No auto-open guides; the page itself is the subject, not guide playback.
    window.matchMedia = ((query: string) => ({ matches: query.includes("reduced-motion"), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as any;
  });
  const scenario = { ...DEFAULT_DEBUG_SCENARIO, enabled: true, onboardingState: "complete" as const, dayState: "optional" as const };
  const day = applyDayScenario(null, scenario)!;
  day.access = { ...day.access, organizationId: "org-perf", personId: "person-perf", role } as any;
  const profile = applyOnboardingScenario(null, scenario)!;
  const paths: string[] = [];
  await context.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    paths.push(url.pathname + url.search);
    const path = url.pathname;
    let body: unknown = {};
    if (path.endsWith("/session")) body = { userId: "user-perf", organizationId: "org-perf", personId: mapped ? "person-perf" : null, role, featureFlags: {}, organization: { name: "Performance fixture" } };
    else if (path.endsWith("/otto/context")) body = { scope: { userId: "user-perf", organizationId: "org-perf", mode: "admin" }, personId: mapped ? "person-perf" : null, displayName: "Performance Admin", avatarUrl: null, voiceAvailable: false, transcriptionAvailable: false };
    else if (path.includes("/otto/inbox")) body = { items: [], unread: 0, nextCursor: null };
    else if (path.includes("/otto/delivery")) body = { claimed: [], leased: [], eventIds: [] };
    else if (path.endsWith("/me/day")) body = day;
    else if (path.endsWith("/me/onboarding")) body = profile;
    else if (path.endsWith("/me/workday")) body = { ...day, tasks: undefined, taskHistory: undefined, workspaceSummary: undefined, evidence: undefined, proposals: undefined };
    else if (path.endsWith("/me/insights")) {
      const insights = insightsFixture(day, "7d");
      body = path.includes("summary=1") ? { range: "7d", from: insights.from, through: insights.through, days: insights.days.map(({ date, tasksCompleted }) => ({ date, tasksCompleted })), consistency: insights.consistency } : { ...insights, freshness: { ...insights.freshness, stale: false, staleAt: null } };
    }
    else if (path.endsWith("/me/tasks")) body = { tasks: [], nextCursor: null, totalCount: 0, counts: { total: 0, open: 0, completed: 0, overdue: 0 } };
    else if (path.endsWith("/me/activity-intervals")) body = { intervals: [], date: day.shiftDate, nextCursor: null, total: 0 };
    else if (path.endsWith("/me/memory")) body = { facts: [], activities: [] };
    else if (path.endsWith("/eod/outstanding")) body = { days: [] };
    else if (path.endsWith("/eod/screenshots")) body = { hours: [], frames: [], pending: 0 };
    else if (path.endsWith("/me/guides")) body = { seen: ["day", "tasks", "review", "insights", "settings", "admin_overview"], autoOpen: false };
    else if (path.endsWith("/attendance/observe")) body = { changed: false, attendance: day.attendance, session: day.session };
    else if (path.endsWith("/admin/overview")) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic Overview unavailable" }) });
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ schemaVersion: 1, asOf: new Date().toISOString(), cursor: { next: null }, ...(body as object) }) });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  const assets: string[] = [];
  page.on("request", (request) => { if (!request.url().includes("/api/")) assets.push(request.url()); });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/?token=synthetic-performance-token`, { timeout: 90_000 });
  await page.getByRole("heading", { name: role === "admin" ? "Overview" : "My Day", exact: true }).waitFor({ timeout: 60_000 }).catch(async (error) => {
    console.log("boot failed", { paths, errors, body: (await page.locator("body").innerText()).slice(0, 2500) });
    throw error;
  });
  return { context, page, paths, errors, assets };
}

test("employee startup does not load avatar or admin page modules", async () => {
  const h = await boot("employee");
  try {
    assert(!h.assets.some((url) => url.includes("/src/AvatarApp.tsx")), "avatar root should be a separate startup branch");
    assert(!h.assets.some((url) => url.includes("/src/admin/OverviewPage.tsx")), "hidden admin pages must not load at employee startup");
    assert(!h.paths.some((path) => path.includes("/admin/otto") || path.includes("/admin/overview")), "ordinary employees never start admin services");
  } finally { await h.context.close(); }
});

test("mapped admin cold boot does not load hidden employee screens", async () => {
  const h = await boot("admin");
  try {
    await h.page.waitForTimeout(3_000);
    console.log("mapped-admin requests", h.paths);
    const hidden = h.paths.filter((path) => /\/me\/(day|insights|tasks|onboarding|eod\/screenshots)(\?|$)/.test(path))
      .filter((path) => !path.includes("view=open&limit=1"));
    assert.deepEqual(hidden, []);
    assert(h.paths.some((path) => path.includes("view=open&limit=1")), "the bell keeps a lightweight exact count");
    assert(h.paths.some((path) => path.includes("/me/memory")), "personal notifications remain enabled");
    assert.deepEqual(h.errors, []);
  } finally { await h.context.close(); }
});

test("returning to Admin stops reads retained by heavier employee tabs", async () => {
  const h = await boot("admin");
  try {
    const switchToEmployee = h.page.getByRole("button", { name: "Switch to employee view", exact: true });
    await switchToEmployee.click();
    await h.page.getByRole("heading", { name: "My Day", exact: true }).waitFor();
    for (const label of ["Tasks", "EOD Review", "Insights", "My Day"]) {
      await h.page.getByRole("button", { name: label, exact: true }).click();
      await h.page.waitForTimeout(250);
    }
    await h.page.getByRole("button", { name: "Tasks", exact: true }).click();
    await h.page.getByRole("button", { name: "Previous day", exact: true }).click();
    await h.page.waitForTimeout(500);
    await h.page.getByRole("button", { name: "Administration", exact: true }).click({ force: true });
    await h.page.getByRole("heading", { name: "Overview", exact: true }).waitFor();
    const start = h.paths.length;
    await h.page.waitForTimeout(3_000);
    const hidden = h.paths.slice(start).filter((path) => /\/me\/(day|insights|tasks|onboarding|eod\/screenshots|report)(\?|$)/.test(path))
      .filter((path) => !path.includes("view=open&limit=1"));
    console.log("admin-return hidden requests", hidden);
    assert.deepEqual(hidden, []);
    await h.page.getByRole("button", { name: "Switch to employee view", exact: true }).click();
    await h.page.getByRole("button", { name: "My Day", exact: true }).click();
    await h.page.getByRole("heading", { name: "My Day", exact: true }).waitFor();
    assert.deepEqual(h.errors, []);
  } finally { await h.context.close(); }
});

test("unmapped admin starts no personal day reads and cannot enter onboarding", async () => {
  const h = await boot("admin", false);
  try {
    await h.page.waitForTimeout(2_500);
    const personal = h.paths.filter((path) => /\/me\/(day|onboarding|insights|tasks|eod\/screenshots)(\?|$)/.test(path))
      .filter((path) => !path.includes("view=open&limit=1"));
    assert.deepEqual(personal, []);
    assert.equal(await h.page.getByRole("button", { name: "Switch to employee view", exact: true }).count(), 0);
    assert.equal(await h.page.getByRole("heading", { name: /setup/i }).count(), 0);
    assert.deepEqual(h.errors, []);
  } finally { await h.context.close(); }
});

test("idle mascot heartbeats do not restart main fallback recap delivery", async () => {
  const h = await boot("admin");
  try {
    // Retain real employee state, then exercise fallback ownership in Admin.
    await h.page.getByRole("button", { name: "Switch to employee view", exact: true }).click();
    await h.page.getByRole("heading", { name: "My Day", exact: true }).waitFor();
    await h.page.getByRole("button", { name: "Administration", exact: true }).click();
    await h.page.getByRole("heading", { name: "Overview", exact: true }).waitFor();
    await h.page.waitForTimeout(3_000);
    const before = h.paths.filter((path) => path.includes("/otto/inbox")).length;
    for (let index = 0; index < 2; index++) {
      await h.page.evaluate(async () => {
        const { emit } = await import("/src/tauriEvents.ts" as string);
        const { workOsQueryClient } = await import("/src/queryClient.ts" as string);
        // Scope is the actual mascot scope resolved by App, not a copied guess.
        const day: any = workOsQueryClient.getQueryData(["work-os", "day", "compact"]);
        const scope = day ? `org-perf/${day.access.personId}/${day.shiftDate}` : "";
        const now = Date.now();
        await emit("work-os://mascot-activity", { window: "avatar", scope, activity: "idle", sentAt: now, expiresAt: now + 20_000 });
      });
      await h.page.waitForTimeout(300);
    }
    const after = h.paths.filter((path) => path.includes("/otto/inbox")).length;
    console.log("heartbeat inbox requests", { before, after });
    assert.equal(after - before, 0);
  } finally { await h.context.close(); }
});
