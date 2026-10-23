import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TaskDetailsModal } from "./taskSurfaces";

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
    expect(markup).not.toContain("Nifty synced");
  });
});
