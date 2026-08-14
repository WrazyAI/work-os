import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);

async function source(path: string) {
  return readFile(new URL(path, root), "utf8");
}

test("employee flow routes preserve idempotency and person scope", async () => {
  const checkIns = await source("src/app/api/work-os/check-ins/route.ts");
  const proposals = await source("src/app/api/work-os/proposals/[proposalId]/route.ts");
  const reports = await source("src/app/api/work-os/reports/[reportId]/submit/route.ts");
  const evidence = await source("src/app/api/work-os/evidence/route.ts");
  const workday = await source("src/app/api/work-os/me/workday/route.ts");
  const plan = await source("src/app/api/work-os/me/plan/route.ts");
  const removals = await source("src/app/api/work-os/me/plan/removals/route.ts");
  const attendance = await source("src/lib/work-os-attendance.ts");
  const attendanceProjection = await source("src/modules/work-os/attendance.ts");
  assert.match(checkIns, /idempotency-key/);
  assert.match(proposals, /decision_idempotency_key/);
  assert.match(reports, /requireWorkOsPersonAccess/);
  assert.match(reports, /organization_id[\s\S]*auth\.access\.organizationId/);
  assert.match(evidence, /idempotency-key/);
  assert.match(workday, /Idempotency-Key is required/);
  assert.match(workday, /requirePerson: true/);
  assert.match(plan, /Idempotency-Key is required/);
  assert.match(plan, /requirePerson: true/);
  assert.match(removals, /Idempotency-Key is required/);
  assert.match(removals, /proposeWorkOsPlanRemoval/);
  assert.match(workday, /clockIn\(auth\.access/);
  assert.doesNotMatch(workday, /reconcileWorktivityAttendance|work_os_fallback/);
  assert.match(attendance, /observeWorktivityAttendance/);
  assert.match(attendance, /\/ActivityLogs\/List/);
  assert.match(attendance, /EmployeeId: employeeId/);
  assert.doesNotMatch(attendance, /\.from\("work_sessions"\)\.insert/);
  assert.doesNotMatch(attendance, /state:\s*desiredState/);
  assert.match(attendanceProjection, /Worktivity activity observed; Work OS clock-in is explicit/);
});

test("privacy and provider routes retain the pilot safety gates", async () => {
  const onboarding = await source("src/app/api/work-os/me/onboarding/route.ts");
  const screenshots = await source("src/app/api/work-os/evidence/screenshots/[summaryId]/access/route.ts");
  const retention = await source("src/app/api/work-os/evidence/screenshots/retention/route.ts");
  const github = await source("src/app/api/work-os/integrations/github/webhook/route.ts");
  const ghl = await source("src/app/api/work-os/integrations/ghl/webhook/route.ts");
  assert.match(onboarding, /export async function PATCH/);
  assert.match(onboarding, /updateEmployeeConsent/);
  assert.match(onboarding, /export async function PUT/);
  assert.match(onboarding, /saveEmployeeOnboardingDraft/);
  assert.match(onboarding, /export async function DELETE/);
  assert.match(onboarding, /resetEmployeeOnboarding/);
  assert.match(screenshots, /feature: "screenshot_summaries"/);
  assert.match(retention, /CRON_SECRET/);
  assert.match(github, /isValidGithubWebhookSignature/);
  assert.match(ghl, /isValidGhlWebhookSignature/);
});

test("manager review route resolves the report inside the requested organization", async () => {
  const review = await source("src/app/api/work-os/reports/[reportId]/review/route.ts");
  assert.match(review, /roles: \["manager", "admin"\]/);
  assert.match(review, /organization_id[\s\S]*auth\.access\.organizationId/);
  assert.match(review, /requireWorkOsPersonAccess/);
});
