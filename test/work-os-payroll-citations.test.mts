import assert from "node:assert/strict";
import test from "node:test";
import type { PayrollWeekSources } from "../src/modules/work-os/payroll/contracts";

// The break this catches: a brief citing a source it did not receive, a prior
// version, or a task/outcome as if it were a recap narrative.
const briefs = () => import("../src/lib/work-os-payroll-briefs");
const sources: PayrollWeekSources = {
  scope: { organizationId: "10000000-0000-4000-8000-000000000001", personId: "20000000-0000-4000-8000-000000000001" },
  week: 1, from: "2026-11-01", through: "2026-11-07", sourceHash: "week-1",
  recaps: [{
    id: "nov1", revision: 1, reviewVersion: 2, reviewSource: "employee", headline: "Queue", detail: "Reviewed the queue.",
    citations: [{ type: "interval", id: "nov1", revision: 2 }],
  }],
  outcomes: [{ citation: { type: "task", id: "task-1", revision: 1 }, text: "Recorded completion: shipped the queue." }],
  gaps: [],
};

test("citations must name a supplied recap revision or a recorded outcome", async () => {
  const { validatePayrollCitations } = await briefs();
  assert.deepEqual(validatePayrollCitations([
    { type: "interval", id: "nov1", revision: 2 },
    { type: "interval", id: "nov1", revision: 2 },
    { type: "interval", id: "nov1", revision: 1 },
    { type: "interval", id: "nov8", revision: 2 },
    { type: "task", id: "task-1", revision: 1 },
    { type: "output", id: "task-1", revision: 1 },
    { type: "approval", id: "a", revision: 1 },
  ], sources), [
    { type: "interval", id: "nov1", revision: 2 },
    { type: "task", id: "task-1", revision: 1 },
  ]);
  assert.deepEqual(validatePayrollCitations(null, sources), []);
  assert.deepEqual(validatePayrollCitations([{ type: "interval", id: "nov1", revision: 3 }], sources), []);
});

test("recorded outcomes remain distinct from recap narratives", async () => {
  const { validatePayrollCitations } = await briefs();
  assert.deepEqual(validatePayrollCitations([{ type: "output", id: "task-1", revision: 1 }], sources), []);
  const outcomeSources = { ...sources, outcomes: [{ citation: { type: "output" as const, id: "task-1", revision: 1 }, text: "Recorded output" }] };
  assert.deepEqual(validatePayrollCitations([{ type: "output", id: "task-1", revision: 1 }], outcomeSources), [{ type: "output", id: "task-1", revision: 1 }]);
});
