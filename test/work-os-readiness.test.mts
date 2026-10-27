import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateWorkOsReadiness, type WorkOsReadinessInput } from "../src/lib/work-os-readiness";

function baseInput(): WorkOsReadinessInput {
  return {
    organization: { id: "org-a", name: "A", slug: "a", featureFlags: { employee_companion: true, desktop_companion: true } },
    people: [
      { id: "employee-a", active: true, authUserId: "user-a", worktivityEmployeeId: "wt-a", roleProfileId: "role-a" },
      { id: "manager-a", active: true, authUserId: "user-m", worktivityEmployeeId: "wt-m", roleProfileId: "role-m" },
    ],
    memberships: [
      { personId: "employee-a", role: "employee", active: true },
      { personId: "manager-a", role: "manager", active: true },
    ],
    teams: [{ id: "team-a", active: true }],
    teamMembers: [
      { teamId: "team-a", personId: "employee-a", isManager: false, active: true },
      { teamId: "team-a", personId: "manager-a", isManager: true, active: true },
    ],
    schedules: [{ personId: "employee-a", active: true, effectiveFrom: "2026-01-01", effectiveTo: null }],
    roleProfiles: [{ id: "role-a" }, { id: "role-m" }],
    connections: [{ provider: "nifty", active: true }],
    credentials: [{ provider: "nifty", expiresAt: "2099-01-01T00:00:00.000Z" }],
    sourceAccounts: [],
    tasks: [{ completed: false, assigneePersonIds: ["employee-a"], dueDate: "2026-08-12", priority: "high", estimatedEffortMinutes: 60, expectedOutcome: "Ship it", definitionOfDone: "Merged", taskGroupId: "group-a" }],
    providerReady: { worktivity: true },
    runtime: {
      aiConfigured: true,
      providerSecretConfigured: true,
      providerCredentialsPresent: true,
      screenshotEncryptionConfigured: false,
      cronSecretConfigured: false,
      worktivityConfigured: true,
      falConfigured: true,
      githubWebhookConfigured: false,
      ghlWebhookConfigured: false,
    },
  };
}

test("pilot readiness reports a complete configured organization as ready", () => {
  const report = evaluateWorkOsReadiness(baseInput());
  assert.equal(report.status, "ready");
  assert.equal(report.ready, true);
  assert.deepEqual(report.issues, []);
});

test("pilot readiness identifies setup gaps and blocks missing runtime prerequisites", () => {
  const input = baseInput();
  input.organization.featureFlags = { employee_companion: true };
  input.people[0] = { id: "employee-a", active: true };
  input.memberships = [{ personId: "employee-a", role: "employee", active: true }];
  input.teams = [];
  input.teamMembers = [];
  input.schedules = [];
  input.roleProfiles = [];
  input.connections = [];
  input.credentials = [];
  input.providerReady = {};
  input.runtime.aiConfigured = false;
  input.runtime.worktivityConfigured = false;
  const report = evaluateWorkOsReadiness(input);
  const codes = new Set(report.issues.map((issue) => issue.code));
  assert.equal(report.status, "blocked");
  assert.ok(codes.has("runtime.ai_key_missing"));
  assert.ok(!codes.has("people.nifty_mapping_missing"));
  assert.ok(codes.has("people.schedule_missing"));
});

test("pilot readiness counts missing task metadata without claiming the task is complete", () => {
  const input = baseInput();
  input.tasks = [{ completed: false, assigneePersonIds: [], dueDate: null, priority: null, expectedOutcome: null, definitionOfDone: null, taskGroupId: null }];
  const report = evaluateWorkOsReadiness(input);
  assert.equal(report.checks.tasks.open, 1);
  assert.equal(report.checks.tasks.withoutAssignee, 1);
  assert.equal(report.checks.tasks.withoutDueDate, 1);
  assert.equal(report.checks.tasks.withoutExpectedOutcome, 1);
  assert.equal(report.status, "needs_setup");
});

test("pilot readiness does not count shared provider identities as attributable", () => {
  const input = baseInput();
  input.organization.featureFlags = { employee_companion: true, desktop_companion: true, github_evidence: true };
  input.connections = [{ provider: "nifty", active: true }, { provider: "github", active: true }];
  input.credentials = [{ provider: "nifty", expiresAt: "2099-01-01T00:00:00.000Z" }, { provider: "github", expiresAt: "2099-01-01T00:00:00.000Z" }];
  input.sourceAccounts = [{ provider: "github", personId: "employee-a", verified: true, metadata: { shared: true } }];
  input.providerReady.github = true;
  input.runtime.githubWebhookConfigured = true;
  const report = evaluateWorkOsReadiness(input);
  assert.equal(report.checks.providers.verifiedAccounts.github, 0);
  assert.ok(report.issues.some((issue) => issue.code === "provider.github.identity_unverified"));
});
