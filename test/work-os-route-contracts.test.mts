import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { parseSelect, splitTopLevel } from "../src/lib/db/query";

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
  const worktivityControlRoute = await source("src/app/api/work-os/me/workday/worktivity-control/route.ts");
  const worktivityControlService = await source("src/lib/work-os-worktivity-control.ts");
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
  assert.match(workdayService, /worktivity:reopen:/, "the Worktivity sync reopens an interval the provider still reports open");
  assert.match(workdayService, /worktivity_reopened/, "a reopened interval records its own session event");
  const eodService = await source("src/lib/work-os-eod.ts");
  assert.match(eodService, /selectDayEodWork/);
  assert.doesNotMatch(eodService, /workspace\.carryOverGroups/);
  assert.match(eodService, /No tasks were completed on this date/);
  assert.match(await source("src/lib/work-os-eod-window.ts"), /resolveEodActivityWindow/, "the workday window resolves from the schedule, then the session");
  assert.match(await source("src/lib/work-os-eod-window.ts"), /withinEodActivityWindow/, "day facts are compared against the workday window");
  assert.match(await source("src/lib/work-os-eod-facts.ts"), /outsideShiftMarker/, "out-of-shift facts carry a plain marker");
  assert.match(await source("src/lib/work-os-eod.ts"), /eodActivityWindowFor/, "the deterministic draft resolves the workday window for fact labels");
  assert.match(await source("src/lib/aiEod.ts"), /outsideShiftMarker/, "the AI draft labels out-of-shift facts");
  assert.match(await source("src/lib/work-os-screenshot-hours.ts"), /eodActivityWindowFor/, "hourly EOD rollups follow the workday window");
  assert.match(await source("src/lib/aiEod.ts"), /eodActivityWindowFor/, "the EOD screenshot context follows the workday window");
  assert.match(await source("src/app/api/work-os/me/eod/ai-draft/route.ts"), /eodActivityWindowFor/, "the EOD draft's GitHub evidence follows the workday window");
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
  const activityIntervals = await source("src/app/api/work-os/me/activity-intervals/route.ts");
  const activityEnsure = await source("src/app/api/work-os/me/activity-intervals/ensure/route.ts");
  const activityDecision = await source("src/app/api/work-os/me/activity-intervals/[intervalId]/decision/route.ts");
  const activityEngine = await source("src/lib/work-os-activity-intervals.ts");
  const promptDelivery = await source("src/app/api/work-os/me/prompt-delivery/route.ts");
  assert.match(activityIntervals, /listActivityIntervals/);
  assert.match(activityIntervals, /requirePerson: true/);
  assert.match(activityEnsure, /ensureActivityInterval/);
  assert.match(activityEnsure, /prompt_due_at/);
  assert.match(activityEnsure, /activityIntervalFullView/, "the prompt turn carries the full evidence disclosure");
  assert.match(activityDecision, /decideActivityInterval/);
  assert.match(activityDecision, /action must be confirm or amend/);
  assert.match(activityDecision, /activityIntervalFullView/, "the decision response keeps the full disclosure");
  assert.match(activityEngine, /export function resolveActivityIntervalWindow/);
  assert.match(activityEngine, /export function selectIntervalEvidence/);
  assert.match(activityEngine, /export function parseIntervalSynthesis/);
  assert.match(activityEngine, /export function intervalProvenanceLabel/);
  assert.match(activityEngine, /export async function listActivityIntervalActivityLines/);
  assert.match(activityEngine, /memoryEnabled/, "interval recaps use Work Memory only behind the feature flag");
  assert.match(activityEngine, /buildTodaySnapshot/, "interval recaps receive the live day snapshot");
  assert.match(activityEngine, /buildMemoryPromptBlock/, "interval recaps recall memory as context");
  assert.match(activityEngine, /memoryUsed/, "interval coverage records whether memory context was used");
  assert.match(activityEngine, /github_evidence/, "interval recaps read GitHub activity only behind the feature flag");
  assert.match(activityEngine, /listGithubActivity/, "interval recaps receive attributed GitHub activity");
  assert.match(activityEngine, /formatGithubActivityBlock/, "interval recaps receive the GitHub prompt block");
  assert.match(activityEngine, /githubUsed/, "interval coverage records whether GitHub context was used");
  assert.match(activityEngine, /recorded_activity/, "the synthesis schema carries recorded GitHub activity");
  assert.match(activityEngine, /githubRecordedActivityAllowlist/, "recorded activity is validated against the recorded list");
  assert.match(await source("src/app/api/work-os/me/eod/ai-draft/route.ts"), /listGithubActivity/, "the EOD draft receives attributed GitHub activity");
  assert.match(await source("src/app/api/work-os/me/eod/ai-draft/route.ts"), /github_evidence/, "the EOD draft reads GitHub activity only behind the feature flag");
  assert.doesNotMatch(activityEngine, /recordWorkMemory/, "interval recaps consume memory without writing inferences back");
  assert.match(eodService, /listActivityIntervalActivityLines/);
  assert.match(eodService, /intervalProvenanceLabel/);
  assert.match(await source("src/app/api/work-os/me/eod/ai-draft/route.ts"), /listActivityIntervalActivityLines/);
  const nextStepsModule = await source("src/lib/work-os-next-steps.ts");
  assert.match(nextStepsModule, /parseNextSteps/, "next-step parsing is exported and validated");
  assert.match(nextStepsModule, /MAX_SUGGESTIONS/, "next-step suggestions are capped");
  assert.match(nextStepsModule, /source_interval_id/, "next-step proposals carry recap provenance");
  assert.match(nextStepsModule, /idempotency_key/, "next-step filing is idempotent per recap revision");
  assert.match(nextStepsModule, /suppressedSuggestionKeys/, "a skipped or rejected suggestion is remembered");
  assert.match(nextStepsModule, /review_status/, "only approved recaps generate next steps");
  assert.match(nextStepsModule, /and\(next_steps_status.eq.generating,updated_at.lte/, "a stale generation claim is recoverable without double-generating");
  assert.match(nextStepsModule, /getTaskByLocalOrProviderId/, "subtask suggestions carry the parent's current state so approvals apply");
  assert.match(nextStepsModule, /listRecapNextSteps/, "the chat moment reads the recap's suggestions");
  assert.match(nextStepsModule, /dismissRecapNextSteps/, "ending the moment dismisses undecided suggestions");
  assert.match(nextStepsModule, /expireStaleRecapSuggestions/, "undecided suggestions expire as a safety net");
  assert.match(nextStepsModule, /MIN_CONFIDENCE/, "suggestions below the confidence floor are dropped");
  const nextStepsRoute = await source("src/app/api/work-os/me/activity-intervals/[intervalId]/next-steps/route.ts");
  assert.match(nextStepsRoute, /listRecapNextSteps/, "the next-steps route reads the moment");
  assert.match(nextStepsRoute, /dismissRecapNextSteps/, "the next-steps route dismisses on request");
  assert.match(nextStepsRoute, /action must be dismiss/, "only an explicit dismissal is accepted");
  assert.match(activityEngine, /next_steps_status: "pending"/, "a recap decision queues the next-step pass");
  assert.match(activityDecision, /after\(/, "next-step generation is scheduled after the decision response");
  assert.match(activityDecision, /ensureRecapNextStepsForInterval/, "the decision kicks its own recap's generation");
  assert.match(activityEnsure, /after\(/, "the ensure route drains stale next-step passes after the response");
  assert.match(activityEnsure, /ensureRecapNextSteps/, "the ensure route drains stale next-step passes");
  assert.match(activityEngine, /loadIntervalEvidence/, "the stream loads the recap evidence it renders");
  const screenshotsService = await source("src/lib/work-os-screenshots.ts");
  assert.match(screenshotsService, /work_activity_interval_evidence/, "retention marks interval evidence expiry without deleting the recap");
  assert.match(screenshotsService, /export async function prepareScreenshotWindow/);
  assert.match(screenshotsService, /export async function retainedScreenshotImage/);
  assert.match(screenshotsService, /max_tokens: SCREENSHOT_VISION_MAX_TOKENS/, "the vision request bounds its completion budget so low provider credit cannot fail pre-authorization");
  assert.doesNotMatch(activityEngine, /from\("work_check_ins"\)/, "AI inference never creates employee check-ins");
  assert.doesNotMatch(activityEngine, /from\("work_sessions"\)\s*\.\s*(update|upsert)/, "AI inference never fakes the substantive-update cadence");
  assert.match(promptDelivery, /markActivityIntervalNotified/);
  assert.match(worktivityControlRoute, /x-work-os-desktop-control/);
  assert.match(worktivityControlRoute, /A Worktivity control request object is required/);
  assert.match(worktivityControlRoute, /key !== body\.operation_id/);
  assert.match(worktivityControlService, /forceRefresh: true/);
  assert.match(worktivityControlService, /phase === "confirm"/);
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
  assert.match(tasks, /listPersonTaskPage\(ownerId, auth\.access\.organizationId, auth\.access\.personId as string/);
  assert.match(tasks, /cursor: params\.get\("cursor"\)/);
  assert.match(tasks, /search,/);
  assert.match(tasks, /const limit = Math\.min\(50, requestedLimit\)/);
  assert.match(tasks, /excludeToday/);
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
  assert.doesNotMatch(workday, /clockIn\(auth\.access/);
  assert.match(workday, /Attendance is controlled by Worktivity from the Windows Companion/);
  assert.match(worktivityControlRoute, /x-work-os-desktop-control/);
  assert.match(worktivityControlRoute, /Idempotency-Key must match operation_id/);
  assert.match(worktivityControlService, /forceRefresh: true/);
  assert.match(worktivityControlService, /decideWorktivityAction/);
  assert.match(worktivityControlService, /worktivityConfirmationRequirement/);
  assert.match(worktivityControlService, /status: "pending"/);
  assert.match(workday, /loadPersistedWorktivityAttendance/);
  assert.doesNotMatch(workday, /observeWorktivityAttendance/);
  assert.doesNotMatch(workday, /work_os_fallback/);
  assert.match(attendance, /observeWorktivityAttendance/);
  assert.match(attendance, /\/ActivityLogs\/List/);
  assert.match(attendance, /EmployeeId: employeeId/);
  assert.match(attendance, /normalizeWorktivityActivityLogs/);
  assert.match(attendance, /syncWorktivitySession/);
  // Completing or reopening a task must keep the plan's commitment state aligned.
  assert.match(await source("src/lib/work-os-employee-tasks.ts"), /syncPlanItemCompletion\(\{/);
  // A second work interval on the same shift row must re-stamp the
  // substantive update so the check-in cadence does not read stale progress.
  assert.match(await source("src/lib/work-os-workday.ts"), /restarted \? \{ last_substantive_update_at: projection\.observedAt \} : \{\}/);
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
  assert.match(loomService, /LOOM_CDN_HOSTS/);
  assert.match(loomService, /redirect: "error"/);
  assert.match(loomService, /uploadDate/);
  assert.match(loomService, /transcription_status/);
  assert.match(loomService, /captions_source_url/);
  assert.match(loomService, /export function parseLoomTranscriptRecord/);
  assert.match(loomService, /export async function fetchLoomTranscript/);
  assert.match(loomService, /updateText/);
  assert.match(loomService, /source: pasted \? "employee_paste" : extracted \? "loom" : inferred \? "update_text" : null/);
  assert.match(loomService, /export function loomTemporal/);
  assert.match(loomService, /export function loomUsableForDay/);
  const loomAnalysis = await source("src/lib/aiLoom.ts");
  assert.match(loomAnalysis, /export async function analyzeLoomForAgent/);
  assert.match(loomAnalysis, /export async function analyzeLoomNarrative/);
  assert.match(loomAnalysis, /buildLoomAttachment/);
  assert.match(loomAnalysis, /transcriptSource: feed\.bundle\.transcript\.source/);
  const interpret = await source("src/app/api/work-os/me/interpret/route.ts");
  assert.match(interpret, /buildLoomAttachment/);
  const planInterpretLoom = await source("src/app/api/work-os/me/plan/interpret/route.ts");
  assert.match(planInterpretLoom, /buildLoomAttachment/);
  assert.match(planInterpretLoom, /loomInput\?\.transcript/);
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

test("employee destinations are nested routes with legacy ?tab= redirects", async () => {
  const routes = await source("src/modules/work-os/employee-routes.ts");
  assert.match(routes, /EMPLOYEE_DESTINATIONS/);
  assert.match(routes, /\{ id: "today", label: "Today", href: "\/work-os\/today" \}/);
  assert.match(routes, /\{ id: "tasks", label: "Tasks", href: "\/work-os\/tasks" \}/);
  assert.match(routes, /\{ id: "review", label: "Review", href: "\/work-os\/review" \}/);
  assert.match(routes, /\{ id: "insights", label: "Insights", href: "\/work-os\/insights" \}/);
  assert.match(routes, /\{ id: "settings", label: "Settings", href: "\/work-os\/settings" \}/);
  assert.match(routes, /reports: "review"/);
  assert.match(routes, /evidence: "review"/);
  assert.match(routes, /people: "today"/);
  const page = await source("src/app/work-os/page.tsx");
  assert.match(page, /redirect\(employeeDestinationForLegacyTab\(tab\)\)/);
  assert.match(page, /redirect\(tab \? LEGACY_ADMIN_TAB_ROUTES\[tab\] \?\? "\/work-os\/admin" : "\/work-os\/admin"\)/);
  for (const route of ["today", "tasks", "review", "insights", "settings"]) {
    assert.ok(existsSync(new URL(`src/app/work-os/(employee)/${route}/page.tsx`, root)), `missing employee route ${route}`);
  }
  const layout = await source("src/app/work-os/(employee)/layout.tsx");
  assert.match(layout, /canUseEmployeeWorkspace/);
  assert.match(layout, /redirect\("\/work-os"\)/);
  const access = await source("src/lib/work-os-page-access.ts");
  assert.match(access, /export async function resolveWorkOsPageAccess/);
  assert.match(access, /status === 401\) redirect\("\/login"\)/);
});

test("the Work OS dispatcher keeps manager review and the admin workspace", async () => {
  const workOsHome = await source("src/modules/work-os/WorkOsHome.tsx");
  assert.match(workOsHome, /session\.data\?\.role === "manager"/);
  assert.match(workOsHome, /<ManagerWorkOsHome \/>/);
  assert.doesNotMatch(workOsHome, /EmployeeWorkOsHome/);
  assert.doesNotMatch(workOsHome, /surface=admin/);
  assert.match(workOsHome, /Opening your workspace/);
  assert.match(workOsHome, /href="\/work-os\/admin"/);
  const adminLayout = await source("src/app/work-os/admin/layout.tsx");
  assert.match(adminLayout, /resolveWorkOsPageAccess/);
  assert.match(adminLayout, /resolved\.access\.role !== "admin"/);
  assert.match(adminLayout, /redirect\("\/work-os"\)/);
});

test("web onboarding reads back authoritative organization context", async () => {
  const settings = await source("src/modules/work-os/employee/EmployeeSettings.tsx");
  assert.match(settings, /organizationSetup\?\.roleProfile\?\.name/);
  assert.match(settings, /organizationSetup\?\.teams\?\.map/);
  assert.match(settings, /organizationSetup\?\.managers\?\.map/);
  assert.match(settings, /officialSchedule/);
  assert.match(settings, /Official role/);
  assert.match(settings, /Official schedule/);
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

test("web Insights follows the selected through date", async () => {
  const insights = await source("src/modules/work-os/employee/EmployeeInsights.tsx");
  assert.match(insights, /setThrough\(\(current\) => current \|\| day\.data!\.shiftDate\)/);
  assert.match(insights, /"employee-insights", range, through/);
  assert.match(insights, /through=\$\{encodeURIComponent\(through\)\}/);
});

test("web Review drafts EODs for outstanding historical days", async () => {
  const review = await source("src/modules/work-os/employee/EmployeeReview.tsx");
  const dayHook = await source("src/modules/work-os/employee/useEmployeeDay.ts");
  assert.match(dayHook, /eod\/outstanding\?days=14/);
  assert.match(review, /\/api\/work-os\/me\/day\?date=\$\{encodeURIComponent\(selectedDate\)\}/);
  assert.match(review, /const eodDay = historical \? selectedDay\.data/);
  assert.match(review, /body: JSON\.stringify\(\{ date \}\)/);
  assert.match(review, /employee-eod-panel/);
  assert.match(review, /employee-eod-editor/);
  assert.match(review, /Draft EOD for \$\{calendarDateLabel\(selectedDate\)\}/);
  assert.match(review, /outstandingRowMeta/);
  assert.match(review, /Outstanding EODs/);
  // The assistant draft is the default on both surfaces: the web creates the
  // standard record, asks the assistant, and refines without rewriting the
  // Bottleneck section.
  assert.match(review, /\/api\/work-os\/me\/eod\/ai-draft/);
  assert.match(review, /stripBottleneckSection\(reportMarkdown\)/);
  assert.match(review, /prepareOneScreenshotRound\(date\)/);
  assert.match(review, /Redraft with assistant/);
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
  assert.match(api, /export async function requireWorkOsAdmin\(organizationId\?: string \| null, authorization\?: string \| null\)/);
  assert.match(api, /roles: \["admin"\], organizationId: organizationId \?\? null, authorization: authorization \?\? null/);
  const tasks = await source("src/app/api/work-os/tasks/route.ts");
  assert.match(tasks, /requireWorkOsAdmin\(req\.headers\.get\("x-work-os-organization-id"\), req\.headers\.get\("authorization"\)\)/);
  const status = await source("src/app/api/work-os/status/route.ts");
  assert.match(status, /export async function GET\(req: Request\)/);
  assert.match(status, /requireWorkOsAdmin\(req\.headers\.get\("x-work-os-organization-id"\), req\.headers\.get\("authorization"\)\)/);
  // The installed companion authorizes with its bearer device session on every
  // administration surface, alongside the organization it selected.
  const overview = await source("src/app/api/work-os/admin/overview/route.ts");
  assert.match(overview, /requireWorkOsAdmin\(req\.headers\.get\("x-work-os-organization-id"\), req\.headers\.get\("authorization"\)\)/);
  for (const path of [
    "src/app/api/work-os/admin/insights/route.ts",
    "src/app/api/work-os/organization/route.ts",
    "src/app/api/work-os/people/route.ts",
    "src/app/api/work-os/evidence/route.ts",
  ]) {
    const text = await source(path);
    assert.match(text, /authorization: req\.headers\.get\("authorization"\)/);
  }
});

test("local task completion is idempotent", async () => {
  const tasks = await source("src/lib/work-os-tasks.ts");
  assert.match(tasks, /if \(task\.completed === completed\) return task;/);
});

test("admin workspace routes are role-gated and organization-scoped", async () => {
  const overview = await source("src/app/api/work-os/admin/overview/route.ts");
  assert.match(overview, /requireWorkOsAdmin/);
  const insights = await source("src/app/api/work-os/admin/insights/route.ts");
  assert.match(insights, /roles: \["manager", "admin"\]/);
  assert.match(insights, /getAdminInsights/);
  assert.match(insights, /requireWorkOsPersonAccess/);
  assert.match(insights, /accessibleWorkOsPersonIds/);
  const intervals = await source("src/app/api/work-os/admin/activity-intervals/route.ts");
  assert.match(intervals, /requireWorkOsPersonAccess/);
  assert.match(intervals, /accessibleWorkOsPersonIds/);
  assert.match(intervals, /listAdminActivityIntervals/);
  const person = await source("src/app/api/work-os/admin/people/[personId]/route.ts");
  assert.match(person, /requireWorkOsPersonAccess/);
  assert.match(person, /organizationId/);
  const layout = await source("src/app/work-os/admin/layout.tsx");
  assert.match(layout, /resolveWorkOsPageAccess/);
  assert.match(layout, /redirect\("\/work-os"\)/);
  const shell = await source("src/modules/work-os/admin/AdminShell.tsx");
  assert.match(shell, /data-work-os-workspace/);
  assert.match(shell, /\/work-os\/today/);
});

test("evidence and report lists expose bounded filters for the admin surfaces", async () => {
  const evidence = await source("src/app/api/work-os/evidence/route.ts");
  assert.match(evidence, /correction/);
  assert.match(evidence, /evidence_date/);
  assert.match(evidence, /Math\.min\(500/);
  const reports = await source("src/app/api/work-os/reports/route.ts");
  assert.match(reports, /counts/);
  assert.match(reports, /pending_review/);
  assert.match(reports, /requireWorkOsPersonAccess/);
});

test("admin queries stay within the Postgres shim's filter capabilities", async () => {
  // The query shim supports embeds for selects only; filters on embedded
  // columns fail at runtime with `invalid identifier`, so plan dates resolve
  // through a plan-id lookup and correction filters resolve event ids first.
  const insights = await source("src/lib/work-os-admin-insights.ts");
  assert.match(insights, /work_daily_plans/);
  assert.doesNotMatch(insights, /plan\.shift_date/);
  assert.match(insights, /\.in\("plan_id", planIds\)/);
  const evidence = await source("src/app/api/work-os/evidence/route.ts");
  assert.match(evidence, /correctionEventIds/);
  assert.doesNotMatch(evidence, /event\.correction_status/);
});

test("github evidence ingestion stays bounded and attributable", async () => {
  const webhooks = await source("src/lib/work-os-provider-webhooks.ts");
  assert.match(webhooks, /repository\.default_branch/);
  assert.match(webhooks, /action !== "submitted"/);
  assert.match(webhooks, /action !== "completed"/);
  const route = await source("src/app/api/work-os/integrations/github/webhook/route.ts");
  assert.match(route, /externalActorAliases/);
  assert.match(route, /actor: \{ id: actorId, login: actorLogin \}/);
  const evidence = await source("src/lib/work-os-evidence.ts");
  assert.match(evidence, /export async function attributeProviderActor/);
  assert.match(evidence, /metadata->actor->>id/);
  assert.match(evidence, /metadata->actor->>login/);
  assert.match(evidence, /metadata->>login/);
  assert.match(evidence, /escapeLikePattern/);
  assert.match(evidence, /externalActorAliases/);
  const connections = await source("src/app/api/work-os/integrations/connections/route.ts");
  assert.match(connections, /attributeProviderActor/);
});

test("github admin integration routes stay admin-scoped and token-safe", async () => {
  const actors = await source("src/app/api/work-os/admin/integrations/github/actors/route.ts");
  assert.match(actors, /requireWorkOsAdmin/);
  assert.match(actors, /organizationId/);
  const repos = await source("src/app/api/work-os/admin/integrations/github/repos/route.ts");
  assert.match(repos, /requireWorkOsAdmin/);
  assert.match(repos, /githubWebhookSecret/);
  assert.match(repos, /withRepoConfigLock/);
  assert.match(repos, /loadGithubConnectionById/);
  assert.match(repos, /findGithubRepoHook/);
  assert.match(repos, /alignGithubRepoHook/);
  assert.match(repos, /orgWebhookEnabled/);
  const integration = await source("src/lib/integrations/github.ts");
  assert.match(integration, /GITHUB_WEBHOOK_PATH/);
  assert.match(integration, /WORK_OS_GITHUB_ADMIN_TOKEN/);
  assert.doesNotMatch(integration, /console\.log/);
});

test("the evidence page blurs future integrations and surfaces github state", async () => {
  const evidence = await source("src/modules/work-os/admin/AdminEvidence.tsx");
  assert.match(evidence, /Coming soon/);
  assert.match(evidence, /Unmapped GitHub accounts/);
  assert.match(evidence, /Map &amp; backfill/);
  assert.match(evidence, /Manage repositories/);
  const settings = await source("src/modules/work-os/admin/AdminSettings.tsx");
  assert.match(settings, /GHL — coming soon/);
  assert.match(settings, /comingSoon/);
  assert.match(evidence, /Organization webhook active/);
  assert.match(evidence, /Covered by organization/);
});

/** Column names per table, unioned from every CREATE TABLE body and ALTER
 * TABLE ... ADD COLUMN statement in the Work OS migration chain. The chain is
 * what `npm run db:apply:work-os` feeds to the database, so a select column
 * that passes here exists against an applied schema. */
async function migrationTableColumns() {
  const migrations = new URL("supabase/migrations/", root);
  const files = (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort();
  const tables = new Map<string, Set<string>>();
  const columnsFor = (table: string): Set<string> => {
    const existing = tables.get(table);
    if (existing) return existing;
    const created = new Set<string>();
    tables.set(table, created);
    return created;
  };
  for (const file of files) {
    const sql = await readFile(new URL(file, migrations), "utf8");
    const create = /create table(?: if not exists)?\s+([a-z_][a-z0-9_]*)\s*\(/gi;
    for (let match = create.exec(sql); match; match = create.exec(sql)) {
      const bodyStart = create.lastIndex;
      let depth = 1;
      let index = bodyStart;
      while (index < sql.length && depth > 0) {
        if (sql[index] === "(") depth += 1;
        else if (sql[index] === ")") depth -= 1;
        index += 1;
      }
      const columns = columnsFor(match[1]!.toLowerCase());
      for (const part of splitTopLevel(sql.slice(bodyStart, index - 1))) {
        const name = part.trim().split(/\s+/)[0]?.replace(/"/g, "").toLowerCase();
        // Table-level constraint lines are not columns.
        if (!name || /^(constraint|primary|foreign|unique|check|exclude)$/.test(name)) continue;
        columns.add(name);
      }
      create.lastIndex = index;
    }
    const alter = /alter table\s+(?:only\s+)?([a-z_][a-z0-9_]*)\s+([\s\S]*?);/gi;
    for (let match = alter.exec(sql); match; match = alter.exec(sql)) {
      const columns = columnsFor(match[1]!.toLowerCase());
      const added = /add column(?: if not exists)?\s+([a-z_][a-z0-9_]*)/gi;
      for (let column = added.exec(match[2]!); column; column = added.exec(match[2]!)) {
        columns.add(column[1]!.toLowerCase());
      }
    }
  }
  return tables;
}

/** The `.from(table).select("...")` specs a route sends, verbatim. */
function selectSpecs(text: string, table: string) {
  const specs: string[] = [];
  const pattern = new RegExp(`\\.from\\("${table}"\\)[\\s\\S]{0,160}?\\.select\\("([^"]+)"`, "g");
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) specs.push(match[1]!);
  return specs;
}

/** Fails on the first select column the migration DDL does not define, on the
 * base table or on an embedded table, exactly like the Postgres shim fails at
 * query time. Embeds are parsed with the shim's own parser so the check cannot
 * drift from runtime behavior. */
function assertSelectColumnsExist(spec: string, table: string, tables: Map<string, Set<string>>, route: string) {
  const parsed = parseSelect(spec);
  if (parsed.base !== "*") {
    for (const column of splitTopLevel(parsed.base)) {
      const name = column.trim().replace(/"/g, "");
      assert.ok(tables.get(table)?.has(name), `${route}: ${table} has no column "${name}" (select "${spec}")`);
    }
  }
  for (const embed of parsed.embeds) {
    assert.ok(tables.has(embed.table), `${route}: unknown embedded table "${embed.table}"`);
    if (embed.columns !== "*") {
      for (const column of embed.columns) {
        const name = column.trim().replace(/"/g, "");
        assert.ok(tables.get(embed.table)?.has(name), `${route}: ${embed.table} has no column "${name}" (embed in "${spec}")`);
      }
    }
  }
}

test("admin task routes only select columns that exist in the migration DDL", async () => {
  const tables = await migrationTableColumns();
  // The detail drawer's GET: a wrong column here surfaces as
  // `load task subtasks: column "name" does not exist` in the drawer.
  const detail = await source("src/app/api/work-os/tasks/[taskId]/route.ts");
  const detailSpecs = selectSpecs(detail, "work_tasks");
  assert.equal(detailSpecs.length, 1, "the admin task-detail GET selects work_tasks columns");
  assert.match(detailSpecs[0]!, /project:work_projects\(id,name\)/, "the detail select keeps the project embed");
  assertSelectColumnsExist(detailSpecs[0]!, "work_tasks", tables, "tasks/[taskId]");
  // The list route's head-only workload counts select the same two tables.
  const list = await source("src/app/api/work-os/tasks/route.ts");
  assert.ok(selectSpecs(list, "work_tasks").length >= 1, "the admin task list counts work_tasks rows");
  for (const spec of selectSpecs(list, "work_tasks")) assertSelectColumnsExist(spec, "work_tasks", tables, "tasks");
  for (const spec of selectSpecs(list, "work_task_day_events")) assertSelectColumnsExist(spec, "work_task_day_events", tables, "tasks");
  // The list rows come from the shared lib query; it must keep the wildcard
  // select so every created/updated stamp reaches the companion's default
  // newest-created ordering, which falls back through updated and due when a
  // stamp is absent or ties.
  const lib = await source("src/lib/work-os-tasks.ts");
  assert.match(lib, /\.from\("work_tasks"\)\s*\.select\("\*/, "the shared task list selects every work_tasks column");
  // A guard on the guard: the DDL parser must actually see the title column.
  assert.ok(tables.get("work_tasks")?.has("title"), "work_tasks DDL parsed with its title column");
  assert.ok(!tables.get("work_tasks")?.has("name"), "work_tasks has no name column");
});

test("an unfinished day cannot be drafted, and a draft can be deleted", async () => {
  const gate = await source("src/lib/work-os-shift-gate.ts");
  assert.match(gate, /export function shiftStillOpen/, "one predicate decides whether the workday is still open");
  assert.match(gate, /EOD_SHIFT_OPEN_REASON = "shift_open"/, "the refusal carries a machine-readable reason");
  const gateService = await source("src/lib/work-os-eod-shift-gate.ts");
  assert.match(gateService, /eodDraftShiftGate/, "the server resolves the gate from the session and the provider observation");
  assert.match(gateService, /work_sessions/, "the gate reads the mirrored session");
  assert.match(gateService, /work_attendance_observations/, "the gate reads the provider observation");
  const eodService = await source("src/lib/work-os-eod.ts");
  assert.match(eodService, /eodDraftShiftGate/, "the draft refuses a day whose shift is still open");
  assert.match(eodService, /EOD_SHIFT_OPEN_REASON/, "the refusal names the shift_open reason");
  assert.match(eodService, /export async function deleteWorkOsEodDraft/, "an unsubmitted EOD draft can be deleted");
  assert.match(eodService, /\["draft", "rejected"\]/, "only a draft or rejected report can be deleted");
  assert.match(eodService, /report\.deleted/, "the deletion is written to the audit log");
  const draftRoute = await source("src/app/api/work-os/me/eod/ai-draft/route.ts");
  assert.match(draftRoute, /eodDraftShiftGate/, "the assistant draft refuses a day whose shift is still open");
  assert.match(draftRoute, /isRefinement/, "refining an existing draft stays available while the shift is open");
  const deleteRoute = await source("src/app/api/work-os/reports/[reportId]/route.ts");
  assert.match(deleteRoute, /export async function DELETE/, "the report route deletes a draft");
  assert.match(deleteRoute, /requireWorkOsPersonAccess/, "the delete is scoped to the caller's person");
  assert.match(deleteRoute, /deleteWorkOsEodDraft/);
});
