import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { NotificationProvider } from "./NotificationFlyouts";
import { seedAdminFixtures } from "./admin/adminFixtures";
import TasksPage, { TaskTableHead, type TaskSortState } from "./admin/TasksPage";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seedAdminFixtures(client, "dense");
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(NotificationProvider, null, createElement(TasksPage, {}))),
  );
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
    expect((head.match(/admin-sort-button/g) ?? []).length).toBe(4);
    expect((head.match(/<button type="button"/g) ?? []).length).toBe(4);
    // The default order is recency, not a column, so no header claims aria-sort.
    expect(head).not.toContain("aria-sort=");
    // A stable indicator slot exists on every column before any hover.
    expect((head.match(/lucide-chevrons-up-down/g) ?? []).length).toBe(4);
    expect(head.indexOf(">Task<")).toBeLessThan(head.indexOf(">Assignees<"));
    expect(head.indexOf(">Assignees<")).toBeLessThan(head.indexOf(">Due<"));
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
    for (const label of ["Task", "Assignees", "Status"]) {
      const th = thFor(head, label);
      expect(th).not.toContain("aria-sort=");
      expect(th).toContain("lucide-chevrons-up-down");
    }
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
