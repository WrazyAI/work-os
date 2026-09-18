import assert from "node:assert/strict";
import { existsSync } from "node:fs";
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
  const planInterpret = await source("src/app/api/work-os/me/plan/interpret/route.ts");
  const planRefine = await source("src/app/api/work-os/me/plan/refine/route.ts");
  const insights = await source("src/app/api/work-os/me/insights/route.ts");
  const tasks = await source("src/app/api/work-os/me/tasks/route.ts");
  const taskDetails = await source("src/app/api/work-os/me/tasks/[taskId]/route.ts");
  const applyInterpretation = await source("src/app/api/work-os/me/interpret/apply/route.ts");
  const interpretedProposals = await source("src/app/api/work-os/me/proposals/route.ts");
  const day = await source("src/app/api/work-os/me/day/route.ts");
  const dayView = await source("src/lib/work-os-day-view.ts");
  const attendance = await source("src/lib/work-os-attendance.ts");
  const attendanceProjection = await source("src/modules/work-os/attendance.ts");
  const attendanceSync = await source("src/app/api/work-os/attendance/sync-due/route.ts");
  const workdayService = await source("src/lib/work-os-workday.ts");
  assert.doesNotMatch(workdayService, /already confirmed on another device/);
  assert.match(workdayService, /The AI build is invalid, expired, already used/);
  const eodService = await source("src/lib/work-os-eod.ts");
  assert.match(eodService, /selectDayEodWork/);
  assert.doesNotMatch(eodService, /workspace\.carryOverGroups/);
  assert.match(eodService, /No tasks were completed on this date/);
  const scheduledShots = await source("src/app/api/work-os/evidence/screenshots/run-scheduled/route.ts");
  assert.match(scheduledShots, /runScheduledScreenshotAnalysis/);
  assert.match(scheduledShots, /CRON_SECRET/);
  assert.match(await source("src/lib/work-os-screenshots.ts"), /export function screenshotRunMode/);
  assert.match(await source("src/lib/work-os-screenshots.ts"), /terminallyAnalyzedFrames/);
  const onboardingService = await source("src/lib/work-os-onboarding.ts");
  const nifty = await source("src/lib/integrations/nifty.ts");
  const workOs = await source("src/lib/work-os-tasks.ts");
  assert.match(workOs, /raw->>created_by/);
  assert.match(workOs, /rawSubscriber/);
  assert.match(workOs, /providerAssignee/);
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
  assert.match(plan, /Legacy PATCH plan confirmation is no longer supported/);
  assert.doesNotMatch(plan, /saveDailyPlan\(auth\.access/);
  assert.match(planInterpret, /issueDailyPlanBuild/);
  assert.match(planInterpret, /build_id: buildId/);
  assert.match(planRefine, /issueDailyPlanBuild/);
  assert.match(planRefine, /build_id: buildId/);
  assert.match(plan, /updateDailyTaskSurface|updateDailyPlanOutcome/);
  assert.match(insights, /getPersonalInsights/);
  assert.match(insights, /requirePerson: true/);
  assert.match(insights, /day.*7d.*30d/);
  assert.match(day, /compact: url\.searchParams\.get\("compact"\) === "true"/);
  const outstandingEod = await source("src/app/api/work-os/me/eod/outstanding/route.ts");
  assert.match(outstandingEod, /requireWorkOsAccess/);
  assert.match(outstandingEod, /requirePerson: true/);
  assert.match(outstandingEod, /employee_companion/);
  assert.match(outstandingEod, /listOutstandingEods/);
  assert.match(outstandingEod, /days must be between 1 and 31/);
  assert.match(day, /date must be a valid calendar date/);
  assert.match(day, /localDate/);
  assert.match(await source("src/app/api/work-os/me/eod/ai-draft/route.ts"), /refineEodNarrative/);
  assert.match(await source("src/app/api/work-os/me/eod/ai-draft/route.ts"), /gatherEodScreenshotContext/);
  assert.match(await source("src/lib/aiEod.ts"), /export function sanitizeEodAnnotations/);
  assert.match(await source("src/lib/aiEod.ts"), /export async function gatherEodScreenshotContext/);
  assert.match(await source("src/lib/work-os-screenshots.ts"), /fetchScreenshotsForDay/);
  assert.doesNotMatch(await source("src/lib/work-os-screenshots.ts"), /fetchAllLogs/);
  assert.match(await source("src/lib/aiEod.ts"), /order\("observed_at"/);
  const workspace = await source("src/lib/work-os-daily-workspace.ts");
  assert.match(workspace, /items:work_daily_plan_items\(task_id,completion_state,disposition\)/);
  assert.match(workspace, /A saved daily plan is an explicit record/);
  assert.match(dayView, /select\(options\.compact \? "submitted_at" : "\*"\)/);
  assert.match(dayView, /suppressPromptForSubmittedEod\(workday\.prompt, reportResult\.data\?\.submitted_at/);
  assert.match(tasks, /view === "options"/);
  assert.match(tasks, /getWorkOsTaskCreationOptions/);
  assert.match(tasks, /createWorkOsEmployeeTask/);
  assert.match(tasks, /todayDate: requestedDate/);
  assert.match(tasks, /includeCompleted/);
  assert.match(tasks, /view === "open"/);
  assert.match(tasks, /listPersonOpenTasks\(ownerId, auth\.access\.personId as string\)/);
  assert.match(taskDetails, /export async function GET/);
  assert.match(taskDetails, /getWorkOsEmployeeTaskDetails/);
  assert.match(taskDetails, /export async function DELETE/);
  assert.match(taskDetails, /archiveWorkOsEmployeeTask/);
  assert.match(taskDetails, /deleteWorkOsEmployeeTask/);
  assert.match(taskDetails, /mode must be archive or delete/);
  assert.match(taskDetails, /export async function PATCH/);
  assert.match(taskDetails, /moveWorkOsEmployeeSubtask/);
  assert.match(taskDetails, /setWorkOsEmployeeTaskCompletion/);
  assert.match(taskDetails, /typeof body\.completed === "boolean"/);
  assert.match(taskDetails, /requirePerson: true/);
  assert.match(applyInterpretation, /status: 410/);
  assert.match(applyInterpretation, /persisted proposal/);
  // The retired direct-apply receipt path is gone for good: the tables are
  // dropped by migration 0045 and the orphaned lib no longer exists.
  assert.equal(existsSync(new URL("../src/lib/work-os-approved-update.ts", import.meta.url)), false);
  assert.equal(existsSync(new URL("../supabase/migrations/0045_drop_work_companion_commands.sql", import.meta.url)), true);
  assert.match(interpretedProposals, /Idempotency-Key is required/);
  assert.match(interpretedProposals, /requirePerson: true/);
  assert.match(interpretedProposals, /proposeInterpretedWorkUpdate/);
  assert.doesNotMatch(day, /draftWorkOsEod/);
  assert.match(nifty, /\/tasks\/\$\{encodeURIComponent\(taskId\)\}\/assignees/);
  assert.match(nifty, /method: "DELETE"/);
  assert.match(workOs, /Nifty did not confirm.*requested assignee/);
  assert.match(workOs, /status: "deleted"/);
  assert.match(workday, /clockIn\(auth\.access/);
  assert.match(workday, /loadPersistedWorktivityAttendance/);
  assert.doesNotMatch(workday, /observeWorktivityAttendance/);
  assert.doesNotMatch(workday, /work_os_fallback/);
  assert.match(attendance, /observeWorktivityAttendance/);
  assert.match(attendance, /\/ActivityLogs\/List/);
  assert.match(attendance, /EmployeeId: employeeId/);
  assert.match(attendance, /normalizeWorktivityActivityLogs/);
  assert.match(attendance, /syncWorktivitySession/);
  assert.match(attendance, /loadPersistedWorktivityAttendance/);
  assert.match(attendanceSync, /CRON_SECRET/);
  assert.match(attendanceSync, /syncDueWorktivityAttendance/);
  assert.doesNotMatch(attendance, /\.from\("work_sessions"\)\.insert/);
  assert.doesNotMatch(attendance, /state:\s*desiredState/);
  assert.match(attendanceProjection, /observed/i);
  assert.match(workdayService, /Exception clock-in acknowledgement is required/);
  assert.match(workdayService, /scheduled_starts_at: shift\?\.startsAt \?\? null/);
  assert.match(workdayService, /Manual pause and resume are disabled/);
  assert.match(workdayService, /worktivity:clock-in/);
  assert.match(workdayService, /p_build_id: buildId/);
  assert.match(workdayService, /p_intent_fingerprint: intentFingerprint/);
  assert.match(workdayService, /An AI build id is required for plan confirmation/);
  assert.doesNotMatch(workdayService, /export async function saveDailyPlan\(/);
  const checkinService = await source("src/lib/work-os-checkins.ts");
  assert.doesNotMatch(checkinService, /saveDailyPlan/);
  // Loom is an agent tool now: a check-in never carries or files a recording.
  assert.doesNotMatch(checkinService, /loom/i);
  const loomPreview = await source("src/app/api/work-os/me/loom/preview/route.ts");
  assert.match(loomPreview, /requireWorkOsAccess/);
  assert.match(loomPreview, /requirePerson: true/);
  assert.match(loomPreview, /feature: "employee_companion"/);
  assert.match(loomPreview, /loomMetadataEnabled/);
  assert.match(loomPreview, /parseLoomReference/);
  assert.match(loomPreview, /usableForDay/);
  assert.match(loomPreview, /url must be a Loom share link/);
  const loomAnalyze = await source("src/app/api/work-os/me/loom/analyze/route.ts");
  assert.match(loomAnalyze, /analyzeLoomForAgent/);
  assert.match(loomAnalyze, /Loom analysis is disabled for this organization/);
  assert.match(loomAnalyze, /targetDate/);
  const loomService = await source("src/lib/work-os-loom.ts");
  assert.match(loomService, /LOOM_HOSTS/);
  assert.match(loomService, /redirect: "error"/);
  assert.match(loomService, /uploadDate/);
  assert.match(loomService, /export function loomTemporal/);
  assert.match(loomService, /export function loomUsableForDay/);
  const loomAnalysis = await source("src/lib/aiLoom.ts");
  assert.match(loomAnalysis, /export async function analyzeLoomForAgent/);
  assert.match(loomAnalysis, /export async function analyzeLoomNarrative/);
  assert.match(loomAnalysis, /buildLoomAttachment/);
  const interpret = await source("src/app/api/work-os/me/interpret/route.ts");
  assert.match(interpret, /buildLoomAttachment/);
  const planInterpretLoom = await source("src/app/api/work-os/me/plan/interpret/route.ts");
  assert.match(planInterpretLoom, /buildLoomAttachment/);
  const aiDraft = await source("src/app/api/work-os/me/eod/ai-draft/route.ts");
  assert.match(aiDraft, /loom_prior_day/);
  assert.match(aiDraft, /grounding\.media = /);
  assert.doesNotMatch(workdayService, /This workday is already closed/);
  assert.match(onboardingService, /Consent can only be recorded during final onboarding submission/);
  assert.match(onboardingService, /work_submit_employee_onboarding/);
  assert.match(onboardingService, /work_consent_records/);
  assert.match(onboardingService, /timezone: String\(schedule\.timezone \?\? "UTC"\)/);
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

test("web onboarding reads back authoritative organization context", async () => {
  const employeeHome = await source("src/modules/work-os/EmployeeWorkOsHome.tsx");
  assert.match(employeeHome, /organizationSetup\?\.roleProfile\?\.name/);
  assert.match(employeeHome, /organizationSetup\?\.teams\?\.map/);
  assert.match(employeeHome, /organizationSetup\?\.managers\?\.map/);
  assert.match(employeeHome, /organizationSetup\?\.officialSchedule/);
  assert.match(employeeHome, /Official role/);
  assert.match(employeeHome, /Official schedule/);
});

test("work-os page provides a react-query client and API auth returns 401", async () => {
  const page = await source("src/app/work-os/page.tsx");
  const providers = await source("src/app/work-os/providers.tsx");
  const api = await source("src/lib/work-os-api.ts");
  assert.match(providers, /QueryClientProvider/);
  assert.match(providers, /new QueryClient\(\)/);
  assert.match(page, /WorkOsProviders/);
  assert.match(api, /NEXT_REDIRECT/);
  assert.match(api, /authentication required/);
  assert.match(api, /status: 401/);
});

test("auth proxy keeps desktop CORS and bearer bypass intact", async () => {
  const proxy = await source("src/proxy.ts");
  assert.match(proxy, /tauri:\/\/localhost/);
  assert.match(proxy, /Access-Control-Allow-Origin/);
  assert.match(proxy, /request\.method === "OPTIONS"/);
  assert.match(proxy, /workOsBearer/);
  assert.match(proxy, /Idempotency-Key/);
  assert.match(proxy, /isDesktopUpdaterDownload/);
});

test("web Insights follows the selected historical workspace date", async () => {
  const employeeHome = await source("src/modules/work-os/EmployeeWorkOsHome.tsx");
  assert.match(employeeHome, /const insightsThrough = selectedTaskDate \|\| day\.data\?\.shiftDate/);
  assert.match(employeeHome, /employee-insights", insightRange, insightsThrough/);
  assert.match(employeeHome, /through=\$\{encodeURIComponent\(insightsThrough \?\? ""\)\}/);
});

test("web employee drafts EODs for outstanding historical days", async () => {
  const employeeHome = await source("src/modules/work-os/EmployeeWorkOsHome.tsx");
  const outstanding = await source("src/modules/work-os/EmployeeEodOutstanding.tsx");
  assert.match(employeeHome, /eod\/outstanding\?days=14/);
  assert.match(employeeHome, /\/api\/work-os\/me\/day\?date=\$\{encodeURIComponent\(selectedTaskDate\)\}/);
  assert.match(employeeHome, /const eodDay = historical \? selectedDay\.data/);
  assert.match(employeeHome, /body: JSON\.stringify\(\{ date: eodDay\.shiftDate \}\)/);
  assert.match(employeeHome, /employee-eod-panel/);
  assert.match(employeeHome, /Draft EOD for \$\{calendarDateLabel\(selectedTaskDate\)\}/);
  assert.match(outstanding, /aria-label="Outstanding EODs/);
  assert.match(outstanding, /role="dialog"/);
  assert.match(outstanding, /outstandingRowMeta/);
});

test("proposal application is lease-fenced and reports explicit outcomes", async () => {
  const proposals = await source("src/lib/work-os-proposals.ts");
  assert.match(proposals, /export function proposalOutcome/);
  assert.match(proposals, /const applyAttempt = randomUUID\(\);/);
  assert.match(proposals, /\.eq\("apply_attempt", applyAttempt\)/);
  assert.match(proposals, /clearInterval\(heartbeat\)/);
  assert.match(proposals, /proposal\.apply_lease_lost/);
  assert.match(proposals, /return withOutcome\(/);
});

test("EOD review refuses self-approval", async () => {
  const eod = await source("src/lib/work-os-eod.ts");
  assert.match(eod, /report\.person_id === access\.personId/);
  assert.match(eod, /cannot review your own EOD report/i);
});

test("admin routes honor the selected organization", async () => {
  const api = await source("src/lib/work-os-api.ts");
  assert.match(api, /export async function requireWorkOsAdmin\(organizationId\?: string \| null\)/);
  assert.match(api, /roles: \["admin"\], organizationId: organizationId \?\? null/);
  const tasks = await source("src/app/api/work-os/tasks/route.ts");
  assert.match(tasks, /requireWorkOsAdmin\(req\.headers\.get\("x-work-os-organization-id"\)\)/);
  const status = await source("src/app/api/work-os/status/route.ts");
  assert.match(status, /export async function GET\(req: Request\)/);
  assert.match(status, /requireWorkOsAdmin\(req\.headers\.get\("x-work-os-organization-id"\)\)/);
});

test("local task completion is idempotent", async () => {
  const tasks = await source("src/lib/work-os-tasks.ts");
  assert.match(tasks, /if \(task\.completed === completed\) return task;/);
});
