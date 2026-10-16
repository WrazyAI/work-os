import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { NotificationProvider } from "./NotificationFlyouts";
import { seedAdminFixtures } from "./admin/adminFixtures";
import { isoDaysAgo } from "./admin/data";
import { formatWorkOsFullDate, shiftWorkOsDate } from "./dateFormat";
import TasksPage, { TaskTableHead, type TaskSortState } from "./admin/TasksPage";

function renderPageWithState(state: "dense" | "sparse") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seedAdminFixtures(client, state);
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(NotificationProvider, null, createElement(TasksPage, {}))),
  );
}

function renderPage() {
  return renderPageWithState("dense");
}

function renderHead(sort: TaskSortState | null) {
  return renderToStaticMarkup(createElement(TaskTableHead, { sort, onSort: () => undefined }));
}

function headOf(markup: string) {
  const start = markup.indexOf("<thead>");
  const end = markup.indexOf("</thead>");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return markup.slice(start, end + "</thead>".length);
}

function bodyOf(markup: string) {
  const start = markup.indexOf("<tbody>");
  const end = markup.indexOf("</tbody>");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return markup.slice(start + "<tbody>".length, end);
}

/** The `<tr>` that owns a task title, sliced out of the body markup. */
function rowFor(body: string, title: string) {
  const at = body.indexOf(`>${title}</b>`);
  expect(at, `task row not found: ${title}`).toBeGreaterThan(-1);
  const start = body.lastIndexOf("<tr", at);
  const end = body.indexOf("</tr>", at);
  return body.slice(start, end + "</tr>".length);
}

/** A row's cells in column order. */
function cellsOf(row: string) {
  return [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((match) => match[1]);
}

/** The `<th>` that owns a column label, sliced out of the head markup. */
function thFor(head: string, label: string) {
  const at = head.indexOf(`>${label}</span>`);
  expect(at, `header label not found: ${label}`).toBeGreaterThan(-1);
  const start = head.lastIndexOf("<th", at);
  const end = head.indexOf("</th>", at);
  return head.slice(start, end + "</th>".length);
}

describe("administration task table sorting affordances", () => {
  it("renders every labeled column as a sort button with an idle indicator, unsorted by default", () => {
    const head = headOf(renderPage());
    expect((head.match(/admin-sort-button/g) ?? []).length).toBe(5);
    expect((head.match(/<button type="button"/g) ?? []).length).toBe(5);
    // The default order is recency, not a column, so no header claims aria-sort.
    expect(head).not.toContain("aria-sort=");
    // A stable indicator slot exists on every column before any hover.
    expect((head.match(/lucide-chevrons-up-down/g) ?? []).length).toBe(5);
    expect(head.indexOf(">Task<")).toBeLessThan(head.indexOf(">Assignees<"));
    expect(head.indexOf(">Assignees<")).toBeLessThan(head.indexOf(">Created<"));
    expect(head.indexOf(">Created<")).toBeLessThan(head.indexOf(">Due<"));
    expect(head.indexOf(">Due<")).toBeLessThan(head.indexOf(">Status<"));
    // The empty actions column stays non-sortable.
    const actionsTh = head.slice(head.lastIndexOf("<th"));
    expect(actionsTh).not.toContain("<button");
  });

  it("marks only the sorted column's th with aria-sort and shows its direction arrow", () => {
    const head = headOf(renderHead({ key: "due", direction: "asc" }));
    expect((head.match(/aria-sort=/g) ?? []).length).toBe(1);
    const due = thFor(head, "Due");
    expect(due).toContain('aria-sort="ascending"');
    expect(due).toContain("Due, sorted earliest first. Activate to sort latest first.");
    expect(due).toContain("lucide-arrow-up");
    expect(due).not.toContain("lucide-chevrons-up-down");
    // The other columns keep their quiet affordance and no aria-sort.
    for (const label of ["Task", "Assignees", "Created", "Status"]) {
      const th = thFor(head, label);
      expect(th).not.toContain("aria-sort=");
      expect(th).toContain("lucide-chevrons-up-down");
    }
  });

  it("gives Created a newest-first natural order with its own aria-sort wording", () => {
    const head = headOf(renderHead({ key: "created", direction: "desc" }));
    const created = thFor(head, "Created");
    expect(created).toContain('aria-sort="descending"');
    expect(created).toContain("Created, sorted newest first. Activate to sort oldest first.");
    expect(created).toContain("lucide-arrow-down");
    // Another column's next activation starts at its own natural direction.
    expect(thFor(head, "Due")).toContain("Sort by Due, earliest first.");
    expect(thFor(head, "Due")).toContain("lucide-chevrons-up-down");
  });

  it("names the attention order and reverse action when Status is sorted descending", () => {
    const head = headOf(renderHead({ key: "status", direction: "desc" }));
    const status = thFor(head, "Status");
    expect(status).toContain('aria-sort="descending"');
    expect(status).toContain("Status, sorted done first. Activate to sort overdue first.");
    expect(status).toContain("lucide-arrow-down");
    // Another column's next activation starts at its own natural direction.
    expect(thFor(head, "Task")).toContain("Sort by Task, A to Z.");
    expect(thFor(head, "Task")).toContain("lucide-chevrons-up-down");
  });

  it("keeps the record in default recency order until a column is activated", () => {
    const markup = renderPage();
    const body = markup.slice(markup.indexOf("<tbody>"), markup.indexOf("</tbody>"));
    const titles = [...body.matchAll(/<b[^>]*>([^<]+)<\/b>/g)].map((match) => match[1]);
    expect(titles.slice(0, 3)).toEqual([
      "Retry handling for failed billing webhooks",
      "Settings information architecture",
      "Search indexing backfill",
    ]);
  });
});

describe("administration task table dates and details", () => {
  it("shows each task's created date beside its due date, deriving an unrecorded due date from it", () => {
    const body = bodyOf(renderPage());
    // The fixture row created yesterday has no recorded due date; it reads one
    // day after creation, in the same letter-month form as a recorded date.
    const derived = cellsOf(rowFor(body, "Quarterly retention policy review"));
    expect(derived[2].trim()).toBe(formatWorkOsFullDate(isoDaysAgo(1)));
    expect(derived[3].trim()).toBe(formatWorkOsFullDate(shiftWorkOsDate(isoDaysAgo(1), 1)));
    // A recorded due date still wins over the default.
    const recorded = cellsOf(rowFor(body, "Retry handling for failed billing webhooks"));
    expect(recorded[2].trim()).toBe("Sep 28, 2026");
    expect(recorded[3].trim()).toBe("Oct 12, 2026");
    // Every created date renders as a letter month, and no row with a created
    // date keeps a dash in Due.
    const rows = body.match(/<tr[\s\S]*?<\/tr>/g) ?? [];
    expect(rows).toHaveLength(9);
    for (const row of rows) {
      const cells = cellsOf(row);
      expect(cells[2], cells[2]).toMatch(/^([A-Z][a-z]{2} \d{1,2}, \d{4}|—)$/);
      if (!cells[2].includes("—")) expect(cells[3]).not.toContain("—");
    }
    // Exactly one dense row records no created date: its Created cell is the
    // only dash (it keeps its recorded due date).
    const dashed = rows.filter((row) => cellsOf(row)[2].includes("—"));
    expect(dashed).toHaveLength(1);
    expect(cellsOf(dashed[0])[2].trim()).toBe("—");
    expect(cellsOf(dashed[0])[3].trim()).toBe("Oct 13, 2026");
  });

  it("reads a task past its derived due date as Overdue", () => {
    const row = rowFor(bodyOf(renderPage()), "Vendor comparison matrix");
    const cells = cellsOf(row);
    expect(cells[3].trim()).toBe(formatWorkOsFullDate(shiftWorkOsDate(isoDaysAgo(4), 1)));
    expect(row).toContain(">Overdue<");
    expect(row).toContain("admin-numeric warn");
  });

  it("keeps both date cells a plain dash when the record states no dates, with no overdue claim", () => {
    const row = rowFor(bodyOf(renderPageWithState("sparse")), "Design review for the admin surface");
    const cells = cellsOf(row);
    expect(cells[2].trim()).toBe("—");
    expect(cells[3].trim()).toBe("—");
    expect(row).not.toContain("Overdue");
    expect(row).not.toContain("admin-numeric warn");
    expect(row).toContain(">Open<");
  });

  it("keeps the task record one flat list — per-task project detail, no grouping markup", () => {
    const markup = renderPage();
    // One tbody of plain rows: no project group headers, row groups, colspans,
    // or nested structure between the rows.
    expect((markup.match(/<tbody>/g) ?? []).length).toBe(1);
    const body = bodyOf(markup);
    const rows = body.match(/<tr[\s\S]*?<\/tr>/g) ?? [];
    expect(rows).toHaveLength(9);
    expect(body).not.toContain("colspan");
    expect(body).not.toContain('role="rowgroup"');
    expect(body).not.toMatch(/<th\b/);
    expect(body).not.toMatch(/<h[1-6]\b/);
    // Every row names its own project, priority, and labels as small per-task
    // details in the task cell.
    const taskCellOf = (title: string) => cellsOf(rowFor(body, title))[0];
    for (const row of rows) expect(cellsOf(row)[0]).toContain('class="admin-record"');
    expect(taskCellOf("Retry handling for failed billing webhooks")).toContain("Platform");
    expect(taskCellOf("Retry handling for failed billing webhooks")).toContain("High priority");
    expect(taskCellOf("Retry handling for failed billing webhooks")).toContain("platform");
    expect(taskCellOf("Settings information architecture")).toContain("Product");
    expect(taskCellOf("Settings information architecture")).toContain("Medium priority");
    expect(taskCellOf("Search indexing backfill")).toContain("Operations");
  });
});
