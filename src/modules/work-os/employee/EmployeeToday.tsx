"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  Clock3,
  FileCheck2,
  ListTodo,
  MessageSquareText,
  RotateCcw,
  Sparkles,
  Video,
} from "lucide-react";
import { CheckInComposer, useCheckInVoice } from "../CheckInComposer";
import { lateReasonRequired } from "@/lib/work-os-late-start";
import { useEmployeeDay, useOutstandingEods } from "./useEmployeeDay";
import EmployeePlanBuilder from "./EmployeePlanBuilder";
import EmployeeActivityRecaps from "./EmployeeActivityRecaps";
import { planStatusLabel } from "./planning";
import { useNow } from "./useNow";
import { remainingShiftLabel, shiftPulse, untilShiftLabel } from "./shiftPulse";
import { fetchJson, formatTime, longDateLabel, operationLabel, requestId, type AnyRow } from "./model";
import {
  EmptyState,
  Masthead,
  Metric,
  Notice,
  Panel,
  PanelHeader,
  PrimaryButton,
  QuietButton,
  SecondaryButton,
  Skeleton,
  StateMark,
  SyncChip,
  inputClass,
  inputStyle,
} from "./ui";

function goalProvenanceLabel(provenance: string | null | undefined, hasGoal: boolean) {
  if (provenance === "ai_draft") return "drafted with Otto";
  if (provenance === "accepted_suggestion") return "accepted suggestion";
  return hasGoal ? "written by you" : "optional";
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

  const outstanding = useOutstandingEods();
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

  if (day.isLoading && !day.data) {
    return (
      <div aria-busy="true">
        <Masthead eyebrow="Work OS" title="Today" meta="Loading your workday…" />
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid gap-5">
            <Panel className="p-5"><Skeleton className="h-4 w-40" /><Skeleton className="mt-3 h-20 w-full" /><Skeleton className="mt-3 h-9 w-32" /></Panel>
            <Panel className="p-5"><Skeleton className="h-4 w-48" /><Skeleton className="mt-3 h-24 w-full" /></Panel>
          </div>
          <Panel className="p-5"><Skeleton className="h-4 w-28" /><Skeleton className="mt-3 h-14 w-full" /><Skeleton className="mt-2 h-14 w-full" /></Panel>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Masthead
        eyebrow={longDateLabel(day.data?.shiftDate)}
        title="Today"
        meta={shift ? `${formatTime(shift.startsAt, timezone)} – ${formatTime(shift.endsAt, timezone)} · ${timezone}` : "No schedule is configured for today."}
        actions={
          <>
            {outstandingCount > 0 ? (
              <Link href="/work-os/review" className="inline-flex items-center gap-2 rounded-[10px] border px-3 py-2 text-[12px] font-semibold text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
                <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: "var(--status-warn)" }} /> {outstandingCount} outstanding EOD{outstandingCount === 1 ? "" : "s"}
              </Link>
            ) : null}
            <SyncChip sync={day.data?.niftySync} syncing={syncing} onSync={() => sync.mutate()} />
          </>
        }
      />

      {error ? <Notice tone="err" className="mb-5">{(error as Error).message}</Notice> : null}

      {lateReasonMissing ? (
        <div className="mb-5 rounded-2xl border px-5 py-4" style={{ borderColor: "color-mix(in srgb, var(--status-warn) 50%, var(--border))", background: "color-mix(in srgb, var(--status-warn) 7%, var(--bg-card))" }} role="status" aria-live="polite">
          <p className="flex items-center gap-2 text-[13px] font-semibold text-[var(--text-primary)]"><AlertTriangle size={15} style={{ color: "var(--status-warn)" }} /> Late start — add a reason</p>
          <p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">Your workday began 30+ minutes after your scheduled start. Record the reason to clear the reminder and Otto’s red signal.</p>
          <div className="mt-3 flex flex-wrap items-start gap-2">
            <textarea
              value={lateReasonDraft}
              onChange={(event) => setLateReasonDraft(event.target.value)}
              rows={2}
              maxLength={1000}
              className={`${inputClass} min-w-[240px] flex-1 resize-y`}
              style={inputStyle}
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
        <Notice tone="warn" className="mb-5">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span>Finish your Work OS setup — profile, working hours, and required consent.</span>
            <Link href="/work-os/settings" className="font-semibold underline underline-offset-2" style={{ color: "var(--text-primary)" }}>Open Settings</Link>
          </span>
        </Notice>
      ) : null}

      {day.data?.prompt.kind === "plan" && day.data?.plan?.status !== "confirmed" ? (
        <Notice tone="info" className="mb-5">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span>{day.data.prompt.reason || "Start the day by building your plan."}</span>
            <button
              type="button"
              className="font-semibold underline underline-offset-2"
              style={{ color: "var(--text-primary)" }}
              onClick={() => { setPlanSeed(goal.trim() || undefined); setPlanBuilderOpen(true); }}
            >
              Build my plan
            </button>
          </span>
        </Notice>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid content-start gap-5">
          <Panel>
            <PanelHeader
              icon={<CalendarClock size={16} />}
              title="Workday status"
              meta={
                attendance?.source === "worktivity"
                  ? `Worktivity ${attendance?.stale ? "observation is stale" : "is the attendance source"} — sampled activity only.`
                  : "Worktivity has not observed attendance yet."
              }
              actions={
                <StateMark tone={attendance?.source === "worktivity" ? (attendance?.state === "active" ? "ok" : attendance?.state === "paused" ? "warn" : "neutral") : "neutral"}>
                  {attendance?.source === "worktivity" ? operationLabel(String(attendance.state || "unknown")) : "Not observed"}
                </StateMark>
              }
            />
            {pulse.schedulePhase !== "unavailable" || pulse.observedElapsedLabel !== "00:00" ? (
              <div className="border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[24px] font-bold leading-none tabular-nums text-[var(--text-primary)]">{pulse.elapsedLabel}</span>
                    <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">elapsed today</span>
                  </div>
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11px] text-[var(--text-tertiary)]">
                    {pulse.breakSeconds > 0 ? <span>Break {pulse.breakLabel}</span> : null}
                    {pulse.observedElapsedLabel !== "00:00" ? <span>Worktivity observed {pulse.observedElapsedLabel}</span> : null}
                    {upcomingLabel ? <span>{upcomingLabel}</span> : null}
                    {remainingLabel ? <span>{remainingLabel}</span> : null}
                  </div>
                </div>
                <div
                  className="mt-3 h-1.5 overflow-hidden rounded-full"
                  style={{ background: "var(--bg-tertiary)" }}
                  role="progressbar"
                  aria-label="Scheduled shift progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(pulse.progressPercent)}
                >
                  <div className="h-full rounded-full" style={{ width: `${pulse.progressPercent}%`, background: "var(--accent-deep)" }} />
                </div>
                <p className="mt-2 text-[11px] leading-5 text-[var(--text-tertiary)]">Scheduled-window progress only — not a productivity measure.</p>
              </div>
            ) : null}
            <div className="grid gap-3 px-5 py-4 text-[12px] leading-5">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="text-[var(--text-secondary)]">
                  {attendance?.observedAt ? <>Last observed {formatTime(attendance.observedAt, timezone)}{attendance.clockedOutAtInferred ? " · clock-out boundary inferred from this observation" : ""}</> : "No observation yet."}
                </span>
              </div>
              <p className="text-[var(--text-secondary)]">
                {workSession ? `Work OS session: ${operationLabel(String(workSession.state))}.` : "No Work OS session is currently mirrored."}
              </p>
              <p className="text-[var(--text-tertiary)]">
                Clock in, pause, resume, and clock out from the Windows Work OS Companion; it opens Worktivity if needed and waits for Worktivity to confirm each change. This page is status-only.
              </p>
              {attendance?.message ? <p className="text-[var(--text-tertiary)]">{attendance.message}</p> : null}
              {watchExpectation ? (
                <p className="font-semibold" style={{ color: "var(--accent-deep)" }} role="status">
                  {watchExpectation === "clock-in"
                    ? "Checking your activity… Work OS will clock you in as soon as Worktivity sees you working."
                    : "Checking your activity… Work OS will close the day when Worktivity observes your clock-out."}
                </p>
              ) : null}
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              icon={<ListTodo size={16} />}
              title="Today’s focus"
              meta={`Goal · ${goalProvenanceLabel(workspace?.goal.provenance, !!goal.trim())} · ${planStatusLabel(day.data?.plan)}`}
              actions={
                <>
                  <SecondaryButton onClick={() => { setPlanSeed(goal.trim() || undefined); setPlanBuilderOpen(true); }} disabled={!day.data}>
                    <Sparkles size={13} /> Plan your day
                  </SecondaryButton>
                  <PrimaryButton
                    disabled={!goalChanged || saveGoal.isPending}
                    onClick={() => {
                      const firstGoal = !(workspace?.goal.text ?? day.data?.plan?.freeform_intent ?? "").trim();
                      saveGoal.mutate({ openBuilder: firstGoal && goal.trim().length > 0 });
                    }}
                  >
                    {saveGoal.isPending ? "Saving…" : "Save focus"}
                  </PrimaryButton>
                </>
              }
            />
            <div className="px-5 py-4">
              <textarea
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                rows={3}
                maxLength={4000}
                placeholder="What will you do today?"
                className={`${inputClass} resize-y`}
                style={inputStyle}
                aria-label="What will you do today?"
              />
              <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">Goal setting is independent of attendance. Building a plan drafts reviewable commitments — nothing is filed until you confirm it.</p>

              {day.data?.access?.featureFlags?.loom_updates === true ? (
                <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--border-subtle)" }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[12px] font-medium text-[var(--text-secondary)]">Recorded a Loom for today?</span>
                    <button type="button" className="text-[12px] font-semibold text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]" onClick={() => { setGoalLoomOpen((value) => !value); setGoalLoomNote(null); }}>
                      {goalLoomOpen ? "Close" : "Analyze a Loom"}
                    </button>
                  </div>
                  {goalLoomOpen ? (
                    <>
                      <div className="mt-2 flex flex-wrap items-start gap-2">
                        <input
                          value={goalLoomUrl}
                          onChange={(event) => { setGoalLoomUrl(event.target.value); setGoalLoomNote(null); goalLoom.reset(); }}
                          placeholder="https://www.loom.com/share/…"
                          className={`${inputClass} min-w-[220px] flex-1`}
                          style={inputStyle}
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
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[11px] font-semibold text-[var(--text-tertiary)]">Paste transcript (optional)</summary>
                        <textarea
                          value={goalLoomTranscript}
                          onChange={(event) => setGoalLoomTranscript(event.target.value)}
                          rows={3}
                          maxLength={50000}
                          placeholder="Only if Loom has no transcript: open Transcript in Loom, Copy, and paste it here."
                          className={`${inputClass} mt-2 resize-y`}
                          style={inputStyle}
                          aria-label="Loom transcript"
                        />
                      </details>
                      {goalLoomNote ? <p className="mt-2 text-[11px] leading-5 text-[var(--text-secondary)]">{goalLoomNote}</p> : null}
                      <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">Analysis only fills the goal text for you to review and save. It files nothing and stores no video.</p>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              icon={<MessageSquareText size={16} />}
              title={day.data?.prompt.kind === "catch_up" ? "Shift check-in" : day.data?.prompt.kind === "eod" ? "End-of-day update" : "What are you working on?"}
              meta={day.data?.prompt.reason || "Add an update whenever your plan changes."}
              actions={day.data?.prompt.required ? <StateMark tone="warn">Required</StateMark> : null}
            />
            <div className="px-5 py-4">
              <CheckInComposer
                value={input}
                onChange={setInput}
                onSend={() => checkIn.mutate({ input_text: input })}
                onSnooze={() => checkIn.mutate({ snoozed_until: new Date(Date.now() + 30 * 60_000).toISOString() })}
                busy={checkIn.isPending}
                voiceEnabled={voiceAvailable}
                voice={checkInVoice}
              />
            </div>
          </Panel>

          <EmployeeActivityRecaps
            date={day.data?.shiftDate ?? ""}
            timezone={day.data?.shift?.timezone}
            prompt={day.data?.prompt}
            voiceAvailable={voiceAvailable}
          />

          <Panel>
            <PanelHeader
              icon={<Check size={16} />}
              title="First moves"
              meta={`${openTasks.length} open task${openTasks.length === 1 ? "" : "s"} attributed to today.`}
              actions={
                <Link href="/work-os/tasks" className="inline-flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: "var(--accent-deep)" }}>
                  Open Tasks
                </Link>
              }
            />
            {firstMoves.length ? (
              <ul>
                {firstMoves.map((task) => (
                  <li key={task.id} className="flex items-start gap-3 border-b px-5 py-3.5 last:border-b-0" style={{ borderColor: "var(--border)" }}>
                    <button
                      type="button"
                      aria-label={`Mark ${task.title} done`}
                      onClick={() => changeTask.mutate({ task, body: { completed: true } })}
                      disabled={changeTask.isPending}
                      className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border transition hover:border-[var(--accent-deep)]"
                      style={{ borderColor: "var(--border-hot)", color: "transparent" }}
                    >
                      <Check size={12} strokeWidth={3} />
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-[var(--text-primary)]">{task.title}</p>
                      <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--text-tertiary)]">
                        {task.project?.name ? <span>{task.project.name}</span> : null}
                        {task.due_date ? <span>Due {task.due_date}</span> : null}
                        {task.priority ? <span>{operationLabel(String(task.priority))}</span> : null}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={<ListTodo size={20} />}
                title="No open tasks for today"
                message="Tasks you add or plan will show up here as your first moves."
              />
            )}
          </Panel>

          {carryOverCount > 0 ? (
            <Panel>
              <PanelHeader
                icon={<RotateCcw size={16} />}
                title="Carry-over"
                meta={`${carryOverCount} older open task${carryOverCount === 1 ? "" : "s"} not attributed to today. Surface one to bring it into today’s plan, or defer it explicitly.`}
              />
              <div>
                {(workspace?.carryOverGroups ?? []).map((group) => (
                  <div key={group.key} className="border-b px-5 py-3 last:border-b-0" style={{ borderColor: "var(--border-subtle)" }}>
                    <p className="text-[11.5px] font-semibold text-[var(--text-secondary)]">
                      {group.label} · {group.tasks?.length ?? 0}
                    </p>
                    <ul className="mt-1.5 grid gap-1.5">
                      {(group.tasks ?? []).map((task: AnyRow) => (
                        <li key={task.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-primary)]">{task.title || "Untitled task"}</span>
                          {task.due_date ? <span className="text-[11px] tabular-nums text-[var(--text-tertiary)]">Due {task.due_date}</span> : null}
                          <span className="flex shrink-0 gap-1.5">
                            <SecondaryButton
                              className="!px-2 !py-1 !text-[11px]"
                              disabled={surfaceTask.isPending}
                              onClick={() => surfaceTask.mutate({ task, disposition: "selected" })}
                            >
                              Add to today
                            </SecondaryButton>
                            <QuietButton
                              className="!px-2 !py-1 !text-[11px]"
                              disabled={surfaceTask.isPending}
                              onClick={() => surfaceTask.mutate({ task, disposition: "deferred" })}
                            >
                              Defer
                            </QuietButton>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}
        </div>

        <aside className="grid content-start gap-5">
          <Panel>
            <PanelHeader icon={<Clock3 size={16} />} title="Day pulse" />
            <div className="grid grid-cols-2 gap-3 px-5 py-4">
              <Metric label="Completed" value={workspace ? `${workspace.completed}/${workspace.total}` : "—"} detail="attributed today" />
              <Metric label="Overdue" value={workspace?.overdueCount ?? 0} tone={workspace?.overdueCount ? "warn" : "neutral"} detail="open work past due" />
              <Metric label="Carryover" value={carryOverCount} detail="older open work" />
              <Metric
                label="Check-in"
                value={day.data?.prompt.nextPromptAt ? formatTime(day.data.prompt.nextPromptAt, timezone) : "—"}
                detail={day.data?.prompt.nextPromptAt ? (day.data?.prompt.required ? "response required" : "quiet notification") : "none scheduled"}
              />
            </div>
          </Panel>

          {eodDue || outstandingCount > 0 ? (
            <Panel>
              <PanelHeader
                icon={<FileCheck2 size={16} />}
                title="End-of-day report"
                meta={eodDue ? "Today’s report is ready to draft or review." : `${outstandingCount} past day${outstandingCount === 1 ? "" : "s"} ${outstandingCount === 1 ? "needs" : "need"} a submitted report.`}
                actions={
                  <Link href="/work-os/review" className="inline-flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: "var(--accent-deep)" }}>
                    Open Review
                  </Link>
                }
              />
              <div className="px-5 py-4">
                <p className="text-[12px] leading-5 text-[var(--text-secondary)]">
                  {day.data?.report ? `Report status: ${operationLabel(String(day.data.report.status || "draft"))}.` : "Nothing is filed until you submit it in Review."}
                </p>
              </div>
            </Panel>
          ) : null}

          {day.data?.niftySync?.error ? <Notice tone="warn">Nifty sync failed: {day.data.niftySync.error}</Notice> : null}
        </aside>
      </div>

      {planBuilderOpen && day.data ? (
        <EmployeePlanBuilder
          open
          day={day.data}
          seed={planSeed}
          onClose={() => setPlanBuilderOpen(false)}
          onSaved={() => {
            // The builder owns the moment: it shows the checked confirmation
            // and closes itself when the employee dismisses it, so no second
            // receipt banner competes with the dialog.
            void refresh();
          }}
        />
      ) : null}
    </div>
  );
}
