import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { agentEvidenceMetrics } from "../src/lib/work-os-employee-tasks";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("agent evidence metrics mark the origin and the token", () => {
  assert.deepEqual(
    agentEvidenceMetrics({ sizeBytes: 4 }, "token-1"),
    { sizeBytes: 4, origin: "agent_evidence", agentTokenId: "token-1" },
  );
  assert.deepEqual(agentEvidenceMetrics({ sizeBytes: 4 }, null), { sizeBytes: 4 });
});

test("agent completion and evidence carry token provenance", async () => {
  const employee = await read("src/lib/work-os-employee-tasks.ts");
  const day = await read("src/lib/work-os-daily-workspace.ts");
  assert.match(employee, /agent\.task\.completed/);
  assert.match(employee, /agent\.task\.reopened/);
  assert.match(employee, /agent\.evidence\.attached/);
  assert.match(employee, /agentTokenId/);
  assert.match(employee, /provenance: actor \? "agent" : "employee_explicit"/);
  assert.match(day, /options\.provenance === "employee_explicit"/);
});

test("agent completion may close an archived task but never a deleted one", async () => {
  const employee = await read("src/lib/work-os-employee-tasks.ts");
  const agent = await read("src/lib/work-agent-tasks.ts");
  assert.match(employee, /options: \{ allowArchived\?: boolean \} = \{\}/);
  assert.match(agent, /allowArchived: completed === true/);
  assert.match(employee, /task\.status === "deleted"\) throw new WorkOsNotFoundError\(\)/);
});

test("the agent completion and evidence routes enforce their scopes", async () => {
  const complete = await read("src/app/api/agent/v1/tasks/[taskId]/complete/route.ts");
  const detail = await read("src/app/api/agent/v1/tasks/[taskId]/route.ts");
  const reopen = await read("src/app/api/agent/v1/tasks/[taskId]/reopen/route.ts");
  const evidence = await read("src/app/api/agent/v1/tasks/[taskId]/evidence/route.ts");
  assert.match(complete, /requireAgentAccess\(req, "tasks:write"\)/);
  assert.match(detail, /include_archived/);
  assert.match(reopen, /requireAgentAccess\(req, "tasks:write"\)/);
  assert.match(evidence, /requireAgentAccess\(req, "evidence:write"\)/);
  for (const source of [complete, reopen, evidence]) assert.match(source, /withAgentIdempotency/);
  assert.match(evidence, /file_too_large/);
  assert.match(evidence, /unsupported_file_type/);
  assert.match(evidence, /complete/);
});
