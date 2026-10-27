import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { taskCapabilities } from "../../../../src/lib/work-os-task-permissions";
import { NotificationProvider } from "../NotificationFlyouts";
import { seedAdminFixtures } from "./adminFixtures";
import { adminKeys, isoDaysAgo, todayIso, type AdminTaskRow } from "./data";
import TasksPage, { AdminTaskMenuItems, adminTaskStatusRecord } from "./TasksPage";

const noop = () => undefined;
const TODAY = todayIso();
const ADMIN = { role: "admin" as const, personId: "p-1" };
const OPEN_FILTERS = { filter: "open", personId: "", projectId: "", limit: "200", completed: "false" };

function renderWith(state: "dense" | "sparse", props: Parameters<typeof TasksPage>[0] = {}, seed?: (client: QueryClient) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seedAdminFixtures(client, state);
  seed?.(client);
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

/** The rendered buttons whose visible text names one of the manual statuses,
 *  with the note that follows it in a menu item. */
function statusButtons(markup: string) {
  return [...markup.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)]
    .map((match) => ({
      tag: match[0],
      text: match[1]!.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
    }))
    .filter((entry) => entry.text === "Pending" || entry.text.startsWith("Pending ") || entry.text === "In progress" || entry.text.startsWith("In progress "));
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

describe("administration effective due date", () => {
  /** A row whose record states no due date: the surface reads the effective
   *  date, created + 1 day, which has already passed. The API computed
   *  capabilities against the recorded (absent) date, so it reports no lock. */
  function rowWithDerivedOnly(): AdminTaskRow {
    const task = {
      id: "t-late",
      title: "Vendor comparison matrix",
      completed: false,
      due_date: null,
      created_at: `${isoDaysAgo(4)}T09:00:00.000Z`,
      workflow_status: "pending",
      assignee_person_ids: ["p-1"],
      assigned_by_person_id: "p-1",
    };
    return { ...task, capabilities: taskCapabilities(task, ADMIN, TODAY) };
  }

  it("derives one status record and leaves the recorded date alone", () => {
    const row = rowWithDerivedOnly();
    expect(row.capabilities?.statusLocked).toBe(false);
    const derived = adminTaskStatusRecord(row, TODAY);
    expect(derived.due_date).toBe(isoDaysAgo(3));
    expect(derived.capabilities?.overdue).toBe(true);
    expect(derived.capabilities?.statusLocked).toBe(true);
    // The derived default never becomes the row's recorded date.
    expect(row.due_date).toBeNull();
  });

  it("locks the row menu and the drawer on that same effective date", () => {
    const row = rowWithDerivedOnly();
    const markup = renderWith("dense", { initialTaskId: "t-late" }, (client) => {
      client.setQueryData(adminKeys.tasks(OPEN_FILTERS), { tasks: [row], nextOffset: null, summary: { open: 1, overdue: 1, completedWeek: 0 } });
      client.setQueryData(adminKeys.taskDetails("t-late"), { task: row, subtasks: [] });
    });
    // The row reads Overdue from the effective date.
    expect(markup).toContain(">Overdue<");
    // The drawer agrees and names the fix through the shared status options.
    expect(markup).toContain("Update the due date first");
    const drawerStatus = statusButtons(markup);
    expect(drawerStatus.map((entry) => entry.text)).toEqual(["Pending", "In progress"]);
    for (const entry of drawerStatus) expect(entry.tag, entry.text).toContain("disabled");

    // The row menu is built from the same record, so it locks identically.
    const menuMarkup = menu(adminTaskStatusRecord(row, TODAY));
    const menuStatus = statusButtons(menuMarkup);
    expect(menuStatus).toHaveLength(2);
    for (const entry of menuStatus) {
      expect(entry.tag, entry.text).toContain("disabled");
      expect(entry.text).toContain("Update the due date first");
    }
  });
});
