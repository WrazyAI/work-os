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
  const insights = await source("src/app/api/work-os/me/insights/route.ts");
  const tasks = await source("src/app/api/work-os/me/tasks/route.ts");
  const taskDetails = await source("src/app/api/work-os/me/tasks/[taskId]/route.ts");
  const attendance = await source("src/lib/work-os-attendance.ts");
  const attendanceProjection = await source("src/modules/work-os/attendance.ts");
  const workdayService = await source("src/lib/work-os-workday.ts");
  const onboardingService = await source("src/lib/work-os-onboarding.ts");
  assert.match(checkIns, /idempotency-key/);
  assert.match(proposals, /decision_idempotency_key/);
  assert.match(reports, /requireWorkOsAccess/);
  assert.match(reports, /requirePerson: true/);
  assert.match(evidence, /idempotency-key/);
  assert.match(workday, /Idempotency-Key is required/);
  assert.match(workday, /requirePerson: true/);
  assert.match(plan, /Idempotency-Key is required/);
  assert.match(plan, /requirePerson: true/);
  assert.match(plan, /export async function PUT/);
  assert.match(plan, /saveDailyPlanDraft/);
  assert.match(plan, /updateDailyTaskSurface|updateDailyPlanOutcome/);
  assert.match(insights, /getPersonalInsights/);
  assert.match(insights, /requirePerson: true/);
  assert.match(insights, /day.*7d.*30d/);
  assert.match(tasks, /view === "options"/);
  assert.match(tasks, /getWorkOsTaskCreationOptions/);
  assert.match(tasks, /createWorkOsEmployeeTask/);
  assert.match(tasks, /todayDate: requestedDate/);
  assert.match(tasks, /includeCompleted/);
  assert.match(taskDetails, /export async function GET/);
  assert.match(taskDetails, /getWorkOsEmployeeTaskDetails/);
  assert.match(taskDetails, /export async function DELETE/);
  assert.match(taskDetails, /archiveWorkOsEmployeeTask/);
  assert.match(taskDetails, /export async function PATCH/);
  assert.match(taskDetails, /moveWorkOsEmployeeSubtask/);
  assert.match(taskDetails, /setWorkOsEmployeeTaskCompletion/);
  assert.match(taskDetails, /typeof body\.completed === "boolean"/);
  assert.match(taskDetails, /requirePerson: true/);
  assert.match(workday, /clockIn\(auth\.access/);
  assert.doesNotMatch(workday, /reconcileWorktivityAttendance|work_os_fallback/);
  assert.match(attendance, /observeWorktivityAttendance/);
  assert.match(attendance, /\/ActivityLogs\/List/);
  assert.match(attendance, /EmployeeId: employeeId/);
  assert.match(attendance, /normalizeWorktivityActivityLogs/);
  assert.doesNotMatch(attendance, /reconcileSession\(/);
  assert.doesNotMatch(attendance, /\.from\("work_sessions"\)\.insert/);
  assert.doesNotMatch(attendance, /state:\s*desiredState/);
  assert.match(attendanceProjection, /observed/i);
  assert.match(workdayService, /Exception clock-in acknowledgement is required/);
  assert.match(workdayService, /scheduled_starts_at: shift\?\.startsAt \?\? null/);
  assert.match(workdayService, /Manual pause and resume are disabled/);
  assert.match(onboardingService, /Consent can only be recorded during final onboarding submission/);
  assert.match(onboardingService, /work_submit_employee_onboarding/);
  assert.match(onboardingService, /work_consent_records/);
  assert.match(onboardingService, /reacceptance requires the Safe-phase final submission/);
  assert.doesNotMatch(onboardingService, /accept_screenshot_analysis/);
});

test("privacy and provider routes retain the pilot safety gates", async () => {
  const onboarding = await source("src/app/api/work-os/me/onboarding/route.ts");
  const screenshots = await source("src/app/api/work-os/evidence/screenshots/[summaryId]/access/route.ts");
  const retention = await source("src/app/api/work-os/evidence/screenshots/retention/route.ts");
  const dueSync = await source("src/app/api/work-os/evidence/screenshots/sync-due/route.ts");
  const screenshotService = await source("src/lib/work-os-screenshots.ts");
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
  assert.match(dueSync, /CRON_SECRET/);
  assert.match(screenshotService, /feature_flags/);
  assert.match(screenshotService, /employeeTrackingConsent/);
  assert.match(screenshotService, /screenshot\.due_sync_completed/);
  assert.match(screenshotService, /timezoneByPerson/);
  assert.doesNotMatch(screenshotService, /privacy_preferences\.screenshotAnalysisConsent/);
  assert.doesNotMatch(screenshotService, /onboarding:work_employee_onboarding/);
  assert.match(github, /isValidGithubWebhookSignature/);
  assert.match(ghl, /isValidGhlWebhookSignature|validGhlSignature/);
});

test("manager review route resolves the report inside the requested organization", async () => {
  const review = await source("src/app/api/work-os/reports/[reportId]/review/route.ts");
  assert.match(review, /roles: \["manager", "admin"\]/);
  assert.match(review, /organization_id[\s\S]*auth\.access\.organizationId/);
  assert.match(review, /requireWorkOsPersonAccess/);
});

test("mapped administrators default to their unified employee workspace", async () => {
  const workOsHome = await source("src/modules/work-os/WorkOsHome.tsx");
  assert.match(workOsHome, /const adminSurface = searchParams\.get\("surface"\) === "admin"/);
  assert.match(workOsHome, /session\.data\?\.role === "admin" && session\.data\.personId && !adminSurface/);
  assert.match(workOsHome, /<EmployeeWorkOsHome \/>/);
  assert.match(workOsHome, /router\.push\("\/work-os\?surface=admin"\)/);
  assert.match(workOsHome, /router\.push\("\/work-os"\)/);
});
