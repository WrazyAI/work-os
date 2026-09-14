/**
 * One-off live verification of the deployed approval path: create a scratch
 * task, file its completion through the proposal gate, time the round trip,
 * verify persistence, then archive the scratch task. Prints JSON timings.
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

for (const path of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const match = line.match(/^([^=#]+)=(.*)$/);
      if (!match) continue;
      const key = match[1].trim();
      const value = match[2].trim().replace(/^"|"$/g, "").replace(/^'|'$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

const { createWorkOsEmployeeTask, archiveWorkOsEmployeeTask } = await import("../src/lib/work-os-employee-tasks");
const { proposeInterpretedWorkUpdate, reviewWorkOsProposal } = await import("../src/lib/work-os-proposals");

const pg = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await pg.connect();

const org = (await pg.query("select id, legacy_owner_id, created_by from work_organizations order by created_at limit 1")).rows[0];
const ownerId = String(org.legacy_owner_id || org.created_by);
const person = (await pg.query("select id from work_people where user_id = $1 order by created_at limit 1", [ownerId])).rows[0];
const membership = (await pg.query("select id from work_org_members where organization_id = $1 and user_id = $2 limit 1", [org.id, ownerId])).rows[0];
if (!person || !membership) throw new Error("owner person/membership not found");

const access = {
  ctx: { user: { id: ownerId } },
  organizationId: String(org.id),
  role: "admin" as const,
  personId: String(person.id),
  membershipId: String(membership.id),
  featureFlags: {},
};

const createStarted = Date.now();
const task = await createWorkOsEmployeeTask(access, {
  name: "Scratch approval round-trip verification",
  description: "Created and archived automatically by scripts/verify-approval-roundtrip.mts to verify the deployed approval path end to end.",
  assignee_person_ids: [String(person.id)],
});
const createMs = Date.now() - createStarted;
const taskId = String((task as Record<string, unknown>).id);

const interpreted = await proposeInterpretedWorkUpdate(access, {
  input_text: "Scratch verification of the approval round trip.",
  operations: [{ op: "complete_task", statement: "Scratch approval round-trip verification completed.", task_id: taskId }],
}, randomUUID()) as { proposals: Array<Record<string, unknown>> };
const proposal = interpreted.proposals[0];

const reviewStarted = Date.now();
const reviewed = await reviewWorkOsProposal(access, String(proposal.id), {
  decision: "accept",
  decision_idempotency_key: randomUUID(),
});
const reviewMs = Date.now() - reviewStarted;

const persisted = (await pg.query("select completed, completed_at from work_tasks where id = $1", [taskId])).rows[0];
const applied = (reviewed as Record<string, unknown>).status === "applied";

const archiveStarted = Date.now();
await archiveWorkOsEmployeeTask(access, taskId);
const archiveMs = Date.now() - archiveStarted;

console.log(JSON.stringify({
  createMs,
  reviewMs,
  applied,
  taskCompletedInNeon: persisted?.completed === true,
  completedAtRecorded: Boolean(persisted?.completed_at),
  archiveMs,
  providerStatus: (task as Record<string, unknown>).providerStatus ?? null,
}, null, 2));

await pg.end();
