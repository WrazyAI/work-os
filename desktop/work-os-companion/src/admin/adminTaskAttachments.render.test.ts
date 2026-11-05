import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { NotificationProvider } from "../NotificationFlyouts";
import { seedAdminFixtures } from "./adminFixtures";
import { adminKeys, todayIso } from "./data";
import TasksPage from "./TasksPage";
import { taskCapabilities } from "../../../../src/lib/work-os-task-permissions";
import type { TaskEvidenceRecord } from "../../../../src/modules/work-os/completion-evidence";

const today = todayIso();
const Tasks = TasksPage as ComponentType<{ initialTaskId?: string }>;

const evidence: TaskEvidenceRecord[] = [
  {
    id: "evidence-file",
    title: "Ship attachment indicators — completion evidence",
    note: "The retry verification log.",
    fileName: "retry-verification.txt",
    contentType: "text/plain",
    sizeBytes: 2048,
    createdAt: `${today}T08:34:00.000Z`,
    url: "/api/work-os/evidence/evidence-file/file",
  },
  {
    id: "evidence-image",
    title: "Ship attachment indicators — completion evidence",
    note: "",
    fileName: "retry-dashboard.png",
    contentType: "image/png",
    sizeBytes: 28400,
    createdAt: `${today}T08:36:00.000Z`,
    url: "/api/work-os/evidence/evidence-image/file",
  },
];

function renderTaskWithEvidence() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seedAdminFixtures(client, "dense");
  const task = {
    id: "t-attach",
    title: "Ship attachment indicators",
    completed: false,
    due_date: today,
    priority: "high",
    workflow_status: "in_progress",
    assignee_person_ids: ["p-1"],
    assigned_by_person_id: "p-1",
    assignees: [{ displayName: "Amara Okafor" }],
    updated_at: `${today}T08:00:00.000Z`,
    completion_evidence: evidence,
  };
  const withCaps = { ...task, capabilities: taskCapabilities(task, { role: "admin", personId: "p-1" }, today) };
  client.setQueryData(
    adminKeys.tasks({ filter: "open", personId: "", projectId: "", limit: "200", completed: "false", date: today }),
    { tasks: [withCaps], nextOffset: null, summary: { open: 1, overdue: 0, completedWeek: 0 } },
  );
  client.setQueryData(adminKeys.taskDetails("t-attach"), { task: withCaps, subtasks: [] });
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client },
      createElement(NotificationProvider, null,
        createElement(Tasks, { initialTaskId: "t-attach" }))),
  );
}

describe("admin task attachments", () => {
  it("marks the status cell and shows the actual files in the task drawer", () => {
    const markup = renderTaskWithEvidence();
    expect(markup).toContain('aria-label="1 file and 1 image attached"');
    expect(markup).toContain("retry-verification.txt");
    expect(markup).toContain("retry-dashboard.png");
    expect(markup).toContain("Completion evidence");
    expect(markup).toContain("Employee-attached");
    expect(markup).toContain("Download retry-verification.txt");
  });
});
