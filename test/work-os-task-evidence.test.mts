import assert from "node:assert/strict";
import { test } from "node:test";
import { taskCompletionEvidenceFromRows } from "../src/lib/work-os-task-evidence";

const attachedFile = {
  id: "evidence-1",
  task_id: "task-1",
  title: "Ship the drawer — completion evidence",
  summary: "The verification log.",
  source: "manual",
  created_at: "2026-11-05T08:00:00.000Z",
  metrics: {
    employeeAttached: true,
    evidenceClass: "output_evidence",
    fileName: "verification.txt",
    contentType: "text/plain",
    sizeBytes: 2048,
    note: "Staging verification.",
  },
};

test("task completion evidence keeps only employee-attached files and their task", () => {
  const rows = taskCompletionEvidenceFromRows([
    attachedFile,
    { ...attachedFile, id: "provider-evidence", source: "github", metrics: {} },
    { ...attachedFile, id: "unowned-evidence", task_id: null },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].taskId, "task-1");
  assert.equal(rows[0].evidence.id, "evidence-1");
  assert.equal(rows[0].evidence.fileName, "verification.txt");
  assert.equal(rows[0].evidence.note, "Staging verification.");
  assert.equal(rows[0].evidence.url, "/api/work-os/evidence/evidence-1/file");
});
