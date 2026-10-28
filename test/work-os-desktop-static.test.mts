import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../desktop/work-os-companion");
const read = (relativePath: string) => readFileSync(resolve(root, relativePath), "utf8");

const entrypoint = read("src-tauri/src/main.rs");
assert.match(entrypoint, /cfg_attr\(windows, windows_subsystem = "windows"\)/);
assert.doesNotMatch(entrypoint, /cfg_attr\(not\(debug_assertions\), windows_subsystem/);

const rust = read("src-tauri/src/lib.rs");
assert.doesNotMatch(rust, /WebviewUrl::App\("index\.html\?debug=1"/);
assert.doesNotMatch(rust, /get_webview_window\("debug"\)/);
assert.match(rust, /set_focus\(\)/);
const debugHost = read("src-tauri/src/debug_window.rs");
assert.match(debugHost, /WebviewUrl::App\("debug\.html"\.into\(\)\)/);
assert.doesNotMatch(debugHost, /\?debug=1/);

const frontend = read("src/main.tsx");
assert.doesNotMatch(frontend, /getCurrentWindow\(\)\.label === "debug"/);

const onboarding = read("src/Onboarding.tsx");
assert.match(onboarding, /aria-busy=\{busy\}/);
assert.match(onboarding, /onNotify\("error"/);
assert.doesNotMatch(onboarding, /onboarding-error/);
assert.match(onboarding, /Sign out/);
assert.match(onboarding, /onLogout/);
assert.match(onboarding, /Seen/);
assert.match(onboarding, /Understood/);
assert.match(onboarding, /In control/);
assert.match(onboarding, /Connected/);
assert.match(onboarding, /onSaveDraft/);
assert.match(onboarding, /shouldHydrateOnboardingForm/);
assert.match(onboarding, /aria-activedescendant/);
assert.match(onboarding, /ArrowDown/);
assert.match(onboarding, /ArrowUp/);
assert.match(onboarding, /e\.key==="Home"/);
assert.match(onboarding, /e\.key==="End"/);
assert.match(onboarding, /createCoalescedDraftQueue/);
assert.match(onboarding, /I accept Work OS tracking and the sampled screenshot-analysis policy/);
assert.doesNotMatch(onboarding, /Allow neutral screenshot summaries/);
const styles = read("src/styles.css");
assert.match(styles, /prefers-reduced-motion/);
const redesignStyles = read("src/workspace-redesign.css");
assert.match(redesignStyles, /\.goal-composer-panel/);
assert.match(redesignStyles, /\.goal-card-edit/);
assert.match(redesignStyles, /\.goal-editor-actions/);
assert.match(redesignStyles, /\.focus-edit-button/);

const app = read("src/App.tsx");
const boot = read("src/BootHandoff.tsx");
const bootModel = read("src/bootSurface.ts");
const insightsView = read("src/InsightsView.tsx");
const taskSurfaces = read("src/taskSurfaces.tsx");
const personalSettings = read("src/PersonalSettings.tsx");

// First run is the one place the employee meets the product, so the companion
// hosts it: the stage carries Otto and his spoken line, and the loading screen
// carries the same figure in a real state instead of a logo badge.
const onboardingStage = read("src/OnboardingStage.tsx");
assert.match(onboarding, /import \{ OnboardingStage, STAGE_POSE/);
assert.match(onboarding, /data-stage=\{stage\}/);
assert.match(onboarding, /<OnboardingStage/);
assert.doesNotMatch(onboarding, /phase-path|phase-art|story-copy/);
assert.match(onboardingStage, /import \{ MascotPet \} from "\.\/MascotPet"/);
assert.match(onboardingStage, /export const STAGE_POSE/);
assert.match(onboardingStage, /import \{ MASCOT \} from "\.\/mascot"/);
assert.match(onboardingStage, /aria-live="polite"/);
assert.match(onboardingStage, /topRight\?: ReactNode/);
assert.match(onboardingStage, /\{topRight\}/);
// Sign out lives in the stage's top-right corner, so it is reachable before
// setup starts and does not move when the panel opens.
assert.match(onboarding, /topRight=\{<SessionControls/);
assert.match(onboarding, /if \(!hydrated\.current \|\| stage !== "form"/);
assert.doesNotMatch(onboardingStage, /studio-otto\.svg|work-os-companion\.png/);
assert.match(read("src/onboarding-stage.css"), /prefers-reduced-motion: reduce/);
// `main` is read further down this file; read the entrypoint locally here.
assert.match(read("src/main.tsx"), /import "\.\/onboarding-stage\.css"/);
assert.match(read("src/main.tsx"), /import "\.\/onboarding-form\.css"/);
// The panel's form language: one raised field tier, one inset tier for supplied
// values, selection that reads without colour, and validation beside the field.
const onboardingForm = read("src/onboarding-form.css");
assert.match(onboardingForm, /--ob-field:/);
assert.match(onboardingForm, /--ob-inset:/);
assert.match(onboardingForm, /input\[readonly\]/);
assert.match(onboardingForm, /\.field-error/);
assert.match(onboardingForm, /\[aria-invalid="true"\]:focus-visible/);
assert.match(onboardingForm, /\.guided-toggle input\[type="checkbox"\]/);
assert.match(onboardingForm, /prefers-reduced-motion: reduce/);
// Sentence case, not an uppercase tracked label: that is an eyebrow, not a
// field label (§3.3).
assert.match(onboardingForm, /text-transform: none/);
assert.match(onboarding, /function FieldError/);
assert.match(onboarding, /aria-pressed=\{form\.archetypeId === entry\.id\}/);
assert.match(onboarding, /aria-pressed=\{form\.specialtyIds\.includes\(specialty\.id\)\}/);
assert.match(onboarding, /aria-pressed=\{form\.schedule\.daysOfWeek\.includes\(day\.value\)\}/);
assert.match(onboarding, /setProblem\(issue\)/);
assert.match(onboarding, /\[aria-invalid="true"\], \[data-invalid="true"\]/);
assert.doesNotMatch(onboarding, /Saved · revision/);
// The panel masthead is a label only; session controls live on the stage once.
assert.match(onboarding, /<header><span>Workspace setup<\/span><\/header>/);
assert.match(boot, /agent="working" workday="active"/);
assert.match(app, /agent="blocked" workday="active"/);
assert.match(boot, /Opening this device’s saved session/);
assert.match(boot, /Getting your day ready/);
// The boot seam: one persistent overlay over the landing surface, the hold
// decided by bootSurface, and the handoff rise wired only onto the workspace.
assert.match(app, /const landing = bootSurface\(\{/);
assert.match(app, /<BootOverlay/);
assert.match(app, /boot-rise/);
assert.match(app, /dayReady: !!visibleDay/);
assert.match(app, /dayFailed: !!dayLoadFailed/);
assert.doesNotMatch(app, /loading-wave-large/);
assert.match(bootModel, /!input\.dayReady && !input\.dayFailed/);
assert.doesNotMatch(app, /wordmark-badge/);
assert.match(app, /useMemo\(\(\) => applyOnboardingScenario/);
assert.match(app, /finally \{ setBusy\(false\); \}/);
assert.match(app, /openDebuggerWindow/);
assert.match(app, /onboardingState: "complete"/);
assert.match(app, /notifications\.clearPersistent\("work-os-session-gate"\)/);
assert.match(app, /Work OS needs another try/);
assert.match(app, />Retry</);
assert.match(app, /\/api\/work-os\/me\/workday/);
assert.doesNotMatch(app, /<ReviewWorkspace/);
assert.doesNotMatch(app, /decideDayProposal/);
assert.doesNotMatch(app, /Human in the loop/);
assert.match(app, /source: "desktop"/);
assert.match(app, /worktivityControlTransport/);
assert.match(app, /worktivity_control/);
assert.match(app, /performWorktivityControl\("clock_in"/);
assert.match(app, /exception_acknowledged: true/);
assert.match(app, /late_acknowledged: true/);
assert.match(app, /Confirm extended shift/);
assert.match(app, /extendedAcknowledged \? \{ extended_acknowledged: true \} : \{\}/);
assert.doesNotMatch(app, /action: "clock_out", extended_acknowledged: true/);
assert.doesNotMatch(app, /Fallback clock in/);
assert.match(read("src/WorktivityControlNotice.tsx"), /Check Worktivity status/);
assert.match(app, /retryWorktivityConfirmation/);
assert.doesNotMatch(app, /sendOrQueue\("\/api\/work-os\/me\/workday", "POST"/);
assert.doesNotMatch(app, /sendOrQueue\("\/api\/work-os\/me\/workday", "PATCH", \{ action: paused \?/);
assert.match(app, /\/api\/work-os\/me\/plan/);
assert.match(app, /"PUT"/);
assert.doesNotMatch(app, /label: "Plan"/);
assert.doesNotMatch(app, /view === "plan"/);
assert.doesNotMatch(app, /Add outcome/);
assert.doesNotMatch(app, /Convert to Nifty/);
assert.match(app, /OverflowPanText/);
// The clipped line lives in one module and serves both the focus statements
// and the chat task titles; the pan distance is measured from the overflow.
assert.match(read("src/OverflowPan.tsx"), /overflow-pan-line/);
assert.match(read("src/OverflowPan.tsx"), /scrollWidth - el\.clientWidth/);
assert.match(app, /task-agenda-strip/);
assert.match(app, /formatWorkOsDate\(task\.due_date\)/);
assert.match(app, /Suggested from your tasks/);
assert.match(app, /What is the goal for today\?/);
assert.match(app, /goal-card-edit/);
assert.match(app, /Apply goal/);
assert.match(app, /seedInput=\{planningSeed/);
assert.match(read("src/PlanningSession.tsx"), /seedInput\?: string/);
assert.doesNotMatch(app, /onGoal=\{/, "the Focus editor commits on Apply, never per keystroke");
assert.match(app, /ActivityIntervalStream/);
assert.match(app, /avatar-open-focus/);
assert.match(read("src/AvatarApp.tsx"), /onViewInApp/);
assert.match(read("src/ActivityIntervalList.tsx"), /View in app/);
assert.match(read("src/ActivityIntervalList.tsx"), /export function ActivityIntervalStream/);
assert.match(redesignStyles, /\.goal-composer-panel \.chat-activity-stream/);
// The Focus goal section and the recap stream page on demand (design §7.2.1,
// §9.2): the goal collapses to a one-line preview, and the stream states its
// loaded window above one explicit control.
assert.match(app, /focus-goal-disclosure/);
assert.match(app, /GOAL_COLLAPSE_KEY/);
const activityListSource = read("src/ActivityIntervalList.tsx");
assert.match(activityListSource, /Load more/);
assert.match(activityListSource, /Showing \$\{intervals\.length\} of \$\{total\}/);
assert.match(app, /Scheduled today/);
assert.match(app, /Due from yesterday/);
assert.match(app, /Add a task — planning doesn't clock you in/);
assert.match(app, /Share an update or add a task/);
assert.match(app, /mode=\{sessionActive && view === "day" \? "progress" : "agenda"\}/);
assert.match(app, /onOpenGoal/);
assert.match(app, /onEditFocus/);
assert.match(app, /Queued offline/);
// The composer row keeps only the add menu, the field, and the send/record
// control; the day's goal lives in the Focus tab, never as a third control.
assert.doesNotMatch(app, /focus-dock-button/);
assert.match(app, /Review unfinished work/);
assert.match(app, /function TaskLifecycleMenu/);
assert.match(taskSurfaces, /Delete permanently/);
assert.match(app, /Add to today/);
assert.match(app, /Open original day/);
assert.match(app, /taskDetailsReadOnly/);
assert.match(app, /onOpenTask\(task, historical\)/);
assert.match(taskSurfaces, /Saving…/);
const queries = read("src/workOsQueries.ts");
assert.match(queries, /\/api\/work-os\/me\/insights\?range=/);
assert.match(app, /Restart onboarding/);
assert.match(app, /\/api\/work-os\/me\/onboarding[\s\S]*method: "DELETE"/);
assert.match(app, /secureState\.clearAccount\(\)/);
assert.match(personalSettings, /Account session/);
assert.match(app, /ui\.action\.requested/);
assert.match(app, /ui\.action\.failed/);
assert.match(app, /shiftPulse/);
assert.match(app, /shiftStartScenarioOpened/);
assert.match(app, /debugScenario\.dayState === "shift_start" && !shiftStartScenarioOpened\.current/);
assert.match(app, /Worktivity owns clock actions; the Windows Companion waits for provider confirmation\./);
assert.ok(queries.includes('params.set("refreshProviders", "true")'), "fetchDay sets refreshProviders");
assert.ok(queries.includes('params.set("compact", "true")'), "fetchDay sets compact for the compact variant");
assert.ok(/const detailsViews = view === "tasks" \|\| view === "review" \|\| view === "evidence"/.test(app), "details views gate the lazy details query");
assert.match(app, /secureState\.daySnapshot\(\)/);
// Day persistence moved into the query cache: the snapshot seeds the cache,
// and the query persister writes the filtered cache to the vault.
assert.match(app, /queryClient\.setQueryData\(workOsKeys\.day\("compact"\), snapshot\)/);
const queryClientSource = read("src/queryClient.ts");
assert.match(queryClientSource, /secureState\.saveQueryCache/);
assert.match(queryClientSource, /restoreWorkOsQueryCache/);
assert.match(app, /updater\.check_failed/);
assert.match(app, /pulse-provider-popover/);
assert.match(app, /Shift pulse options/);
assert.doesNotMatch(app, /className="pulse-stats"/);
assert.match(app, /Observed active time/);
assert.match(app, /Clocked in/);
assert.match(app, /Clocked out/);
assert.match(app, /task-state/);
assert.doesNotMatch(app, /evidence-kind \$\{task\.completed/);
assert.doesNotMatch(app, /You are the write barrier/);
assert.match(insightsView, /Observed time and planned commitments · separate scales/);
assert.match(insightsView, /Your work, without the noise/);
assert.match(insightsView, /Closing carry-over/);
assert.doesNotMatch(app, /width: active \? "42%"/);
assert.match(app, /Promise\.allSettled/);
assert.match(app, /bootstrap\.day\.degraded/);
assert.match(app, /onRefine=\{\(markdown, feedback, annotations\) => refineEod\(reviewDay, markdown, feedback, annotations\)\}/);
assert.match(app, /NotificationsBell/);
assert.match(app, /resyncPlanFromServer/);
assert.match(app, /eod-attention-pill/);
assert.match(app, /prior EOD/);
const planningSession = read("src/PlanningSession.tsx");
assert.match(planningSession, /newer confirmed plan/);
// Leaving edit mode remounts the document field. The layout effect writes its
// text while editing; without a fresh node, React appends the read-only value
// beside it and every field duplicates.
assert.match(planningSession, /key=\{editing \? "editing" : "read"\}/);
assert.match(app, /useOutstandingEodsQuery/);
assert.match(app, /useReportDayQuery/);
assert.match(app, /eod-day-context/);
assert.match(app, /Back to today/);
// The EOD draft gate and the shared alert window agree: an open shift only
// blocks the draft before its final ten minutes.
assert.match(app, /eodDraftBlocked/);
assert.match(app, /scheduledEndsAt: reviewDay\?\.dayShift\?\.endsAt/);
assert.match(app, /now: pulseNow\.getTime\(\)/);
const notificationsBell = read("src/NotificationsBell.tsx");
assert.match(notificationsBell, /aria-label="Outstanding EODs"/);
assert.match(notificationsBell, /role="dialog"/);
assert.match(notificationsBell, /eod-pill/);
assert.match(notificationsBell, /remembers about you so far/);
assert.match(notificationsBell, /notifications-mascot/);
assert.match(personalSettings, /<SuggestionReview \/>/);
assert.match(app, /useMemoryQuery/);
assert.match(app, /work-os:\/\/open-memory/);
const queryLayer = read("src/workOsQueries.ts");
assert.match(queryLayer, /\/api\/work-os\/me\/eod\/outstanding\?days=14/);
assert.match(queryLayer, /fetchDay\(\{ variant: "details", date: options\.date! \}\)/);
// The recap stream is an infinite query: a small first page plus the keyset
// cursor for the next one, keeping the request deadline alongside the query's
// cancellation signal.
assert.match(queryLayer, /ACTIVITY_INTERVALS_PAGE_SIZE/);
assert.match(queryLayer, /activityIntervalsUrl\(options\.date!, pageParam\)/);
assert.match(queryLayer, /cursor=\$\{encodeURIComponent\(cursor\)\}/);
assert.match(queryLayer, /AbortSignal\.any\(\[signal, timeout\]\)/);
assert.match(taskSurfaces, /Refresh from record/);
assert.match(app, /eod-start-earlier/);
assert.match(taskSurfaces, /Refine this draft/);
assert.doesNotMatch(taskSurfaces, /Bottleneck — required/);
const interpretationHelpers = read("src/interpretation.ts");
assert.match(interpretationHelpers, /export function extractBottleneckAnswer/);
assert.match(interpretationHelpers, /export function stripPlaceholderBottleneck/);
assert.match(interpretationHelpers, /BOTTLENECK_PLACEHOLDER/);
assert.match(taskSurfaces, /stripPlaceholderBottleneck/);
assert.match(taskSurfaces, /eod-loom/);
assert.match(taskSurfaces, /onLoomDraft/);
assert.match(taskSurfaces, /Analyze and rebuild draft/);
assert.match(taskSurfaces, /eod-loom-transcript/);
assert.match(taskSurfaces, /never files an update, task, or evidence row/);
assert.match(app, /draftEodWithLoom/);
assert.match(app, /featureFlags\?\.loom_updates === true/);
assert.match(app, /\/api\/work-os\/me\/loom\/preview/);
assert.match(app, /loomAttached/);
assert.doesNotMatch(app, /pendingLoom/);
assert.doesNotMatch(app, /attachLoomToDraft/);
assert.doesNotMatch(app, /loom-attach/);
const chatCore = read("src/chat/core.ts");
assert.match(chatCore, /Loom link/);
assert.match(chatCore, /insert: "Loom: "/);
assert.match(planningSession, /planning-loom/);
assert.match(planningSession, /onLoomPreview/);
assert.match(planningSession, /Plan from a Loom recording/);
assert.match(planningSession, /Build from Loom/);
assert.match(planningSession, /Use Loom only/);
// Build reads an unread link first, and a pasted transcript is a source even
// without a link.
assert.match(planningSession, /planningBuildState/);
assert.match(planningSession, /readLoomSource/);
assert.match(planningSession, /transcript \? \{ transcript \}/);
assert.match(planningSession, /Paste a transcript instead/);
assert.doesNotMatch(taskSurfaces, /eod-bottleneck-label/);
assert.doesNotMatch(taskSurfaces, /Add the reason above/);
assert.match(taskSurfaces, /stripPlaceholderBottleneck/);
const screenshotGallery = read("src/ScreenshotGallery.tsx");
assert.match(screenshotGallery, /eod-shot-carousel/);
assert.match(screenshotGallery, /eod-shot-grid/);
assert.match(screenshotGallery, /eod-shot-lightbox/);
assert.match(screenshotGallery, /flagged as sensitive \(images deleted\)/);
assert.doesNotMatch(screenshotGallery, /excluded by privacy policy/);
assert.match(screenshotGallery, /apiRequestBlob/);
assert.match(taskSurfaces, /EodScreenshotPanel/);
assert.match(app, /useEodScreenshotsQuery/);
assert.match(app, /task-row-line/);
assert.match(app, /kpi-strip/);
assert.match(app, /dashboard-task-grid/);
assert.match(app, /surfaced-tag/);
assert.match(app, /ProgressRing/);
assert.doesNotMatch(app, /progress-ticks/);
assert.doesNotMatch(app, /dashboard-focus-row/);
assert.doesNotMatch(app, /PreShiftAgendaSummary/);
assert.match(app, /task-list-tabs/);
assert.doesNotMatch(app, /agenda-strip-chip/);
assert.doesNotMatch(app, /task-record-columns/);
assert.doesNotMatch(app, /task-view-tabs/);
assert.match(app, /PersonalInsights/);
assert.match(app, /AdminWorkspace/);
// The administration shell reaches the same global overlays as the employee
// workspace: the account's own profile settings from the masthead avatar, and
// one administration-only changelog item in the workspace menu. The employee
// rail keeps reaching the changelog from Settings and never receives it.
const adminWorkspace = read("src/admin/AdminWorkspace.tsx");
assert.match(adminWorkspace, /import \{ ProfileAvatar \} from "\.\.\/ProfileSettings"/);
assert.match(adminWorkspace, /aria-label=\{`Profile for \$\{profile\.name\}`\}/);
assert.match(adminWorkspace, /title="Open profile settings"/);
assert.match(adminWorkspace, /onOpenWhatsNew/);
assert.match(adminWorkspace, /className="admin-switch admin-ask-otto"/);
assert.match(adminWorkspace, /onClick=\{onNewChat\}/);
assert.match(adminWorkspace, /Ask Otto/);
assert.match(app, /const openAdminOtto = \(\) => openAdminOttoSurface\(\{ newChat: true \}\);/);
assert.match(app, /onNewChat=\{openAdminOtto\}/);
assert.equal((app.match(/onNewChat=\{openAdminOtto\}/g) ?? []).length, 1);
const sidebarNav = read("src/SidebarNav.tsx");
assert.match(sidebarNav, /What's new/);
assert.match(sidebarNav, /onWhatsNew/);
assert.match(app, /onOpenWhatsNew=\{openChangelogFromAdmin\}/);
assert.equal((app.match(/onOpenWhatsNew=\{openChangelogFromAdmin\}/g) ?? []).length, 1);
assert.match(app, /work-os\.workspace-mode/);
assert.match(app, /observedSeconds/);
assert.doesNotMatch(app, /width: "(?:76|52|34)%"/);
assert.doesNotMatch(app, /will enter the plan at explicit clock-in/);
assert.match(app, /does not affect attendance/);
assert.match(app, /view === "tasks"/);
assert.match(app, /Load more/);
assert.match(app, /role="dialog"/);
assert.match(app, /assignee_person_ids/);
assert.match(app, /openTaskDetails/);
assert.match(taskSurfaces, /Add a subtask/);
assert.match(taskSurfaces, /record/);
assert.match(taskSurfaces, /Archive.*reversible/);
assert.match(app, /method: "DELETE"/);
assert.match(app, /Delete permanently/);
assert.match(taskSurfaces, /task-assignee-tags/);
assert.match(taskSurfaces, /retained in Work OS history/);
assert.match(app, /role="alertdialog"/);
assert.match(app, /requestTaskRemoval/);
assert.match(taskSurfaces, /Move to/);
assert.match(app, /method: "PATCH"/);
assert.match(app, /MoreHorizontal/);
assert.match(app, /queryAvailableUpdate\(saved\)/);
assert.match(app, /result\.headers/);
assert.match(app, /failures\?: Array<\{ client_operation_index: number; error: string \}>/);
assert.match(app, /partialFilingMessage/);
assert.match(app, /Some updates could not be filed/);
assert.doesNotMatch(app, /The completion proposals were not saved/);
const avatarAppSource = read("src/AvatarApp.tsx");
assert.match(avatarAppSource, /failures\?: Array<\{ client_operation_index: number; error: string \}>/);
assert.doesNotMatch(avatarAppSource, /The completion proposals were not saved/);
assert.match(avatarAppSource, /apiRequest<\{ interpretation: unknown \}>\("\/api\/work-os\/me\/interpret", \{[\s\S]*?signal: AbortSignal\.timeout\(60_000\)/);
assert.match(app, /update\.download\(\(event\) =>/);
assert.match(app, /applyDownloadEvent\(progress, event\)/);
assert.match(app, /arm_update_exit_watchdog/);
assert.match(app, /disarm_update_exit_watchdog/);
assert.match(app, /update\.install\(\)/);
// Antivirus holds outlast a short fuse: the watchdog grace stays generous and
// a rejected install raises a persistent Retry card, never a silent death.
assert.match(rust, /const UPDATE_EXIT_WATCHDOG_GRACE_SECS: u64 = 120;/);
assert.match(rust, /arm_exit_watchdog\(UPDATE_EXIT_WATCHDOG_GRACE_SECS\)/);
assert.match(rust, /fn arm_update_exit_watchdog\(\) \{\n    #\[cfg\(windows\)\]\n    arm_exit_watchdog\(UPDATE_EXIT_WATCHDOG_GRACE_SECS\);\n\}/);
assert.match(app, /Retry the install, or quit Work OS/);
assert.match(app, /\{ label: "Retry", kind: "primary", onClick: \(\) => void installDownloadedUpdate\(\) \}/);
assert.doesNotMatch(app, /To recover, quit Work OS/);
assert.match(app, /UPDATE_CHECK_INTERVAL_MS/);
assert.match(app, /setInterval\(\(\) => \{/);
assert.match(app, /"Update now"/);
assert.match(app, /label: "Later", kind: "quiet"/);
assert.match(app, /"Retry"/);
assert.match(app, /locked: true/);
assert.match(app, /updateRowCopy\(updateRowSummary, installedVersion\)/);
const updateInstallOrder: number[] = [/update\.download\(\(event\)/, /arm_update_exit_watchdog/, /update\.install\(\)/].map((expression) => (app as string).search(expression));
assert.ok(
  updateInstallOrder[0] < updateInstallOrder[1] && updateInstallOrder[1] < updateInstallOrder[2],
  "updater flow must run download, then arm the watchdog, then install",
);
assert.doesNotMatch(app, /if \(!window\.confirm\(warning\)\)/);
assert.doesNotMatch(app, /openTaskComposer\(task\)/);
assert.doesNotMatch(app, /Nifty task group ID/);
assert.doesNotMatch(app, /task_group_id: taskComposer/);
assert.match(read("src/sessionGate.ts"), /Worktivity confirms attendance while Work OS mirrors the session/);
assert.doesNotMatch(app, /disabled=\{!active \|\| !input\.trim\(\) \|\| busy\}/);
assert.doesNotMatch(app, /className="notice error"/);
assert.match(app, /notifications\.success/);
assert.match(app, /notifications\.error/);

const notificationFlyouts = read("src/NotificationFlyouts.tsx");
assert.match(notificationFlyouts, /tone === "error" \? "alert" : "status"/);
assert.match(notificationFlyouts, /notification-flyout \$\{notification\.tone\} \$\{notification\.persistence/);
assert.match(notificationFlyouts, /NotificationProvider/);
assert.match(notificationFlyouts, /unhandledrejection/);
assert.match(notificationFlyouts, /clearPersistent/);
assert.match(notificationFlyouts, /persistence === "persistent"/);

const debugWindow = read("src/DebugWindow.tsx");
assert.match(debugWindow, /if \(!isTauri\(\)\)/);
for (const event of ["work-os://debug-request", "work-os://debug-current", "work-os://debug-scenario"]) {
  assert.match(debugWindow, new RegExp(event.replaceAll("/", "\\/")));
}
assert.match(debugWindow, /\.\.\.DEFAULT_DEBUG_SCENARIO, \.\.\.preset/);
assert.match(debugWindow, /Show current page guide/);
assert.match(debugWindow, /emit\("work-os:\/\/debug-show-page-guide"\)/);
assert.match(debugWindow, /work-os:\/\/debug-page-guide-result/);
assert.match(debugWindow, /No guide for this page/);
const tauriEventsSource = read("src/tauriEvents.ts");
assert.match(tauriEventsSource, /work-os:\/\/debug-show-page-guide/);
assert.match(tauriEventsSource, /work-os:\/\/debug-page-guide-result/);
assert.match(app, /listen\("work-os:\/\/debug-show-page-guide"/);
assert.match(app, /setDebugPageGuide\(pageGuideView\)/);
assert.match(app, /emit\("work-os:\/\/debug-page-guide-result"/);
assert.match(app, /debugPageGuide && <PageGuide[\s\S]*developerPreview/);
assert.match(app, /onClose=\{\(\) => setDebugPageGuide\(null\)\}/);

const main = read("src/main.tsx");
const debug = read("src/debug.tsx");
const debugHtml = read("debug.html");
assert.doesNotMatch(main, /import DebugWindow/);
assert.match(main, /import TasksPreview/);
assert.match(main, /loading.css/);
assert.match(main, /LoadingPreview/);
assert.match(main, /SkeletonsPreview/);
assert.match(app, /runVaultGate\(\s*\(\) => applyVaultStateRef\.current\(\)/);
assert.match(app, /invoke<boolean>\("vault_open_trouble"\)/);
assert.doesNotMatch(app, /vaultStartedRef/);
assert.match(app, /boot:vault_failed/);
assert.match(app, /DashboardSkeleton/);
assert.match(app, /TaskListSkeleton/);
assert.match(insightsView, /InsightsSkeleton/);
assert.match(app, /FadeArc/);
assert.doesNotMatch(app, /loading-wave-large/);
assert.match(taskSurfaces, /TaskDetailSkeleton/);
assert.match(main, /import TodayPreview/);
assert.match(main, /params\.has\("preview-tasks"\)/);
assert.match(main, /params\.has\("preview-today"\)/);
assert.match(main, /<NotificationProvider>/);
assert.match(debug, /import DebugWindow from "\.\/DebugWindow"/);
assert.match(debug, /<NotificationProvider>/);
assert.match(debugHtml, /src="\/src\/debug\.tsx"/);
assert.match(read("vite.config.ts"), /debug: resolve\(__dirname, "debug\.html"\)/);
assert.match(read("src-tauri/capabilities/debug.json"), /allow-debug-commands/);
assert.match(read("src-tauri/capabilities/default.json"), /allow-app-commands/);
assert.match(read("src-tauri/permissions/allow-app-commands.toml"), /open_debug_window/);
assert.match(read("src-tauri/permissions/allow-app-commands.toml"), /worktivity_control/);
assert.match(rust, /fn worktivity_control/);
assert.match(read("src-tauri/tauri.conf.json"), /resources\/worktivity-controller\.ps1/);
const worktivityController = read("src-tauri/resources/worktivity-controller.ps1");
assert.match(worktivityController, /--remote-debugging-port/);
assert.match(worktivityController, /app:\/\//);
assert.match(worktivityController, /CloseMainWindow/);
assert.match(worktivityController, /taskkill\.exe/);
assert.match(worktivityController, /ValidateSet\("clock_in", "clock_out", "pause", "resume", "finish"\)/);
assert.match(worktivityController, /restore_required/);
assert.match(rust, /fn finish_worktivity_control/);
assert.match(read("src-tauri/permissions/allow-app-commands.toml"), /finish_worktivity_control/);
assert.doesNotMatch(worktivityController, /\$ports\s*\+=\s*\$DefaultPort/);
assert.doesNotMatch(worktivityController, /Tracking\/CreateActivityLog|api\.useworktivity\.com|Authorization|Bearer/i);

const webEmployee = [
  readFileSync(resolve(import.meta.dirname, "../src/modules/work-os/employee/EmployeeToday.tsx"), "utf8"),
  readFileSync(resolve(import.meta.dirname, "../src/modules/work-os/employee/EmployeeSettings.tsx"), "utf8"),
].join("\n");
assert.match(webEmployee, /Clock in, pause, resume, and clock out from the Windows Work OS Companion/);
assert.doesNotMatch(webEmployee, /Clock in<\/button>/);
assert.doesNotMatch(webEmployee, /action: "clock_out"/);
assert.doesNotMatch(webEmployee, /body: \{ action: workSession\?\.state === "paused" \? "resume" : "pause" \}/);

const companionModules = ["day-view", "checkins", "proposals", "eod", "employee-tasks", "schedules"];
const companionServer = companionModules.map((m) => readFileSync(resolve(import.meta.dirname, `../src/lib/work-os-${m}.ts`), "utf8")).join("\n");
// The task record is local: no request path refreshes from a provider, and the
// day view reports the record's own save authority.
assert.match(companionServer, /authority: "work_os"/);
assert.doesNotMatch(companionServer, /dedupedProviderRefresh/);
assert.doesNotMatch(companionServer, /syncing: options\.refreshNifty/);
assert.doesNotMatch(companionServer, /const result = await syncNifty\(ownerId\)/);
assert.doesNotMatch(companionServer, /await niftySyncPromise/);
assert.match(companionServer, /role", "admin"/);
assert.match(companionServer, /Assignees must be active Work OS organization members/);
assert.match(taskSurfaces, /No active organization members were found/);
assert.match(companionServer, /getWorkOsEmployeeTaskDetails/);
assert.match(companionServer, /archiveWorkOsEmployeeTask/);
assert.match(companionServer, /moveWorkOsEmployeeSubtask/);
assert.match(companionServer, /task\.subtask_moved/);
assert.match(companionServer, /task\.archived/);
assert.match(companionServer, /setWorkOsEmployeeTaskCompletion/);
// The day event's idempotency key stays namespaced by the task's own provider,
// so a local completion and a Nifty completion can never collide.
assert.match(companionServer, /idempotencyKey: `\$\{[a-zA-Z]+\.provider === "local" \? "local" : "nifty"\}:(completed|reopened):/);
assert.match(companionServer, /source: actor \? "agent" : "employee_explicit"/);
// Completing a task completes the open subtasks beneath it, on the employee
// surfaces and on the administration record alike.
assert.match(companionServer, /applyTaskCompletion/);
assert.match(companionServer, /openSubtaskRows/);

const api = read("src/api.ts");
assert.match(api, /AbortSignal\.timeout\(20_000\)/);
assert.match(api, /observed_at: body\.observed_at \?\? createdAt/);
assert.match(api, /Idempotency-Key/);
assert.match(api, /flushQueue/);
assert.match(api, /\/api\/work-os\/desktop\/session/);
assert.doesNotMatch(api, /\/api\/work-os\/me\/day/);

const tauri = read("src-tauri/tauri.conf.json");
const tauriConfig = JSON.parse(tauri);
const updaterPublicKey = Buffer.from(tauriConfig.plugins.updater.pubkey, "base64").toString("utf8");
assert.match(tauri, /"frontendDist": "\.\.\/dist"/);
assert.match(tauri, /"useHttpsScheme": true/);
assert.match(tauri, /"label": "debug"[\s\S]*"url": "debug\.html"[\s\S]*"visible": false/);
assert.doesNotMatch(tauri, /localhost:1420/);
assert.match(tauri, /com\.wrazy\.workos\.pilot/);
assert.match(tauri, /"beforeBuildCommand": "npm run build"/);
assert.match(updaterPublicKey, /minisign public key: 84E0D8F6FBD888F/);

const msi = read("installer/windows-pilot.wxs");
assert.match(msi, /WebView2Loader\.dll/);
assert.match(msi, /wrazy-workos/);
assert.match(msi, /WorkOsCompanionShortcut/);

const nsis = read("installer/windows-pilot.nsi");
assert.match(nsis, /SetOverwrite on/);
assert.match(nsis, /taskkill \/IM "Work OS Companion\.exe"/);
assert.match(nsis, /taskkill \/IM "work-os-companion\.exe"/);
assert.match(nsis, /MUI_FINISHPAGE_RUN "\$INSTDIR\\\$\{PRODUCT_EXE\}"/);
assert.match(nsis, /MUI_FINISHPAGE_RUN_TEXT "Run Work OS Companion"/);
assert.doesNotMatch(nsis, /MUI_FINISHPAGE_RUN_NOTCHECKED/);

const workflow = readFileSync(resolve(import.meta.dirname, "../.github/workflows/work-os-companion-windows.yml"), "utf8");
assert.match(workflow, /TAURI_SIGNING_PRIVATE_KEY/);
if (/unsigned-windows-release/.test(workflow)) {
  assert.match(workflow, /Missing GitHub environment secrets/);
  assert.doesNotMatch(workflow, /WINDOWS_CERTIFICATE_BASE64/);
  assert.match(workflow, /UNSIGNED INTERNAL/);
} else {
  assert.match(workflow, /Missing release signing secrets/);
  assert.match(workflow, /WINDOWS_CERTIFICATE_BASE64/);
}

// ── SOD saves the AI draft, not the raw chat input ──
const avatar = read("src/AvatarApp.tsx");
assert.match(avatar, /import \{ buildPlanItemsFromInterpretation \} from "\.\/planItems";/);
assert.match(avatar, /goal_provenance: "ai_draft",/);
assert.match(avatar, /focus_summary: interpretation\.summary,/);
assert.match(avatar, /const items = buildPlanItemsFromInterpretation\(facts\.planItems, interpretation, answers\);/);
assert.match(avatar, /planIntent: day\?\.plan\?\.focus_summary \?\? day\?\.plan\?\.freeform_intent \?\? null,/);
assert.doesNotMatch(avatar, /goal_provenance: "employee",\s*\n\s*focus_summary: interpretation\.summary/);
// The floating Tasks view leads with Open tasks (collapsible, remembered) and
// pages the recap stream beneath it; a recap decision never scrolls the list.
assert.match(avatar, /collapsePersistenceKey=\{AVATAR_TASKS_COLLAPSE_KEY\}/);
const openTasksAt = avatar.indexOf('title="Open tasks"');
const recapStreamAt = avatar.indexOf("<ActivityIntervalList");
assert.ok(openTasksAt >= 0 && recapStreamAt >= 0 && openTasksAt < recapStreamAt, "Open tasks leads the floating Tasks view");
assert.match(avatar, /avatarTab === "tasks"\) return/);

const planner = read("src/PlanningSession.tsx");
assert.match(planner, /setInput\(seedInput\?\.trim\(\) \? seedInput : plan\?\.focus_summary \?\? plan\?\.freeform_intent \?\? ""\);/);

const planItemsModule = read("src/planItems.ts");
assert.match(planItemsModule, /export function buildPlanItemsFromInterpretation/);
assert.match(planItemsModule, /item_kind: "outcome"/);

// ── Late-start reason: the mascot state layer owns the late tone ──
const otto = read("src/Otto.tsx");
assert.match(otto, /export type OttoTone = MascotTone;/);
assert.match(otto, /data-tone=\{tone\}/);
assert.match(otto, /late start needs a reason/);
assert.match(otto, /className="otto-late-mark"/);
const ottoStyles = read("src/otto.css");
assert.match(ottoStyles, /\.otto\[data-tone="late"\]/);
assert.match(ottoStyles, /\.otto-late-mark/);

assert.match(avatar, /lateReasonRequired: lateReasonRequired\(day\?\.session\)/);
assert.match(avatar, /const agentActivity: MascotAgentActivity =/);
assert.match(avatar, /const workdayState: MascotWorkdayState =/);
assert.match(avatar, /const mascotVisual = useMascotRuntime\(/);
assert.match(avatar, /<MascotPet agent=\{agentActivity\} workday=\{workdayState\} className="avatar-pet" artClassName="avatar-pet-art" replayKey=\{snoozeReplayId\} speaking=\{recapSpeech\.status === "playing"\} \/>/);
assert.match(avatar, /Late start — add a reason/);

assert.match(app, /const lateReasonMissing = lateReasonRequired\(visibleDay\?\.session\);/);
assert.match(app, /className="late-attention-pill"/);
assert.match(app, /async function saveLateReason\(reason: string\)/);
assert.match(app, /sendOrQueue\("\/api\/work-os\/me\/workday", "PATCH", \{ action: "late_reason", reason \}\)/);
assert.match(app, /late_reason: confirmation\.reason\.trim\(\) \|\| undefined/);
assert.match(app, /lateReasonRequired=\{lateReasonMissing\} onSaveLateReason=\{saveLateReason\}/);
assert.match(planner, /planning-late-reason/);
assert.match(planner, /Late-start reason recorded/);
const lateHelper = read("src/lateStart.ts");
assert.match(lateHelper, /export function lateReasonRequired/);
assert.match(lateHelper, /PROLONGED_ABSENCE_MINUTES = 30/);

// ── SOD goals materialize as local Work OS tasks and subtasks ──
assert.match(planner, /planning-materialize-hint/);
assert.match(planner, /Confirming creates \$\{taskCopy\} with \$\{subtaskCopy\}\./);
const localTaskSurfaces = read("src/taskSurfaces.tsx");
assert.match(localTaskSurfaces, /export function taskSourceLabel/);
assert.match(taskSurfaces, /const source = "Work OS";/);
assert.match(localTaskSurfaces, /\{taskSourceLabel\(task\)\} is the task record/);
assert.match(localTaskSurfaces, /localTask\?: boolean/);
const companionTypes = read("src/types.ts");
assert.match(companionTypes, /item_kind: "nifty_task" \| "outcome" \| "local_task"/);
// The receipt is built from the counts that actually happened, so a
// reuse-only confirm never claims "Created 0 Work OS tasks".
assert.match(avatar, /created \$\{createdTasks\} Work OS task/);
assert.match(avatar, /continued \$\{reusedTasks\} existing task/);
assert.match(app, /created \$\{plural\(createdTasks, "Work OS task"\)\}/);
assert.match(app, /continued \$\{plural\(reusedTasks, "existing task"\)\}/);

const localTasks = readFileSync(resolve(import.meta.dirname, "../src/lib/work-os-local-tasks.ts"), "utf8");
assert.match(localTasks, /export const LOCAL_TASK_PROVIDER = "local"/);
assert.match(localTasks, /export async function materializePlanLocalTasks/);
assert.match(localTasks, /export function planTaskMarker/);
const workdaySource = readFileSync(resolve(import.meta.dirname, "../src/lib/work-os-workday.ts"), "utf8");
assert.match(workdaySource, /materializePlanLocalTasks\(access, String\(plan\.id\), shiftDate, entries\)/);
assert.match(workdaySource, /if \(confirm && submitted\)/);
const taskStore = readFileSync(resolve(import.meta.dirname, "../src/lib/work-os-tasks.ts"), "utf8");
assert.match(taskStore, /task\.provider === "local"/);
const migration = readFileSync(resolve(import.meta.dirname, "../supabase/migrations/0041_work_os_local_plan_tasks.sql"), "utf8");
assert.match(migration, /'nifty_task', 'outcome', 'local_task'/);
const web = readFileSync(resolve(import.meta.dirname, "../src/modules/work-os/employee/EmployeeTasks.tsx"), "utf8");
assert.match(web, /String\(task\.provider \?\? ""\) === "local"/);
assert.match(web, /Work OS task/);
assert.match(web, /Permanently delete this task from Work OS\?/);

// ── Approval flow and shared review persistence ──
const approvalFlow = read("src/ApprovalFlow.tsx");
assert.match(approvalFlow, /export function settleDecisions/);
assert.match(approvalFlow, /const settled = settleDecisions\(pending, next\);/);
assert.match(approvalFlow, /if \(settled\) \{\s*\n\s*setSubmitted\(true\);/);
assert.doesNotMatch(approvalFlow, /Final review/);
assert.doesNotMatch(approvalFlow, /Approve & record/);
assert.doesNotMatch(approvalFlow, /approval-summary/);
const approvalStyles = read("src/tool-approval-card.css");
assert.doesNotMatch(approvalStyles, /approval-summary/);
assert.doesNotMatch(approvalStyles, /approval-decision-dot/);

const vaultSource = read("src/vault.ts");
assert.match(vaultSource, /import \{ mergeConversationTurns \} from "\.\/avatarLogic";/);
assert.match(vaultSource, /mergeConversationTurns\(stored, turns\)/);
const avatarLogic = read("src/avatarLogic.ts");
assert.match(avatarLogic, /export function mergeConversationTurns<T extends \{ id: string; createdAt\?: string \}>/);
const interpretationTypes = read("src/interpretation.ts");
assert.match(interpretationTypes, /reviewId: string;/);
assert.match(avatar, /const hasThisReview = current\.some\(\(entry\) => entry\.id === shared\.reviewId\);/);
assert.match(avatar, /id: shared\.reviewId, role: "assistant" as const,/);
assert.match(app, /reviewId: shared\.reviewId \}/);
assert.match(app, /const reviewId = crypto\.randomUUID\(\);/);
assert.doesNotMatch(app, /meta: "shared review"/);

// ── Truthful receipts, build recovery, and sign-out hygiene ──
const interpretation = read("src/interpretation.ts");
assert.match(interpretation, /const serverOutcome = typeof row\?\.outcome === "string" \? row\.outcome : null;/);
assert.match(interpretation, /serverOutcome === "stale" \|\| serverOutcome === "rejected"/);
assert.match(app, /row\.outcome === "applied" \? "This action was already applied and cannot be skipped\."/);
assert.match(avatar, /row\.outcome === "applied" \? "This action was already applied and cannot be skipped\."/);
assert.match(app, /if \(\/AI build\/i\.test\(message\)\)/);
assert.match(planner, /if \(result === "rebuild"\)/);
assert.match(planner, /The AI plan build expired\. Build the plan again to confirm it\./);
assert.match(avatar, /The AI plan build expired\. Send your agenda again to rebuild it\./);
assert.match(vaultSource, /const CHAT_SCOPE_KEYS = "chat-scope-keys";/);
assert.match(vaultSource, /for \(const key of scopes\) await remove\(key\);/);
assert.match(vaultSource, /rememberChatScope\(scope\)/);

// ── Post-install announcement and changelog convention ──
const whatsNew = read("src/whatsNew.ts");
assert.match(whatsNew, /WHATS_NEW_SEEN_KEY = "work-os\.update\.announcedVersion\.v1"/);
assert.match(whatsNew, /WHATS_NEW_ANNOUNCE_KEY = "work-os-update-announced"/);
assert.match(whatsNew, /export function shouldAnnounceUpdate/);
assert.match(whatsNew, /export function parseChangelog/);
assert.match(whatsNew, /export function changelogBulletsFor/);
assert.match(whatsNew, /export function updateInstalledCopy/);
assert.match(app, /WHATS_NEW_ANNOUNCE_KEY/);
assert.match(app, /shouldAnnounceUpdate\(value, readAnnouncedVersion\(\)\)/);
assert.match(app, /markUpdateAnnounced\(value\)/);
assert.match(app, /<WhatsNewModal/);
assert.match(app, /changelogBulletsFor\(CHANGELOG_RAW/);
assert.match(app, /What's new/);
assert.match(app, /setWhatsNew\(null\)/);
const whatsNewModal = read("src/WhatsNewModal.tsx");
assert.match(whatsNewModal, /role="dialog" aria-modal="true"/);
assert.match(whatsNewModal, /No changelog notes shipped with this build\./);
const changelog = read("CHANGELOG.md");
assert.match(changelog, /^## Unreleased$/m);
// Every version heading carries the day the build shipped, so the changelog
// history can show it; undated or impossible dates must not come back.
const versionHeadings = changelog.split("\n").filter((line) => /^##\s+\d+\.\d+\.\d+\b/.test(line));
assert.ok(versionHeadings.length > 0, "CHANGELOG.md must log released versions");
for (const heading of versionHeadings) {
  const dated = heading.match(/^## \d+\.\d+\.\d+ — (\d{4})-(\d{2})-(\d{2})$/);
  assert.ok(dated, `dated version heading: ${heading}`);
  const [year, month, day] = dated!.slice(1).map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!, 12));
  assert.ok(
    date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day && year! >= 2024,
    `plausible ship date: ${heading}`,
  );
}
assert.match(changelog, /hard\s+release requirement/);
// End-user brevity: one short bullet per change (wrapped lines joined).
// Only entry sections count; the header guidance above them is exempt.
const changelogBullets: string[] = [];
let pendingBullet: string | null = null;
let inEntries = false;
for (const line of changelog.split("\n")) {
  if (/^##\s/.test(line)) {
    inEntries = true;
    if (pendingBullet !== null) { changelogBullets.push(pendingBullet); pendingBullet = null; }
    continue;
  }
  if (!inEntries) continue;
  const start = line.match(/^\s*[-*]\s+(\S.*)$/);
  if (start) {
    if (pendingBullet !== null) changelogBullets.push(pendingBullet);
    pendingBullet = start[1]!;
    continue;
  }
  if (pendingBullet !== null && /^\s+\S/.test(line)) pendingBullet += ` ${line.trim()}`;
}
if (pendingBullet !== null) changelogBullets.push(pendingBullet);
assert.ok(changelogBullets.length > 0, "CHANGELOG.md must carry entries");
for (const bullet of changelogBullets) {
  assert.ok(bullet.length <= 160, `CHANGELOG bullets stay one short line for end users (${bullet.length} chars): ${bullet.slice(0, 80)}…`);
}
const chatPreview = read("src/ChatPreview.tsx");
assert.match(chatPreview, /isolate === "whatsnew"/);
assert.match(chatPreview, /<WhatsNewSection \/>/);
const releaseWorkflow = readFileSync(resolve(import.meta.dirname, "../.github/workflows/work-os-companion-windows.yml"), "utf8");
assert.match(releaseWorkflow, /Require changelog entry for the release/);
assert.match(releaseWorkflow, /## What's new in/);
assert.match(styles, /\.notification-flyout\.persistent\.success/);

console.log("Work OS desktop static checks passed.");

// ── Task-list ordering, overdue meaning, and count reconciliation ──
const taskWorkspace = read("src/taskWorkspace.ts");
assert.match(taskWorkspace, /export function isOverdueTask/);
assert.match(taskWorkspace, /export function sortTaskList/);
assert.match(taskWorkspace, /export const DEFAULT_TASK_SORT: TaskSort = \{ key: "due", direction: "desc" \};/);
assert.doesNotMatch(taskWorkspace, /label: "Activity"/);
assert.doesNotMatch(taskWorkspace, /key: "activity"/);
assert.match(taskWorkspace, /const openFirst = \(\) => Number\(left\.completed === true\) - Number\(right\.completed === true\);/);
assert.match(taskWorkspace, /export function dayScopedTasks/);
const sortHeader = read("src/SortHeaderRow.tsx");
assert.match(sortHeader, /role="toolbar" aria-label=\{label\}/);
assert.match(sortHeader, /aria-pressed=\{active\}/);
assert.match(app, /<SortHeaderRow /);
// Card rows do not map onto the sort columns, so no fake table semantics.
assert.doesNotMatch(app, /role: "table" as const/);
assert.doesNotMatch(sortHeader, /aria-sort=/);
assert.doesNotMatch(sortHeader, /role="columnheader"/);
assert.match(app, /active-task-sort-note/);
assert.match(app, /readTaskSort\(DAY_SORT_STORAGE_KEY\)/);
assert.match(app, /readTaskSort\(TASKS_SORT_STORAGE_KEY\)/);
assert.match(app, /TASKS_WORKSPACE_SORT_COLUMNS/);
assert.match(app, /className="tasks-column-sort"/);
assert.match(app, /taskSort=\{taskWorkspaceSort\}/);
assert.match(app, /onTaskSort=\{setTaskWorkspaceSort\}/);
assert.match(app, /const completedHistoryQuery = useTaskHistoryQuery/);
assert.match(app, /enabled: employeeBootstrapEnabled && view === "tasks" && taskView === "all" && !!visibleDay\?\.shiftDate/);
assert.match(app, /enabled: employeeBootstrapEnabled && view === "tasks" && taskView === "completed" && !!visibleDay\?\.shiftDate/);
assert.match(app, /completedOnly: true/);
assert.match(app, /completedHistory=\{completedTaskHistory\}/);
assert.match(app, /const activeTaskHistoryQuery = view !== "tasks" \? historyQuery/);
assert.match(app, /const unfinishedHistoryQuery = useTaskHistoryQuery/);
assert.match(app, /const todayTaskHistoryQuery = useTaskHistoryQuery/);
assert.match(app, /TaskDateNavigator/);
assert.match(app, /const displayedTasks = !historical && historyOrder === "server"/);
assert.match(app, /workspaceHistory=\{workspaceTaskHistory\}/);
assert.match(app, /const workspaceTaskHistory = syncBypass \? taskHistory :/);
assert.match(app, /const completedTaskHistory = syncBypass\s+\? null/);
assert.match(app, /historyOrder=\{syncBypass \? "local" : "server"\}/);
assert.match(app, /view === "tasks" && !syncBypass && activeTaskHistoryQuery\.isPending/);
assert.match(app, /historyError=\{!syncBypass && activeTaskHistoryQuery\.isError\}/);
assert.match(app, /Task history could not be loaded\./);
assert.match(app, /queryClient\.cancelQueries\(\{ queryKey: workOsKeys\.taskHistory\(\) \}\)/);
assert.match(app, /activeTaskHistoryQuery\.refetch\(\)/);
assert.match(app, /queryClient\.invalidateQueries\(\{ queryKey: workOsKeys\.taskHistory\(\), refetchType: "active" \}\)/);
// One day scope and one overdue predicate; the old split sources must not return.
assert.match(app, /dayScopedTasks\(todayTasks, currentPlan\?\.items/);
assert.match(app, /dayScopedTasks\(visibleDay\?\.tasks/);
assert.match(app, /isOverdueTask\(task, today\)/);
assert.doesNotMatch(app, /otherTasks\.filter\(\(task\) => typeof task\.due_date === "string"/);
assert.match(app, /sortTaskList\(rawDisplayed, sort, today\)/);
// One exact open backlog feeds both the dashboard tabs and Tasks Unfinished.
assert.match(app, /unfinishedBefore\(openBacklog\.filter\(\(task\) => !todayIds\.has\(taskRowId\(task\)\)\), visibleDay\?\.shiftDate/);
assert.match(app, /useTaskBacklogQuery/);
const backlogQueries = read("src/workOsQueries.ts");
assert.match(backlogQueries, /view=open/);
assert.match(backlogQueries, /limit: "50"/);
assert.match(backlogQueries, /nextCursor/);
assert.match(backlogQueries, /view=pending&limit=100/);
assert.match(app, /backlog\?: TaskBacklog \| null/);
assert.match(app, /loadMoreError=\{activeTaskHistoryQuery\.isFetchNextPageError\}/);
assert.match(app, /Showing \$\{unfiltered\.length\} of \$\{viewTotal\}/);
// Counts keep describing their own lists.
assert.match(app, /aria-label=\{`\$\{completed\} of \$\{tasks\.length\} tasks done today/);
assert.match(app, /label: "Unfinished", count: taskView === "unfinished" \? pageCounts\?\.open/);
assert.match(app, /pageCounts\.completed : serverCounts\?\.completed/);
assert.match(app, /pageCounts\.total : serverCounts\?\.total/);
assert.match(styles, /\.sort-header-row/);
assert.match(styles, /\.sort-header-row \{\n  display: flex;\n  flex-wrap: wrap;/);
assert.match(styles, /\.active-task-sort-note/);
const dashboardStyles = read("src/dashboard-overhaul.css");
assert.match(dashboardStyles, /\.tasks-column-sort \{/);
assert.match(dashboardStyles, /grid-template-columns: 30px minmax\(0, 1fr\) 36px 100px 116px 38px/);
assert.match(dashboardStyles, /\.task-record\.workspace-task \{[^\n]*grid-template-columns: 30px minmax\(0, 1fr\) 36px 100px 116px 38px/);
assert.match(dashboardStyles, /\.tasks-column-sort \.sort-header-action \{ position: absolute; right: 0;/);
assert.match(dashboardStyles, /@media \(max-width: 720px\) \{\n  \.tasks-column-sort \{/);
assert.match(dashboardStyles, /\.task-history-error button:focus-visible/);
const taskServer = readFileSync(resolve(import.meta.dirname, "../src/lib/work-os-tasks.ts"), "utf8");
assert.match(taskServer, /work_list_person_tasks_sorted/);
assert.match(taskServer, /hydrateTaskProjects\(userId, withProgress, opts\.organizationId\)/);
assert.match(taskServer, /hydrateTaskProjects\(userId, withProgress, organizationId\)/);
assert.match(taskServer, /validateWorkOsDate\(opts\.sortDate, "sortDate"\)/);
const taskRoute = readFileSync(resolve(import.meta.dirname, "../src/app/api/work-os/me/tasks/route.ts"), "utf8");
assert.match(taskRoute, /validateWorkOsDate\(params\.get\("sortDate"\), "sortDate"\)/);
assert.match(taskServer, /listPersonWorkspaceTaskPage/);
assert.match(taskServer, /work_list_person_task_page/);
assert.doesNotMatch(taskServer, /listAllTaskCandidates/);
assert.match(taskServer, /\.order\("id", \{ ascending: true \}\)/);
const sortedTaskMigration = readFileSync(resolve(import.meta.dirname, "../supabase/migrations/0052_work_os_sorted_task_history.sql"), "utf8");
assert.match(sortedTaskMigration, /create or replace function public\.work_list_person_tasks_sorted/);
assert.match(sortedTaskMigration, /t\.assignee_person_ids @> array\[p_person_id\]/);
assert.match(sortedTaskMigration, /t\.assignee_provider_ids @> array\[p_nifty_member_id\]/);
assert.match(sortedTaskMigration, /\(t\.raw -> 'subscribers'\) \? p_nifty_member_id/);
assert.doesNotMatch(sortedTaskMigration, /coalesce\(t\.raw -> 'subscribers'/);
assert.match(sortedTaskMigration, /limit least\(greatest\(coalesce\(p_limit, 100\), 1\), 1000\)/);
const cursorTaskMigration = readFileSync(resolve(import.meta.dirname, "../supabase/migrations/0059_work_os_task_cursor_pagination.sql"), "utf8");
assert.match(cursorTaskMigration, /create or replace function public\.work_list_person_task_page/);
assert.match(cursorTaskMigration, /t\.organization_id = p_organization_id/);
assert.match(cursorTaskMigration, /p_after/);
assert.match(cursorTaskMigration, /p_search/);
assert.match(cursorTaskMigration, /p_excluded_task_ids/);
assert.match(cursorTaskMigration, /p_overdue_first/);
assert.match(cursorTaskMigration, /revoke all on function public\.work_list_person_task_page/);
assert.match(cursorTaskMigration, /least\(greatest\(coalesce\(p_limit, 50\), 1\), 50\)/);

// Release metadata stays in sync: Cargo.lock carries both the companion's own
// version and its dependencies', and bumping the wrong line breaks the packaged
// build (the chrono 0.4.52 incident, 2026-10-15).
const companionPackage = JSON.parse(read("package.json"));
const cargoLock = read("src-tauri/Cargo.lock");
const companionLockVersion = /name = "work-os-companion"\nversion = "([^"]+)"/.exec(cargoLock)?.[1] ?? null;
assert.equal(companionLockVersion, companionPackage.version, "Cargo.lock's work-os-companion version must match package.json");
// The release bump must touch the companion's own entry, never a dependency
// whose version happens to look the same. Counting the companion's package
// blocks is the exact check; counting raw version strings misfires whenever a
// dependency legitimately shares the companion's version (0.5.1 does).
const cargoLockPackages = cargoLock.split("\n[[package]]\n").slice(1);
const companionLockPackages = cargoLockPackages.filter((block) => /^name = "work-os-companion"$/m.test(block));
assert.equal(companionLockPackages.length, 1, "the companion must have exactly one Cargo.lock entry");
assert.match(companionLockPackages[0]!, new RegExp(`^version = "${companionPackage.version}"$`, "m"));
assert.match(read("src-tauri/Cargo.toml"), new RegExp(`^version = "${companionPackage.version}"$`, "m"));
assert.match(read("src-tauri/tauri.conf.json"), new RegExp(`"version": "${companionPackage.version}"`));
// package-lock.json drifted silently across two releases before this guard:
// both its root version and the "" package entry must track package.json.
const companionLockFile = JSON.parse(read("package-lock.json"));
assert.equal(companionLockFile.version, companionPackage.version, "package-lock.json's version must match package.json");
assert.equal(companionLockFile.packages[""].version, companionPackage.version, "package-lock.json's root package version must match package.json");
