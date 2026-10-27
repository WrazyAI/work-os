import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { taskCapabilities } from "../../../../src/lib/work-os-task-permissions";
import { NotificationProvider } from "../NotificationFlyouts";
import { seedAdminFixtures } from "./adminFixtures";
import { todayIso, type AdminTaskRow } from "./data";
import TasksPage, { AdminTaskMenuItems } from "./TasksPage";

const noop = () => undefined;
const TODAY = todayIso();
const ADMIN = { role: "admin" as const, personId: "p-1" };

function renderWith(state: "dense" | "sparse", props: Parameters<typeof TasksPage>[0] = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seedAdminFixtures(client, state);
  const Component = TasksPage as (input: Parameters<typeof TasksPage>[0]) => ReactNode;
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client },
      createElement(NotificationProvider, null, createElement(Component, props))),
  );
}

/** A normalized administration row with the capability payload the API attaches
 *  to every admin read; the menu omits an item the actor may not use. */
function adminRow(overrides: Record<string, unknown> = {}): AdminTaskRow {
  const task = {
    id: "t-menu",
    title: "Retry handling for failed billing webhooks",
    completed: false,
    due_date: TODAY,
    workflow_status: "pending",
    assignee_person_ids: ["p-1"],
    assigned_by_person_id: "p-1",
    ...overrides,
  };
  return { ...task, capabilities: taskCapabilities(task, ADMIN, TODAY) };
}

function menu(row: AdminTaskRow) {
  return renderToStaticMarkup(createElement(AdminTaskMenuItems, {
    task: row,
    today: TODAY,
    busy: false,
    onStatus: noop,
    onComplete: noop,
    onEdit: noop,
    onAssign: noop,
    onArchive: noop,
    onDelete: noop,
    onClose: noop,
  }));
}

describe("administration task row actions", () => {
  it("puts an actions trigger beside the completion control on every row", () => {
    const markup = renderWith("dense");
    expect((markup.match(/aria-label="Actions for /g) ?? []).length).toBe(9);
    const at = markup.indexOf('aria-label="Actions for Retry handling for failed billing webhooks"');
    expect(at).toBeGreaterThan(-1);
    const row = markup.slice(markup.lastIndexOf("<tr", at), markup.indexOf("</tr>", at) + "</tr>".length);
    // One trailing cell carries both controls, so the row keeps its height.
    expect(row).toContain(">Complete<");
    expect(row.match(/<td class="admin-row-actions"/g) ?? []).toHaveLength(1);
    expect(row).toMatch(/admin-row-actions-inner[\s\S]*Complete[\s\S]*aria-label="Actions for /);
  });

  it("keeps a row without a capability payload free of a dead trigger", () => {
    const markup = renderWith("sparse");
    expect(markup).toContain("Design review for the admin surface");
    expect(markup).not.toContain("Actions for ");
  });
});

describe("administration task row menu", () => {
  it("lists both manual statuses and the lifecycle actions", () => {
    const markup = menu(adminRow());
    for (const label of ["Pending", "In progress", "Edit task", "Archive", "reversible", "Delete permanently"]) {
      expect(markup).toContain(label);
    }
  });

  it("offers Reopen instead of completion on a completed task", () => {
    const markup = menu(adminRow({ completed: true }));
    expect(markup).toContain("Reopen task");
    expect(markup).not.toContain("Mark task done");
    // A completed task has no status path; the server refuses it.
    expect(markup).not.toContain("Pending");
    expect(markup).not.toContain("In progress");
  });
});

describe("administration task drawer actions", () => {
  it("shows the status control, the assignee, and the lifecycle actions", () => {
    const markup = renderWith("dense", { initialTaskId: "t-1" });
    expect(markup).toContain("Task status");
    expect(markup).toContain("Assignee");
    expect(markup).toContain("Assigned by");
    expect(markup).toContain("Ben Sato");
    expect(markup).toContain("Archive task");
    expect(markup).toContain("Delete task");
    expect(markup).toContain("Edit task");
  });
});
