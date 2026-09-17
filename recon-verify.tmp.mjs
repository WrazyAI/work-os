import { chromium } from "playwright";

const BASE = "http://127.0.0.1:1430";
const results = [];
const consoleErrors = [];

function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(`${message.text()} (${page.url()})`);
});
page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

const headers = () => page.$$eval(".sort-header-cell", (cells) => cells.map((cell) => {
  const button = cell.querySelector("button");
  const label = cell.querySelector(".sort-header-label");
  return {
    key: cell.getAttribute("data-sort-key"),
    pressed: button?.getAttribute("aria-pressed"),
    accessible: button?.getAttribute("aria-label") ?? "",
    cellHidden: getComputedStyle(cell).display === "none",
    labelHidden: label ? getComputedStyle(label).display === "none" : true,
  };
}));
const rowTitles = (selector) => page.$$eval(selector, (nodes) => nodes.map((node) => node.textContent.trim()));
const notes = () => page.$$eval(".task-record-section-head small", (nodes) => nodes.map((node) => node.textContent.trim()));
const clickHeader = async (label) => {
  await page.locator(`.sort-header-cell button[aria-label^="${label}"]`).click();
  await page.waitForTimeout(120);
};

// ── Tasks workspace, All view, wide ──
await page.setViewportSize({ width: 1440, height: 980 });
await page.goto(`${BASE}/?preview-tasks&view=all`, { waitUntil: "networkidle" });
await page.waitForSelector(".sort-header-row");
await page.screenshot({ path: "/tmp/opencode/recon-tasks-all-default.png", fullPage: true });

let state = await headers();
const statusHeader = state.find((cell) => cell.key === "status");
record("default sort is Status ascending and pressed", statusHeader?.pressed === "true" && statusHeader?.accessible.startsWith("Status, sorted ascending"), JSON.stringify(statusHeader));
record("inactive columns announce what they will apply", state.find((cell) => cell.key === "due")?.accessible === "Sort by due, ascending.", state.find((cell) => cell.key === "due")?.accessible);

let titles = await rowTitles(".task-record h3");
record("default order: overdue, soonest-due open, undated last, completed last", JSON.stringify(titles) === JSON.stringify(["Review provider sync failures", "Ship unified Tasks workspace", "Document desktop release evidence", "Remove Plan navigation"]), JSON.stringify(titles));
let sectionNotes = await notes();
record("sections name their order", sectionNotes.includes("Oldest due first") && sectionNotes.includes("Latest activity first") && sectionNotes.includes("Latest completion first"), JSON.stringify(sectionNotes));

const chipText = await page.$$eval(".agenda-strip-chip", (nodes) => nodes.map((node) => node.textContent.trim()));
record("chips count the rows they head", chipText.join("|") === "My day2|Unfinished2|Completed1|All tasks4", chipText.join("|"));

await clickHeader("Sort by task");
titles = await rowTitles(".task-record h3");
record("Task ascending reorders inside the group", JSON.stringify(titles) === JSON.stringify(["Review provider sync failures", "Document desktop release evidence", "Ship unified Tasks workspace", "Remove Plan navigation"]), JSON.stringify(titles));
await page.screenshot({ path: "/tmp/opencode/recon-tasks-title-asc.png", fullPage: true });

await clickHeader("Task, sorted ascending");
titles = await rowTitles(".task-record h3");
record("Task descending reverses inside the group", JSON.stringify(titles) === JSON.stringify(["Review provider sync failures", "Ship unified Tasks workspace", "Document desktop release evidence", "Remove Plan navigation"]), JSON.stringify(titles));

await clickHeader("Task, sorted descending");
sectionNotes = await notes();
record("third activation restores the default order", (await headers()).find((cell) => cell.key === "status")?.pressed === "true" && sectionNotes.includes("Oldest due first"), JSON.stringify(sectionNotes));

await clickHeader("Status, sorted ascending");
titles = await rowTitles(".task-record h3");
record("Status descending leads with completed work", JSON.stringify(titles) === JSON.stringify(["Remove Plan navigation", "Ship unified Tasks workspace", "Document desktop release evidence", "Review provider sync failures"]), JSON.stringify(titles));
record("Status descending is announced", (await headers()).find((cell) => cell.key === "status")?.accessible.startsWith("Status, sorted descending"), "");
await page.screenshot({ path: "/tmp/opencode/recon-tasks-status-desc.png", fullPage: true });
await clickHeader("Status, sorted descending");
sectionNotes = await notes();
record("Status restores on the third activation", JSON.stringify(sectionNotes) === JSON.stringify(["Oldest due first", "Latest activity first", "Latest completion first"]), JSON.stringify(sectionNotes));

// Activity is descending-first and cycles through ascending.
await clickHeader("Sort by activity");
record("Activity starts latest-first", (await headers()).find((cell) => cell.key === "activity")?.accessible.startsWith("Activity, sorted descending"), (await headers()).find((cell) => cell.key === "activity")?.accessible);
await clickHeader("Activity, sorted descending");
record("Activity toggles to oldest-first", (await headers()).find((cell) => cell.key === "activity")?.accessible.startsWith("Activity, sorted ascending"), "");
await clickHeader("Activity, sorted ascending");

// ── Tasks workspace, Unfinished view, wide ──
await page.goto(`${BASE}/?preview-tasks&view=unfinished`, { waitUntil: "networkidle" });
await page.waitForSelector(".sort-header-row");
titles = await rowTitles(".task-record h3");
const unfinishedChips = await page.$$eval(".agenda-strip-chip", (nodes) => nodes.map((node) => node.textContent.trim()));
record("unfinished view leads with overdue and matches its chip", JSON.stringify(titles) === JSON.stringify(["Review provider sync failures", "Document desktop release evidence"]) && unfinishedChips.includes("Unfinished2"), JSON.stringify(titles));
await page.screenshot({ path: "/tmp/opencode/recon-tasks-unfinished-wide.png", fullPage: true });

// ── Dashboard, active day, wide, with an optimistic row ──
await page.goto(`${BASE}/?preview-today&pending=syncing`, { waitUntil: "networkidle" });
await page.waitForSelector(".active-task-list .sort-header-row");
const overdueCopy = (await page.locator(".overdue-metric").innerText()).replace(/\s+/g, " ").trim().toLowerCase();
record("dashboard overdue metric matches strict overdue across tabs", overdueCopy === "4 overdue tasks", overdueCopy);
const ringLabel = await page.locator(".hero-metric-button").getAttribute("aria-label");
const todayTab = await page.locator('.active-task-tabs button[aria-selected="true"]').innerText();
record("ring, label, and Today tab count every rendered row", ringLabel.includes("of 4 tasks done today") && todayTab.includes("4"), `${ringLabel} | ${todayTab}`);
const dashboardNote = (await page.locator(".active-task-sort-note").innerText()).trim();
record("dashboard names its active order", dashboardNote === "Sorted by Overdue first, then due date", dashboardNote);
titles = await rowTitles(".active-task-copy strong");
record("dashboard default puts pending first and completed last", JSON.stringify(titles) === JSON.stringify(["Draft the onboarding checklist", "Finalize the active workday experience", "Verify the progress update conversation", "Review responsive task states"]), JSON.stringify(titles));
await page.screenshot({ path: "/tmp/opencode/recon-today-pending.png", fullPage: true });
await clickHeader("Status, sorted ascending");
titles = await rowTitles(".active-task-copy strong");
record("dashboard status descending leads with completed", titles[0] === "Review responsive task states", JSON.stringify(titles));
record("dashboard note follows the sort", (await page.locator(".active-task-sort-note").innerText()).trim() === "Sorted by Completed first, then due date", "");
await page.screenshot({ path: "/tmp/opencode/recon-today-status-desc.png", fullPage: true });

// Off-shift dashboard renders an optimistic add exactly once.
await page.goto(`${BASE}/?preview-today&preview-state=pre-shift&pending=syncing`, { waitUntil: "networkidle" });
await page.waitForSelector(".dashboard-task-grid");
const pendingCards = await page.$$eval(".dashboard-task-grid .dashboard-task-card, .dashboard-task-grid article", (nodes) => nodes.filter((node) => node.textContent.includes("Draft the onboarding checklist")).length);
record("optimistic add renders once in the dashboard top tasks", pendingCards === 1, `cards=${pendingCards}`);

// ── Narrow layouts ──
await page.setViewportSize({ width: 420, height: 900 });
await page.goto(`${BASE}/?preview-tasks&view=unfinished`, { waitUntil: "networkidle" });
await page.waitForSelector(".sort-header-row");
state = await headers();
record("narrow keeps every sort control labelled", state.length === 5 && state.every((cell) => !cell.cellHidden && !cell.labelHidden), JSON.stringify(state.map((cell) => [cell.key, cell.cellHidden, cell.labelHidden])));
const overflow = await page.evaluate(() => {
  const panel = document.querySelector(".task-list-panel");
  return panel ? panel.scrollWidth - panel.clientWidth : -1;
});
record("narrow tasks panel has no horizontal overflow", overflow <= 1, `overflow=${overflow}px`);
await page.screenshot({ path: "/tmp/opencode/recon-tasks-unfinished-narrow.png", fullPage: true });

await page.goto(`${BASE}/?preview-today&preview-state=pre-shift`, { waitUntil: "networkidle" });
const dayOverflow = await page.evaluate(() => {
  const grid = document.querySelector(".dashboard-task-grid");
  return grid ? grid.scrollWidth - grid.clientWidth : -1;
});
record("narrow day view has no horizontal overflow", dayOverflow <= 1, `overflow=${dayOverflow}px`);
await page.screenshot({ path: "/tmp/opencode/recon-today-narrow.png", fullPage: true });

record("no console or page errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

await browser.close();
const failed = results.filter((result) => !result.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
