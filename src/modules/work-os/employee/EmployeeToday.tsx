"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Check, ListTodo, Pencil, Sparkles, Video } from "lucide-react";
import { CheckInComposer, useCheckInVoice } from "../CheckInComposer";
import { lateReasonRequired } from "@/lib/work-os-late-start";
import { taskIsOverdue } from "@/lib/work-os-task-permissions";
import { useEmployeeDay, useOutstandingEods } from "./useEmployeeDay";
import EmployeePlanBuilder from "./EmployeePlanBuilder";
import EmployeeActivityRecaps from "./EmployeeActivityRecaps";
import { planStatusLabel } from "./planning";
import { useNow } from "./useNow";
import { remainingShiftLabel, shiftPulse, untilShiftLabel } from "./shiftPulse";
import { calendarDateLabel, fetchJson, formatTime, longDateLabel, operationLabel, requestId, type AnyRow, type EmployeeInsightsResponse } from "./model";
import { Notice, PrimaryButton, SecondaryButton, Skeleton, SyncChip } from "./ui";
import styles from "./EmployeeToday.module.css";

function goalProvenanceLabel(provenance: string | null | undefined, hasGoal: boolean) {
  if (provenance === "suggested") return "suggested by Otto";
  if (provenance === "ai_draft") return "drafted with Otto";
  if (provenance === "accepted_suggestion") return "accepted suggestion";
  return hasGoal ? "written by you" : "optional";
}

function weekdayInitial(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { timeZone: "UTC", weekday: "narrow" }).format(parsed);
}

function dueLabel(task: AnyRow, shiftDate?: string) {
  const due = String(task.due_date ?? "").slice(0, 10);
  if (!due) return "No date";
  if (shiftDate && due === shiftDate) return "Today";
  return calendarDateLabel(due);
}

function isOverdue(task: AnyRow, shiftDate?: string) {
  return Boolean(shiftDate && taskIsOverdue(task, shiftDate));
}

export default function EmployeeToday() {
  const { day, refresh, watchExpectation, sync, syncing } = useEmployeeDay();
  const now = useNow();
  const [input, setInput] = useState("");
  const [goal, setGoal] = useState("");
  const [lateReasonDraft, setLateReasonDraft] = useState("");
  const [goalLoomOpen, setGoalLoomOpen] = useState(false);
  const [goalLoomUrl, setGoalLoomUrl] = useState("");
  const [goalLoomTranscript, setGoalLoomTranscript] = useState("");
  const [goalLoomNote, setGoalLoomNote] = useState<string | null>(null);
  const [planBuilderOpen, setPlanBuilderOpen] = useState(false);
  const [planSeed, setPlanSeed] = useState<string | undefined>(undefined);
  const [editingFocus, setEditingFocus] = useState(false);
  const [listTab, setListTab] = useState<"today" | "carry">("today");

  const outstanding = useOutstandingEods();
  const insights = useQuery<EmployeeInsightsResponse>({
    queryKey: ["work-os", "employee-insights", "7d", day.data?.shiftDate],
    queryFn: () => fetchJson(`/api/work-os/me/insights?range=7d&through=${encodeURIComponent(day.data?.shiftDate ?? "")}`),
    enabled: Boolean(day.data?.shiftDate),
    staleTime: 60_000,
  });
  const onboarding = useQuery<AnyRow>({
    queryKey: ["work-os", "employee-onboarding"],
    queryFn: () => fetchJson("/api/work-os/me/onboarding"),
    staleTime: 30_000,
  });

  useEffect(() => {
    setGoal(day.data?.workspaceSummary?.goal.text ?? day.data?.plan?.focus_summary ?? day.data?.plan?.freeform_intent ?? "");
  }, [day.data?.workspaceSummary?.goal.text, day.data?.plan?.focus_summary, day.data?.plan?.freeform_intent]);

  const checkIn = useMutation({
    mutationFn: (body: AnyRow) => fetchJson("/api/work-os/check-ins", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": requestId() },
      body: JSON.stringify({ source: "web", kind: day.data?.prompt.kind || "optional", ...body }),
    }),
    onSuccess: () => {
      setInput("");
      void refresh();
    },
  });

  /* Voice input (design §8.8): a transcript lands in the draft for review;
     nothing is ever sent by the recorder itself. Both the organization flag and
     the deployment capability must be present, so a client that shipped ahead
     of its server never offers a record control that cannot work. */
  const voiceAvailable = day.data?.access?.featureFlags?.voice_input === true
    && day.data?.access?.capabilities?.voice_input === true;
  const checkInVoice = useCheckInVoice(input, setInput, voiceAvailable);

  const saveGoal = useMutation({
    mutationFn: (options?: { openBuilder?: boolean }) => fetchJson("/api/work-os/me/plan", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Idempotency-Key": requestId() },
      body: JSON.stringify({
        shift_date: day.data?.shiftDate,
        revision: day.data?.workspaceSummary?.goal.revision ?? 0,
        freeform_intent: goal,
        focus_summary: null,
        goal_provenance: goal.trim() ? "employee" : null,
        suggestion_task_ids: [],
      }),
    }),
    onSuccess: (_data, options) => {
      setEditingFocus(false);
      void refresh();
      if (options?.openBuilder) {
        setPlanSeed(goal.trim());
        setPlanBuilderOpen(true);
      }
    },
  });

  const goalLoom = useMutation({
    mutationFn: () => fetchJson<{
      blocked: boolean;
      reason: string | null;
      temporal: { verdict: string; createdLocalDate: string | null } | null;
      metadata: { title: string | null } | null;
      analysis: { summary: string; suggestedTasks: Array<{ title: string }> } | null;
    }>("/api/work-os/me/loom/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: goalLoomUrl.trim(), transcript: goalLoomTranscript.trim() || undefined, targetDate: day.data?.shiftDate }),
    }),
    onSuccess: (result) => {
      if (result.blocked) {
        setGoalLoomNote("That recording is from another day, so it can't shape today's goal.");
        return;
      }
      if (!result.analysis) {
        setGoalLoomNote(result.reason === "transcript_required"
          ? "Loom didn't return a transcript for that recording, so it could only be read for its title. Paste the transcript and analyze again."
          : "The recording analysis is unavailable right now. Try again in a moment.");
        return;
      }
      if (!goal.trim()) setGoal(result.analysis.summary);
      setGoalLoomNote(`Analyzed “${result.metadata?.title ?? "Loom recording"}”: ${result.analysis.summary}${result.analysis.suggestedTasks.length ? ` · ${result.analysis.suggestedTasks.length} suggested task${result.analysis.suggestedTasks.length === 1 ? "" : "s"} — describe them in your update to file them.` : ""}`);
    },
    onError: (error) => setGoalLoomNote(error instanceof Error ? error.message : "The recording could not be analyzed."),
  });

  const sessionAction = useMutation({
    mutationFn: (body: AnyRow) => fetchJson("/api/work-os/me/workday", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Idempotency-Key": requestId() },
      body: JSON.stringify(body),
    }),
    onSuccess: () => {
      setLateReasonDraft("");
      void refresh();
    },
  });

  const changeTask = useMutation({
    mutationFn: ({ task, body }: { task: AnyRow; body: AnyRow }) => fetchJson(`/api/work-os/me/tasks/${encodeURIComponent(String(task.provider_task_id || task.id))}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Idempotency-Key": requestId() },
      body: JSON.stringify(body),
    }),
    onSuccess: () => void refresh(),
  });

  // Carry-over tasks can be pulled onto today (surface) or explicitly deferred;
  // the plan surface owns both transitions, exactly like the companion.
  const surfaceTask = useMutation({
    mutationFn: ({ task, disposition }: { task: AnyRow; disposition: "selected" | "deferred" }) => fetchJson("/api/work-os/me/plan", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Idempotency-Key": requestId() },
      body: JSON.stringify(disposition === "selected" ? { surface_task_id: task.id } : { defer_task_id: task.id }),
    }),
    onSuccess: () => void refresh(),
  });

  const workspace = day.data?.workspaceSummary;
  const shift = day.data?.shift;
  const timezone = shift?.timezone;
  const attendance = day.data?.attendance;
  const workSession = day.data?.session;
  const lateReasonMissing = lateReasonRequired(day.data?.session);
  const outstandingCount = outstanding.data?.count ?? 0;
  const eodDue = day.data?.prompt.kind === "eod" || !!day.data?.report;
  const onboardingRequired = onboarding.data?.onboardingRequired === true;
  const openTasks = useMemo(() => (day.data?.tasks ?? []).filter((task) => !task.completed), [day.data?.tasks]);
  const firstMoves = openTasks.slice(0, 5);
  const carryOverCount = workspace?.carryOverGroups?.reduce((sum, group) => sum + (group.tasks?.length ?? 0), 0) ?? 0;
  const pulse = shiftPulse(day.data?.session, shift, new Date(now), day.data?.breakPolicy?.worktivityAuthoritative === true, attendance ?? null);
  const remainingLabel = remainingShiftLabel(shift, new Date(now));
  const upcomingLabel = pulse.schedulePhase === "upcoming" ? untilShiftLabel(shift, new Date(now)) : null;
  const goalChanged = goal !== (day.data?.workspaceSummary?.goal.text ?? day.data?.plan?.freeform_intent ?? "");
  const error = onboarding.error || day.error || checkIn.error || saveGoal.error || sessionAction.error || changeTask.error || surfaceTask.error || goalLoom.error;

  const savedGoal = day.data?.workspaceSummary?.goal.text ?? day.data?.plan?.freeform_intent ?? "";
  const showFocusEditor = editingFocus || !goal.trim();
  const attendanceObserved = attendance?.source === "worktivity";
  const attendanceLabel = attendanceObserved ? operationLabel(String(attendance?.state || "unknown")) : "Not observed";
  const attendanceTone = attendanceObserved
    ? attendance?.state === "active" ? "ok" : attendance?.state === "paused" ? "warn" : "neutral"
    : "neutral";
  const nextCheckIn = day.data?.prompt.nextPromptAt ? formatTime(day.data.prompt.nextPromptAt, timezone) : null;
  const carryGroups = workspace?.carryOverGroups ?? [];

  const weekDays = insights.data?.days ?? [];
  const weekValues = weekDays.map((entry) => Number(entry.tasksCompleted ?? 0));
  const weekTotal = weekValues.reduce((sum, value) => sum + value, 0);
  const weekMax = Math.max(4, Math.ceil(Math.max(1, ...weekValues) / 2) * 2);
  const chartX = (index: number) => 42 + (index * 280) / Math.max(1, weekDays.length - 1);
  const chartY = (value: number) => 122 - (value / weekMax) * 92;
  const weekPoints = weekDays.map((entry, index) => ({
    x: chartX(index),
    y: chartY(Number(entry.tasksCompleted ?? 0)),
    date: entry.date,
  }));
  const weekLine = weekPoints.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const weekArea = weekPoints.length
    ? `${weekLine} L${weekPoints[weekPoints.length - 1].x.toFixed(1)} 122 L${weekPoints[0].x.toFixed(1)} 122 Z`
    : "";
  const weekLabel = weekDays
    .map((entry) => `${calendarDateLabel(entry.date)} ${Number(entry.tasksCompleted ?? 0)} tasks completed`)
    .join(", ");
  const consistency = insights.data?.consistency;
  const onTime = weekDays.reduce((sum, entry) => sum + Number(entry.outcomesOnTime ?? 0), 0);
  const late = weekDays.reduce((sum, entry) => sum + Number(entry.outcomesLate ?? 0), 0);
  const onTimePercent = onTime + late > 0 ? Math.round((onTime / (onTime + late)) * 100) : null;
  const updatePercent = consistency && consistency.dayCount > 0
    ? Math.round((consistency.daysWithUpdate / consistency.dayCount) * 100)
    : null;
  const completionPercent = consistency && consistency.dayCount > 0
    ? Math.round((consistency.daysWithCompletion / consistency.dayCount) * 100)
    : null;

  if (day.isLoading && !day.data) {
    return (
      <div aria-busy="true">
        <header className={styles.masthead}>
          <p className={styles.metaRow}><span>Loading your workday</span></p>
          <div className={styles.titleRow}><h1>Today</h1></div>
        </header>
        <section className={styles.command}>
          <div style={{ height: 208 }} />
        </section>
        <div className={styles.grid}>
          <section className={styles.panel} style={{ minHeight: 320 }} />
          <aside className={styles.side}>
            <div><Skeleton className="h-4 w-24" /><Skeleton className="mt-4 h-32 w-full" /></div>
            <div><Skeleton className="h-4 w-28" /><Skeleton className="mt-4 h-16 w-full" /></div>
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={`${styles.masthead} ${styles.reveal}`} style={{ "--delay": "0ms" } as CSSProperties}>
        <div className={styles.metaRow}>
          <span>{longDateLabel(day.data?.shiftDate)}</span>
        </div>
        <div className={styles.titleRow}>
          <h1>Today</h1>
          <p className={styles.schedule}>
            {shift ? `${formatTime(shift.startsAt, timezone)} – ${formatTime(shift.endsAt, timezone)} · ${timezone}` : "No schedule is configured for today."}
          </p>
          <div className={styles.utilities}>
            {outstandingCount > 0 ? (
              <Link href="/work-os/review" className={styles.attention}>
                <span aria-hidden className={styles.attentionDot} />
                {outstandingCount} outstanding EOD{outstandingCount === 1 ? "" : "s"}
              </Link>
            ) : null}
            <SyncChip compact sync={day.data?.niftySync} syncing={syncing} onSync={() => sync.mutate()} />
          </div>
        </div>
      </header>

      {error ? <Notice tone="err" className="mb-4">{(error as Error).message}</Notice> : null}

      {lateReasonMissing ? (
        <div className={`${styles.notice} ${styles.noticeWarn}`} role="status" aria-live="polite">
          <span><strong>Late start — add a reason.</strong> Your workday began 30+ minutes after your scheduled start. Record the reason to clear the reminder.</span>
          <div className={styles.lateForm}>
            <textarea
              value={lateReasonDraft}
              onChange={(event) => setLateReasonDraft(event.target.value)}
              rows={2}
              maxLength={1000}
              className={styles.lateInput}
              placeholder="Reason for the late start"
              aria-label="Reason for the late start"
            />
            <PrimaryButton
              disabled={!lateReasonDraft.trim() || sessionAction.isPending}
              onClick={() => sessionAction.mutate({ action: "late_reason", reason: lateReasonDraft.trim() })}
            >
              {sessionAction.isPending ? "Saving…" : "Save reason"}
            </PrimaryButton>
          </div>
        </div>
      ) : null}

      {onboardingRequired ? (
        <div className={styles.notice}>
          <span>Finish your Work OS setup — profile, working hours, and required consent.</span>
          <Link href="/work-os/settings" className={styles.noticeLink}>Open Settings</Link>
        </div>
      ) : null}

      {day.data?.prompt.kind === "plan" && day.data?.plan?.status !== "confirmed" ? (
        <div className={styles.notice}>
          <span>{day.data.prompt.reason || "Start the day by building your plan."}</span>
          <button
            type="button"
            className={styles.noticeLink}
            onClick={() => { setPlanSeed(goal.trim() || undefined); setPlanBuilderOpen(true); }}
          >
            Build my plan
          </button>
        </div>
      ) : null}

      <section className={`${styles.command} ${styles.reveal}`} style={{ "--delay": "80ms" } as CSSProperties} aria-labelledby="today-state">
        <div className={styles.stateRow}>
          <div>
            <div className={styles.stateLine}>
              <span
                aria-hidden
                className={`${styles.stateDot} ${attendanceTone === "ok" ? styles.dotOk : attendanceTone === "warn" ? styles.dotWarn : styles.dotNeutral}`}
              />
              <h2 id="today-state">{attendanceLabel}</h2>
            </div>
            <p className={styles.stateDetail}>
              {attendance?.observedAt
                ? `Last observed ${formatTime(attendance.observedAt, timezone)}${attendance.clockedOutAtInferred ? ", clock-out boundary inferred" : ""}. `
                : "No Worktivity observation yet. "}
              Attendance stays in the Windows Companion; this page reports it.
            </p>
            {workSession ? <p className={styles.stateDetail}>Work OS session: {operationLabel(String(workSession.state))}.</p> : null}
            {attendance?.message ? <p className={styles.stateDetail}>{attendance.message}</p> : null}
            {watchExpectation ? (
              <p className={styles.watch} role="status">
                {watchExpectation === "clock-in"
                  ? "Checking your activity… Work OS will clock you in as soon as Worktivity sees you working."
                  : "Checking your activity… Work OS will close the day when Worktivity observes your clock-out."}
              </p>
            ) : null}
          </div>

          {shift ? (
            <div className={styles.window}>
              <div className={styles.windowValues}>
                <span className={styles.windowElapsed}><strong>{pulse.elapsedLabel}</strong><span>elapsed</span></span>
                <span className={styles.windowLeft}>{upcomingLabel ?? remainingLabel ?? `${Math.round(pulse.progressPercent)}% of the window`}</span>
              </div>
              <div
                className={styles.track}
                role="progressbar"
                aria-label="Scheduled shift progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(pulse.progressPercent)}
              >
                <span className={styles.trackFill} style={{ width: `${pulse.progressPercent}%` }} />
                <span className={styles.trackMarker} style={{ left: `${pulse.progressPercent}%` }} />
              </div>
              <div className={styles.axis}>
                <span>{formatTime(shift.startsAt, timezone)}</span>
                <span>{formatTime(shift.endsAt, timezone)}</span>
              </div>
              <p className={styles.instrumentNote}>
                Scheduled-window progress only — not a productivity measure.
                {pulse.breakSeconds > 0 ? ` Break ${pulse.breakLabel}.` : ""}
              </p>
            </div>
          ) : (
            <p className={styles.stateDetail}>No schedule is configured for today.</p>
          )}
        </div>

        <div className={styles.counts}>
          <Link className={styles.count} href="/work-os/tasks">
            <span className={styles.countLabel}>Completed</span>
            <span className={styles.countValue}>
              {workspace?.completed ?? 0}<span className={styles.countDenom}>/{workspace?.total ?? 0}</span>
            </span>
            <span className={styles.countSub}>outcomes today</span>
          </Link>
          <Link className={styles.count} href="/work-os/tasks">
            <span className={styles.countLabel}>Open today</span>
            <span className={styles.countValue}>{openTasks.length}</span>
            <span className={styles.countSub}>attributed to today</span>
          </Link>
          <Link className={`${styles.count} ${workspace?.overdueCount ? styles.countAttention : ""}`} href="/work-os/tasks">
            <span className={styles.countLabel}>Overdue</span>
            <span className={styles.countValue}>{workspace?.overdueCount ?? 0}</span>
            <span className={styles.countSub}>open work past due</span>
          </Link>
          <Link className={styles.count} href="/work-os/tasks">
            <span className={styles.countLabel}>Carry-over</span>
            <span className={styles.countValue}>{carryOverCount}</span>
            <span className={styles.countSub}>older open work</span>
          </Link>
        </div>

        <div className={styles.focusRow}>
          {showFocusEditor ? (
            <div className={styles.focusEditor}>
              <span className={styles.countLabel}>Today&rsquo;s focus</span>
              <textarea
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                rows={2}
                maxLength={4000}
                placeholder="What will you do today?"
                className={styles.focusField}
                aria-label="What will you do today?"
              />
              <p className={styles.focusHelper}>Goal setting is independent of attendance. Building a plan drafts reviewable commitments — nothing is filed until you confirm it.</p>

              {day.data?.access?.featureFlags?.loom_updates === true ? (
                <div className={styles.loomWrap}>
                  <div className={styles.loomRow}>
                    <span className={styles.loomLabel}>Recorded a Loom for today?</span>
                    <button type="button" className={styles.loomToggle} onClick={() => { setGoalLoomOpen((value) => !value); setGoalLoomNote(null); }}>
                      {goalLoomOpen ? "Close" : "Analyze a Loom"}
                    </button>
                  </div>
                  {goalLoomOpen ? (
                    <div className={styles.loomPanel}>
                      <div className="flex flex-wrap items-start gap-2">
                        <input
                          value={goalLoomUrl}
                          onChange={(event) => { setGoalLoomUrl(event.target.value); setGoalLoomNote(null); goalLoom.reset(); }}
                          placeholder="https://www.loom.com/share/…"
                          className={`${styles.loomInput} min-w-[220px] flex-1`}
                          aria-label="Loom share link"
                        />
                        <SecondaryButton
                          type="button"
                          disabled={!goalLoomUrl.trim() || goalLoom.isPending}
                          onClick={() => goalLoom.mutate()}
                        >
                          <Video size={13} /> {goalLoom.isPending ? "Analyzing…" : "Analyze"}
                        </SecondaryButton>
                      </div>
                      <details>
                        <summary className="cursor-pointer text-[11px] font-semibold text-[var(--text-tertiary)]">Paste transcript (optional)</summary>
                        <textarea
                          value={goalLoomTranscript}
                          onChange={(event) => setGoalLoomTranscript(event.target.value)}
                          rows={3}
                          maxLength={50000}
                          placeholder="Only if Loom has no transcript: open Transcript in Loom, Copy, and paste it here."
                          className={`${styles.loomTranscript} mt-2`}
                          aria-label="Loom transcript"
                        />
                      </details>
                      {goalLoomNote ? <p className={styles.loomNote}>{goalLoomNote}</p> : null}
                      <p className={styles.loomNoteQuiet}>Analysis only fills the goal text for you to review and save. It files nothing and stores no video.</p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <div className={styles.focusCopy}>
              <span className={styles.countLabel}>Today&rsquo;s focus</span>
              <p className={styles.focusText}>{goal}</p>
              <span className={styles.provenance}>
                {goalProvenanceLabel(workspace?.goal.provenance, true)} · {planStatusLabel(day.data?.plan)}
                {nextCheckIn ? ` · Next check-in ${nextCheckIn}` : ""}
              </span>
            </div>
          )}

          <div className={`${styles.focusActions} ${showFocusEditor ? styles.focusActionsStack : ""}`}>
            {showFocusEditor ? (
              <>
                <PrimaryButton
                  disabled={!goal.trim() || !goalChanged || saveGoal.isPending}
                  onClick={() => {
                    const firstGoal = !savedGoal.trim();
                    saveGoal.mutate({ openBuilder: firstGoal && goal.trim().length > 0 });
                  }}
                >
                  {saveGoal.isPending ? "Saving…" : "Save focus"}
                </PrimaryButton>
                {editingFocus ? (
                  <SecondaryButton onClick={() => { setGoal(savedGoal); setEditingFocus(false); }}>Cancel</SecondaryButton>
                ) : null}
                <SecondaryButton onClick={() => { setPlanSeed(goal.trim() || undefined); setPlanBuilderOpen(true); }} disabled={!day.data}>
                  <Sparkles size={13} /> Plan your day
                </SecondaryButton>
              </>
            ) : (
              <>
                <PrimaryButton onClick={() => { setPlanSeed(goal.trim() || undefined); setPlanBuilderOpen(true); }} disabled={!day.data}>
                  <Sparkles size={13} /> Plan your day
                </PrimaryButton>
                <button
                  type="button"
                  className={styles.iconAction}
                  aria-label="Edit today's focus"
                  onClick={() => setEditingFocus(true)}
                >
                  <Pencil size={14} />
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      <div className={styles.grid}>
        <section className={`${styles.panel} ${styles.reveal}`} style={{ "--delay": "150ms" } as CSSProperties} aria-labelledby="today-work">
          <header className={styles.panelHead}>
            <h2 className={styles.panelTitle} id="today-work">Today&rsquo;s work</h2>
            <div className={styles.tabs} role="group" aria-label="Today's task views">
              <button
                type="button"
                aria-pressed={listTab === "today"}
                className={`${styles.tab} ${listTab === "today" ? styles.tabActive : ""}`}
                onClick={() => setListTab("today")}
              >
                Today<span className={styles.tabCount}>{openTasks.length}</span>
              </button>
              <button
                type="button"
                aria-pressed={listTab === "carry"}
                className={`${styles.tab} ${listTab === "carry" ? styles.tabActive : ""}`}
                onClick={() => setListTab("carry")}
              >
                Carry-over<span className={styles.tabCount}>{carryOverCount}</span>
              </button>
            </div>
          </header>

          {listTab === "today" ? (
            firstMoves.length ? (
              <>
                <div className={styles.thead} aria-hidden="true">
                  <span />
                  <span>Task</span>
                  <span>Due</span>
                  <span>Status</span>
                </div>
                <ul className={styles.rows}>
                  {firstMoves.map((task) => {
                    const overdue = isOverdue(task, day.data?.shiftDate);
                    return (
                      <li key={task.id} className={styles.row}>
                        <button
                          type="button"
                          aria-label={`Mark ${task.title} done`}
                          onClick={() => changeTask.mutate({ task, body: { completed: true } })}
                          disabled={changeTask.isPending}
                          className={styles.check}
                        >
                          <Check size={11} strokeWidth={3} />
                        </button>
                        <div className={styles.task}>
                          <span className={styles.taskTitle}>{task.title}</span>
                          <span className={styles.taskMeta}>
                            {task.project?.name ? <span className={styles.project}>{task.project.name}</span> : null}
                            {task.project?.name && task.priority ? <span className={styles.metaDot} /> : null}
                            {task.priority ? <span>{operationLabel(String(task.priority))} priority</span> : null}
                          </span>
                        </div>
                        <span className={styles.rowMetaLine}>
                          <span>Due {dueLabel(task, day.data?.shiftDate)}</span>
                          <span className={styles.metaDot} />
                          <span>{overdue ? "Overdue" : "Open"}</span>
                        </span>
                        <span className={styles.due}>{dueLabel(task, day.data?.shiftDate)}</span>
                        <span className={styles.statusCell}>
                          <span className={`${styles.pill} ${overdue ? styles.pillOverdue : styles.pillOpen}`}>
                            {overdue ? "Overdue" : "Open"}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <div className={styles.empty}>
                <span className={styles.emptyIcon}><ListTodo size={17} /></span>
                <strong>No tasks are attributed to today</strong>
                <p>Add a task or plan your day to get started.</p>
              </div>
            )
          ) : carryGroups.length ? (
            <ul className={styles.rows}>
              {carryGroups.map((group) => (
                <li key={group.key} className={styles.carryGroup}>
                  <p className={styles.carryLabel}>{group.label} · {group.tasks?.length ?? 0}</p>
                  <ul className={styles.rows}>
                    {(group.tasks ?? []).map((task: AnyRow) => (
                      <li key={task.id} className={styles.carryRow}>
                        <div className={styles.task}>
                          <span className={styles.taskTitle}>{task.title || "Untitled task"}</span>
                          <span className={styles.taskMeta}>
                            {task.due_date ? <span>Due {dueLabel(task, day.data?.shiftDate)}</span> : <span>No due date</span>}
                          </span>
                        </div>
                        <div className={styles.carryActions}>
                          <button
                            type="button"
                            className={styles.rowAction}
                            disabled={surfaceTask.isPending}
                            onClick={() => surfaceTask.mutate({ task, disposition: "selected" })}
                          >
                            Add to today
                          </button>
                          <button
                            type="button"
                            className={styles.rowAction}
                            disabled={surfaceTask.isPending}
                            onClick={() => surfaceTask.mutate({ task, disposition: "deferred" })}
                          >
                            Defer
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          ) : (
            <div className={styles.empty}>
              <span className={styles.emptyIcon}><ListTodo size={17} /></span>
              <strong>No older open work</strong>
              <p>Everything attributed to earlier days is closed or deferred.</p>
            </div>
          )}

          <footer className={styles.panelFoot}>
            <span>
              {listTab === "today"
                ? `Showing ${firstMoves.length} of ${openTasks.length}`
                : `${carryOverCount} older task${carryOverCount === 1 ? "" : "s"}`}
            </span>
            <Link href="/work-os/tasks" className={styles.panelFootLink}>Open Tasks</Link>
          </footer>
        </section>

        <aside className={styles.side}>
          <section className={`${styles.instrument} ${styles.reveal}`} style={{ "--delay": "220ms" } as CSSProperties} aria-labelledby="week-title">
            <div className={styles.instrumentHead}>
              <h2 id="week-title">This week</h2>
              <span className={styles.total}><strong>{weekTotal}</strong> completed</span>
            </div>
            {weekDays.length ? (
              <>
                <svg
                  className={styles.chart}
                  viewBox="0 0 340 168"
                  role="img"
                  aria-label={`Tasks completed each day: ${weekLabel}.`}
                >
                  <line className={styles.gridLine} x1="34" y1={chartY(weekMax)} x2="330" y2={chartY(weekMax)} />
                  <line className={styles.gridLine} x1="34" y1={chartY(weekMax / 2)} x2="330" y2={chartY(weekMax / 2)} />
                  <line className={styles.gridLine} x1="34" y1={chartY(0)} x2="330" y2={chartY(0)} />
                  <text className={styles.axisLabel} x="6" y={chartY(weekMax) + 3}>{weekMax}</text>
                  <text className={styles.axisLabel} x="6" y={chartY(weekMax / 2) + 3}>{weekMax / 2}</text>
                  <text className={styles.axisLabel} x="6" y={chartY(0) + 3}>0</text>
                  {weekPoints.length > 1 ? <path className={styles.area} d={weekArea} /> : null}
                  {weekPoints.length > 1 ? <path className={styles.line} pathLength={1} d={weekLine} /> : null}
                  {weekPoints.map((point, index) => (
                    <circle
                      key={`${point.date}-dot`}
                      className={index === weekPoints.length - 1 ? styles.chartDotToday : styles.chartDot}
                      cx={point.x}
                      cy={point.y}
                      r={index === weekPoints.length - 1 ? 4.2 : 3.4}
                    />
                  ))}
                  {weekDays.map((entry, index) => (
                    <text
                      key={`${entry.date}-label`}
                      className={index === weekDays.length - 1 ? `${styles.dayLabel} ${styles.dayLabelToday}` : styles.dayLabel}
                      x={weekPoints[index]?.x ?? 0}
                      y="146"
                      textAnchor="middle"
                    >
                      {index === weekDays.length - 1 ? "Today" : weekdayInitial(entry.date)}
                    </text>
                  ))}
                </svg>
                <p className={styles.chartNote}>Tasks completed, not a productivity score. Today is the filled mark.</p>
              </>
            ) : (
              <div className={styles.chartEmpty}>
                {insights.isLoading ? "Loading this week's record…" : insights.isError ? "This week's record is unavailable right now." : "No recorded days in this range."}
              </div>
            )}
          </section>

          {onTimePercent !== null || updatePercent !== null ? (
            <section className={`${styles.instrument} ${styles.reveal}`} style={{ "--delay": "280ms" } as CSSProperties} aria-labelledby="reliability-title">
              <div className={styles.instrumentHead}>
                <h2 id="reliability-title">Plan reliability</h2>
                <span className={styles.total}>{consistency?.dayCount ?? weekDays.length} days</span>
              </div>
              <div className={styles.reliability}>
                {onTimePercent !== null ? (
                  <div className={styles.relRow}>
                    <div className={styles.relTop}>
                      <span className={styles.relLabel}>On-time outcomes</span>
                      <span className={styles.relValue}>{onTime} of {onTime + late} · {onTimePercent}%</span>
                    </div>
                    <div className={styles.relTrack}><div className={styles.relFill} style={{ width: `${onTimePercent}%` }} /></div>
                  </div>
                ) : null}
                {updatePercent !== null ? (
                  <div className={styles.relRow}>
                    <div className={styles.relTop}>
                      <span className={styles.relLabel}>Days with an update</span>
                      <span className={styles.relValue}>{consistency?.daysWithUpdate ?? 0} of {consistency?.dayCount ?? 0}</span>
                    </div>
                    <div className={styles.relTrack}><div className={styles.relFill} style={{ width: `${updatePercent}%` }} /></div>
                  </div>
                ) : null}
                {completionPercent !== null ? (
                  <div className={styles.relRow}>
                    <div className={styles.relTop}>
                      <span className={styles.relLabel}>Days with a completed task</span>
                      <span className={styles.relValue}>{consistency?.daysWithCompletion ?? 0} of {consistency?.dayCount ?? 0}</span>
                    </div>
                    <div className={styles.relTrack}><div className={`${styles.relFill} ${styles.relFillQuiet}`} style={{ width: `${completionPercent}%` }} /></div>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          {eodDue || outstandingCount > 0 ? (
            <section className={`${styles.eod} ${styles.reveal}`} style={{ "--delay": "330ms" } as CSSProperties} aria-labelledby="eod-title">
              <h2 id="eod-title">End of day</h2>
              <p>
                {eodDue
                  ? "Today's report is ready to draft or review."
                  : `${outstandingCount} past day${outstandingCount === 1 ? "" : "s"} ${outstandingCount === 1 ? "needs" : "need"} a submitted report.`}
              </p>
              <Link href="/work-os/review" className={styles.eodLink}>Open Review <ArrowRight size={13} /></Link>
            </section>
          ) : null}

          <section className={styles.checkinBlock} aria-labelledby="checkin-title">
            <h2 id="checkin-title">Check-in</h2>
            <p>
              {nextCheckIn ? (
                <>Next check-in <span className={styles.checkinWhen}>{nextCheckIn}</span>{day.data?.prompt.required ? ", required" : ", quiet notification"}.</>
              ) : (
                "No check-in is scheduled for today."
              )}
            </p>
          </section>
        </aside>
      </div>

      <section className={styles.composer} aria-labelledby="composer-title">
        <div className={styles.composerHead}>
          <h2 id="composer-title">
            {day.data?.prompt.kind === "catch_up" ? "Shift check-in" : day.data?.prompt.kind === "eod" ? "End-of-day update" : "What are you working on?"}
          </h2>
          <p>{day.data?.prompt.reason || "Add an update whenever your plan changes."}</p>
          {day.data?.prompt.required ? <span className={styles.requiredMark}>Required</span> : null}
        </div>
        <CheckInComposer
          value={input}
          onChange={setInput}
          onSend={() => checkIn.mutate({ input_text: input })}
          onSnooze={() => checkIn.mutate({ snoozed_until: new Date(Date.now() + 30 * 60_000).toISOString() })}
          busy={checkIn.isPending}
          voiceEnabled={voiceAvailable}
          voice={checkInVoice}
        />
      </section>

      <EmployeeActivityRecaps
        date={day.data?.shiftDate ?? ""}
        timezone={day.data?.shift?.timezone}
        prompt={day.data?.prompt}
        voiceAvailable={voiceAvailable}
      />

      {planBuilderOpen && day.data ? (
        <EmployeePlanBuilder
          open
          day={day.data}
          seed={planSeed}
          onClose={() => setPlanBuilderOpen(false)}
          onSaved={() => {
            void refresh();
          }}
        />
      ) : null}
    </div>
  );
}
