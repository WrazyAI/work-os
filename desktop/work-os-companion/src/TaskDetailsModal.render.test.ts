import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { taskCapabilities } from "../../../src/lib/work-os-task-permissions";
import { TaskDetailsModal, TaskEditModal, TaskEditModalForm, toggleAssigneeIds } from "./taskSurfaces";

const noop = () => undefined;

const details = {
  task: { id: "task-1", provider: "local", title: "Ship the drawer", description: "Detail copy", completed: false },
  subtasks: [
    { id: "sub-1", provider_task_id: "sub-1", title: "Wire the editor", description: "Open the modal", completed: false },
    { id: "sub-2", provider_task_id: "sub-2", title: "Trim the copy", description: "", completed: true },
  ],
  moveTargets: [{ id: "task-2", title: "Other task" }],
  subtaskSync: { tasks: 2, syncedAt: "2026-09-29T09:00:00Z", error: null },
};

const base = {
  details,
  loadEvidence: async () => new Blob([]),
  loading: false,
  readOnly: false,
  currentDate: "2026-09-29",
  busy: false,
  subtaskTitle: "",
  subtaskDescription: "",
  subtaskMenuId: null,
  moveMenuId: null,
  onSubtaskTitle: noop,
  onSubtaskDescription: noop,
  onSubtaskMenu: noop,
  onMoveMenu: noop,
  onSubtaskCreate: noop,
  onEditTask: noop,
  onCompleteTask: noop,
  onMoveSubtask: noop,
  onToggleSubtask: noop,
  onArchiveSubtask: noop,
  onDeleteSubtask: noop,
  onClose: noop,
};

describe("TaskDetailsModal subtask actions", () => {
  it("makes each subtask title the edit affordance", () => {
    const markup = renderToStaticMarkup(createElement(TaskDetailsModal, { ...base }));
    expect(markup).toContain('class="task-detail-subtask-title"');
    expect(markup).toContain('aria-label="Edit Wire the editor"');
    expect(markup).toContain('title="Edit subtask"');
  });

  it("keeps the historical read-only view free of edit affordances", () => {
    const markup = renderToStaticMarkup(createElement(TaskDetailsModal, { ...base, readOnly: true }));
    expect(markup).not.toContain("task-detail-subtask-title");
    expect(markup).toContain("Wire the editor");
  });

  it("renders the open subtask menu with edit and delete actions", () => {
    const markup = renderToStaticMarkup(createElement(TaskDetailsModal, { ...base, subtaskMenuId: "sub-1" }));
    expect(markup).toContain("Edit");
    expect(markup).toContain("Delete permanently");
    expect(markup).toContain("Move to");
    expect(markup).toContain("Archive");
  });

  it("shows employee-attached completion evidence without claiming provider confirmation", () => {
    const markup = renderToStaticMarkup(createElement(TaskDetailsModal, {
      ...base,
      details: { ...details, task: { ...details.task, expected_outcome: "A signed verification record." } },
      completionEvidence: [{
        id: "evidence-1",
        title: "Ship the drawer — completion evidence",
        note: "Signed verification record.",
        fileName: "release-verification.pdf",
        contentType: "application/pdf",
        sizeBytes: 482112,
        createdAt: "2026-09-29T16:42:00.000Z",
        url: "/api/work-os/evidence/evidence-1/file",
      }],
      onAttachEvidence: noop,
      onDownloadEvidence: noop,
    }));
    expect(markup).toContain("Expected outcome");
    expect(markup).toContain("Completion evidence");
    expect(markup).toContain("Employee-attached");
    expect(markup).toContain("release-verification.pdf");
    expect(markup).toContain("Download release-verification.pdf");
    expect(markup).toContain("Attach evidence");
    expect(markup).not.toContain("Recorded");
  });
});

const TODAY = "2026-09-29";

/** Task payloads from the server carry per-row capabilities; these fixtures
 *  compute them with the same pure helper the API uses so the render assertions
 *  exercise the real permission matrix. */
const withCapabilities = (task: Record<string, any>, personId = "person-1") => ({
  ...task,
  capabilities: taskCapabilities(task, { role: "employee", personId }, TODAY),
});

const people = [
  { id: "person-1", displayName: "Dana Whitfield", email: "dana@example.com" },
  { id: "person-2", displayName: "Alex Rivera", email: null },
];

const selfOwned = withCapabilities({
  id: "task-1", provider: "local", title: "Ship the drawer", description: "Detail copy",
  completed: false, due_date: TODAY, workflow_status: "pending",
  assignee_person_ids: ["person-1"], assigned_by_person_id: "person-1",
  assignees: [{ personId: "person-1", displayName: "Dana Whitfield", email: "dana@example.com" }],
});

const assigneeOnly = withCapabilities({
  ...selfOwned,
  assignee_person_ids: ["person-1"], assigned_by_person_id: "person-2",
  assignees: [{ personId: "person-1", displayName: "Dana Whitfield", email: "dana@example.com" }],
});

const overdue = withCapabilities({ ...selfOwned, due_date: "2026-09-28" });

const drawerMarkup = (task: Record<string, any>, extra: Record<string, any> = {}) => renderToStaticMarkup(createElement(TaskDetailsModal, {
  ...base,
  details: { task, subtasks: [], moveTargets: [] },
  currentPersonId: "person-1",
  assignablePeople: people,
  onStatus: noop,
  onCompleteTask: noop,
  onArchive: noop,
  onDelete: noop,
  onAssign: noop,
  ...extra,
}));

/** The visible text of every `role="menuitem"` control in the markup. */
const menuItemLabels = (markup: string) => [...markup.matchAll(/role="menuitem"[^>]*>([\s\S]*?)<\/button>/g)]
  .map((match) => match[1]!.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim())
  .filter(Boolean);

/** One menu item's whole button, so its disabled attribute is visible too. */
const menuItemTag = (markup: string, label: string) => [...markup.matchAll(/<button[^>]*role="menuitem"[^>]*>[\s\S]*?<\/button>/g)]
  .map((match) => match[0])
  .find((tag) => tag.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().startsWith(label)) ?? "";

const buttonTag = (markup: string, label: string) => markup.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? "";

/** The whole button, so its visible label is included. */
const buttonText = (markup: string, label: string) => (markup.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>([\\s\\S]*?)</button>`))?.[1] ?? "")
  .replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

describe("TaskDetailsModal lifecycle actions", () => {
  it("shows the current status on a control the assigner can use", () => {
    const markup = drawerMarkup(selfOwned);
    const trigger = buttonTag(markup, "Task status");
    expect(trigger).toContain('aria-haspopup="menu"');
    expect(trigger).not.toContain("disabled");
    expect(buttonText(markup, "Task status")).toBe("Pending");
  });

  it("lists both manual statuses in the status menu", () => {
    const labels = menuItemLabels(drawerMarkup(selfOwned, { initialMenu: "status" }));
    expect(labels).toEqual(expect.arrayContaining(["Pending", "In progress"]));
  });

  it("disables the status the task already holds", () => {
    const pending = drawerMarkup(selfOwned, { initialMenu: "status" });
    expect(menuItemTag(pending, "Pending")).toContain("disabled");
    expect(menuItemTag(pending, "In progress")).not.toContain("disabled");
    const inProgress = withCapabilities({ ...selfOwned, workflow_status: "in_progress" });
    const markup = drawerMarkup(inProgress, { initialMenu: "status" });
    expect(menuItemTag(markup, "In progress")).toContain("disabled");
    expect(menuItemTag(markup, "Pending")).not.toContain("disabled");
  });

  it("keeps archive and permanent delete in the drawer actions menu", () => {
    const markup = drawerMarkup(selfOwned, { initialMenu: "actions" });
    const labels = menuItemLabels(markup);
    expect(labels).toEqual(expect.arrayContaining(["Edit task", "Delete task"]));
    expect(labels.some((label) => /^Archive task\b.*reversible/.test(label))).toBe(true);
  });

  it("offers assignment with the current assignees and a full next set", () => {
    const markup = drawerMarkup(selfOwned, { initialMenu: "assignees" });
    expect(buttonTag(markup, "Change assignees")).toContain('aria-expanded="true"');
    expect(menuItemLabels(markup)).toEqual(expect.arrayContaining(["Dana Whitfield", "Alex Rivera", "Assign"]));
  });

  it("assigns by replacing the whole set", () => {
    expect(toggleAssigneeIds([], "person-2")).toEqual(["person-2"]);
    expect(toggleAssigneeIds(["person-1"], "person-2")).toEqual(["person-1", "person-2"]);
    expect(toggleAssigneeIds(["person-1", "person-2"], "person-1")).toEqual(["person-2"]);
  });

  it("keeps an assignee on completion and status without lifecycle controls", () => {
    const markup = drawerMarkup(assigneeOnly);
    expect(markup).toContain("Mark complete");
    expect(buttonTag(markup, "Task status")).not.toBe("");
    expect(markup).not.toContain("Edit task");
    expect(markup).not.toContain("Archive task");
    expect(markup).not.toContain("Delete task");
    expect(buttonTag(markup, "Change assignees")).toBe("");
  });

  it("locks the status control for an overdue task and names the fix", () => {
    const markup = drawerMarkup(overdue);
    expect(buttonTag(markup, "Task status")).toContain("disabled");
    expect(markup).toContain("Update the due date first");
    // The assigner can still reach the editor that moves the date.
    expect(markup).toContain("Edit task");
  });

  it("links the overdue note to its disabled status control", () => {
    const markup = drawerMarkup(overdue);
    const describedBy = buttonTag(markup, "Task status").match(/aria-describedby="([^"]+)"/)?.[1] ?? "";
    expect(describedBy).not.toBe("");
    const noteIndex = markup.indexOf(`id="${describedBy}"`);
    expect(noteIndex).toBeGreaterThan(-1);
    expect(markup.slice(noteIndex, noteIndex + 200)).toContain("Update the due date first");
  });

  it("locks assignment when a current assignee is outside the actor's scope", () => {
    const outsideScope = withCapabilities({
      ...selfOwned,
      assignee_person_ids: ["me", "gone"],
      assigned_by_person_id: "me",
      assignees: [{ personId: "me", displayName: "Me Person", email: null }],
    }, "me");
    const markup = drawerMarkup(outsideScope, {
      currentPersonId: "me",
      assignablePeople: [{ id: "me", displayName: "Me Person", email: null }],
    });
    expect(buttonTag(markup, "Change assignees")).toContain("disabled");
    expect(markup).toContain("This task has an assignee outside your assignment scope.");
    expect(markup).toContain("Another assignee");
  });

  it("names an out-of-scope assignee when the payload carries the identity", () => {
    const outsideScope = withCapabilities({
      ...selfOwned,
      assignee_person_ids: ["me", "gone"],
      assigned_by_person_id: "me",
      assignees: [
        { personId: "me", displayName: "Me Person", email: null },
        { personId: "gone", displayName: "Gone Person", email: null },
      ],
    }, "me");
    const markup = drawerMarkup(outsideScope, {
      currentPersonId: "me",
      assignablePeople: [{ id: "me", displayName: "Me Person", email: null }],
    });
    const row = markup.match(/<span class="task-detail-assignee-outside"[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? "";
    expect(row).toContain("Gone Person");
  });

  it("stops claiming Today once the due date is cleared", () => {
    const markup = drawerMarkup({ ...selfOwned, due_date: null });
    expect(markup).toContain(">No date<");
    expect(markup).not.toContain(">Today<");
  });

  it("keeps the historical read-only drawer free of lifecycle actions", () => {
    const markup = drawerMarkup(selfOwned, { readOnly: true });
    expect(markup).not.toContain("Task status");
    expect(markup).not.toContain("Archive task");
    expect(markup).not.toContain("Delete task");
  });

  it("omits cached capabilities instead of guessing them", () => {
    const cached = { ...selfOwned } as Record<string, any>;
    delete cached.capabilities;
    const markup = drawerMarkup(cached);
    expect(markup).not.toContain("Task status");
    expect(markup).not.toContain("Mark complete");
  });
});

describe("TaskEditModal due date", () => {
  it("renders the due date for an editor and reports its changes", () => {
    const markup = renderToStaticMarkup(createElement(TaskEditModal, {
      kind: "task", title: "Ship the drawer", description: "Detail copy", busy: false,
      dueDate: "2026-10-30", onTitle: noop, onDescription: noop, onDueDate: noop, onClose: noop, onSubmit: noop,
    }));
    const input = markup.match(/<input[^>]*type="date"[^>]*>/)?.[0] ?? "";
    expect(markup).toContain(">Due<");
    expect(input).toContain('value="2026-10-30"');
    expect(input).not.toContain("disabled");
  });

  it("clears the due date through the editor's own input handler", () => {
    const onDueDate = vi.fn();
    const body = TaskEditModalForm({
      kind: "task", title: "Ship the drawer", description: "Detail copy", dueDate: "2026-10-30", busy: false,
      onTitle: noop, onDescription: noop, onDueDate,
    });
    const dueField = (body.props.children as Array<{ props?: Record<string, any> }>)
      .find((child) => child?.props?.className === "task-edit-due");
    const input = (dueField?.props?.children as Array<{ type?: string; props?: Record<string, any> }> | undefined)
      ?.find((child) => child?.type === "input" && child?.props?.type === "date");
    expect(input).toBeTruthy();
    input!.props!.onChange({ target: { value: "" } });
    expect(onDueDate).toHaveBeenCalledWith("");
  });

  it("hides the due date from an actor who may not edit", () => {
    const markup = renderToStaticMarkup(createElement(TaskEditModal, {
      kind: "task", title: "Ship the drawer", description: "Detail copy", busy: false,
      onTitle: noop, onDescription: noop, onClose: noop, onSubmit: noop,
    }));
    expect(markup).not.toContain('type="date"');
  });
});
