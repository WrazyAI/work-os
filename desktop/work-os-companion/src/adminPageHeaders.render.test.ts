import { createElement, type ReactElement } from "react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { NotificationProvider } from "./NotificationFlyouts";
import { seedAdminFixtures } from "./admin/adminFixtures";
import EvidencePage from "./admin/EvidencePage";
import InsightsPage from "./admin/InsightsPage";
import PeoplePage from "./admin/PeoplePage";
import ReviewPage from "./admin/ReviewPage";
import TasksPage from "./admin/TasksPage";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readText = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

function renderPage(page: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seedAdminFixtures(client, "dense");
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(NotificationProvider, null, page)),
  );
}

/** The card that owns a title, sliced out of the page markup. */
function cardOf(markup: string, title: string) {
  const at = markup.indexOf(title);
  expect(at, `card title not found: ${title}`).toBeGreaterThan(-1);
  const start = markup.lastIndexOf("<section", at);
  const end = markup.indexOf("</section>", at);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return markup.slice(start, end);
}

/** The card's first row: its title marker up to the controls band it leads. */
function titleRow(card: string) {
  const start = card.indexOf("admin-card-title");
  const end = card.indexOf("admin-card-controls");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return card.slice(start, end);
}

/** The card's controls band: its controls marker up to the body it precedes. */
function controlsBand(card: string) {
  const start = card.indexOf("admin-card-controls");
  const end = card.indexOf("admin-card-body");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return card.slice(start, end);
}

function expectCleanTitleRow(card: string, title: string) {
  const row = titleRow(card);
  expect(row).toContain(title);
  // No filter, input, or action may ride the title row: the name and its
  // one-line detail own it (design.md §2.2 quiet top).
  expect(row).not.toMatch(/<(button|input|select|textarea)\b/);
  expect(row).not.toContain('role="group"');
  expect(row).not.toContain('role="button"');
  expect(row).not.toContain('role="tablist"');
}

describe("administration page headers", () => {
  it("keeps the review queue's title row text-only, status on its own row, filters below", () => {
    const markup = renderPage(createElement(ReviewPage, {}));
    const card = cardOf(markup, "Review queue");
    expectCleanTitleRow(card, "Review queue");
    const controls = controlsBand(card);
    expect(controls).toContain('aria-label="Report status"');
    expect(controls).toContain('aria-label="Filter by person"');
    expect(controls).toContain('aria-label="Reports from date"');
    expect(controls).toContain('aria-label="Reports to date"');
    // The status views own their row; the person and date pair share the next
    // one, with the dates travelling as a single group.
    const rows = controls.split('class="admin-controls"').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('aria-label="Report status"');
    expect(rows[0]).not.toContain('aria-label="Filter by person"');
    expect(rows[1]).toContain('aria-label="Filter by person"');
    expect(rows[1]).toContain('aria-label="Reports from date"');
    expect(rows[1]).toContain('aria-label="Reports to date"');
  });

  it("keeps the task record's views and search on one controls row and its selects plus action on the next", () => {
    const markup = renderPage(createElement(TasksPage, {}));
    const card = cardOf(markup, "Organization tasks");
    expectCleanTitleRow(card, "Organization tasks");
    const controls = controlsBand(card);
    const rows = controls.split('class="admin-controls"').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('aria-label="Task filter"');
    expect(rows[0]).toContain('aria-label="Search tasks"');
    expect(rows[0]).not.toContain('aria-label="Filter by person"');
    expect(rows[1]).toContain('aria-label="Filter by person"');
    expect(rows[1]).toContain('aria-label="Filter by project"');
    // The primary action is the last thing on the row and keeps its is-end
    // marker so wide widths right-align it.
    expect(rows[1]).toContain('class="admin-controls-group is-end"');
    expect(rows[1].indexOf('aria-label="Filter by project"')).toBeLessThan(rows[1].indexOf("Add task"));
  });

  it("keeps the roster's search, role, and attendance filters grouped under the title", () => {
    const markup = renderPage(createElement(PeoplePage, {}));
    const card = cardOf(markup, "Roster");
    expectCleanTitleRow(card, "Roster");
    const controls = controlsBand(card);
    expect(controls).toContain('aria-label="Search people"');
    expect(controls).toContain('aria-label="Filter by role profile"');
    expect(controls).toContain('aria-label="Filter by attendance"');
    // One row, filters before the attendance views.
    expect(controls.split('class="admin-controls"').slice(1)).toHaveLength(1);
    expect(controls.indexOf('aria-label="Search people"')).toBeLessThan(controls.indexOf('aria-label="Filter by attendance"'));
  });

  it("keeps the insights brief's range, person, and overdue chip in one controls row", () => {
    const markup = renderPage(createElement(InsightsPage, {}));
    const card = cardOf(markup, "Brief");
    expectCleanTitleRow(card, "Brief");
    const controls = controlsBand(card);
    expect(controls).toContain('aria-label="Insight range"');
    expect(controls).toContain('aria-label="Filter insights by person"');
    expect(controls).toContain("open overdue");
    expect(controls.split('class="admin-controls"').slice(1)).toHaveLength(1);
  });

  it("keeps the record's view, person, and source above its range and disputed filters", () => {
    const markup = renderPage(createElement(EvidencePage, {}));
    const card = cardOf(markup, "The record");
    expectCleanTitleRow(card, "The record");
    const controls = controlsBand(card);
    const rows = controls.split('class="admin-controls"').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('aria-label="Evidence view"');
    expect(rows[0]).toContain('aria-label="Filter by person"');
    expect(rows[0]).toContain('aria-label="Filter by source"');
    expect(rows[1]).toContain('aria-label="Evidence from date"');
    expect(rows[1]).toContain('aria-label="Evidence to date"');
    expect(rows[1]).toContain("Disputed only");
  });

  it("keeps every toolbar page's controls out of the title action slot", () => {
    for (const page of ["ReviewPage", "TasksPage", "PeoplePage", "InsightsPage", "EvidencePage"]) {
      const source = readText(resolve(root, `src/admin/${page}.tsx`));
      expect(source, page).toContain("controls={");
      expect(source, page).toContain("<AdminControls>");
      expect(source, page).toContain("<AdminControlsGroup");
      expect(source, page).not.toContain('className="admin-toolbar"');
    }
  });

  it("keeps the overview and the settings page quiet", () => {
    for (const page of ["OverviewPage", "SettingsPage"]) {
      const source = readText(resolve(root, `src/admin/${page}.tsx`));
      expect(source, page).not.toContain("<AdminControls");
    }
  });

  it("styles the shared controls band with wrapping rows and full-width narrow targets", () => {
    const css = readText(resolve(root, "src/admin/admin.css"));
    const ui = readText(resolve(root, "src/admin/ui.tsx"));
    expect(ui).toContain('className="admin-card-controls"');
    expect(ui).toContain('"admin-controls"');
    expect(ui).toContain('"admin-controls-group"');
    expect(css).toMatch(/\.admin-card-controls \{[\s\S]*?display: grid/);
    expect(css).toMatch(/\.admin-card-controls \.admin-controls \{[\s\S]*?flex-wrap: wrap/);
    expect(css).toMatch(/\.admin-card-controls \.admin-controls-group \{[\s\S]*?flex-wrap: wrap/);
    expect(css).toMatch(/\.admin-card-controls \.admin-controls-group\.is-end \{[\s\S]*?margin-left: auto/);
    // The narrow block keeps the stack one column wide with 40px targets.
    const narrow = css.slice(css.indexOf("@media (max-width: 560px)"));
    expect(narrow).toContain(".admin-card-controls .admin-seg");
    expect(narrow).toContain("flex-wrap: wrap");
    expect(narrow).toContain("min-height: 40px");
    // The earlier single-line title contract stays intact underneath.
    expect(css).toMatch(/\.admin-card-title > span \{[\s\S]*?white-space: nowrap/);
  });
});
