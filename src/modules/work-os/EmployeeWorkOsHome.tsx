"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock3,
  FileCheck2,
  ListTodo,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  RotateCcw,
  Send,
  TimerReset,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { supportedTimezones, timezoneLabel } from "@/modules/work-os/timezones";
import { lateReasonRequired, PROLONGED_ABSENCE_MINUTES } from "@/lib/work-os-late-start";
import { EmployeeEodOutstandingBell, calendarDateLabel, type OutstandingEodDay, type OutstandingEodsResponse } from "@/modules/work-os/EmployeeEodOutstanding";

type AnyRow = Record<string, any>;

interface DayResponse {
  at: string;
  shiftDate: string;
  access?: { featureFlags?: Record<string, boolean> };
  shift: {
    startsAt: string;
    endsAt: string;
    timezone: string;
    breaks: Array<{ startsAt: string; endsAt: string }>;
  } | null;
  prompt: { kind: "plan" | "catch_up" | "optional" | "follow_up" | "hourly_fallback" | "eod" | null; nextPromptAt: string | null; required: boolean; reason: string };
  niftySync?: { fresh: boolean; syncedAt: string | null; error?: string };
  tasks: AnyRow[];
  evidence: AnyRow[];
  proposals: AnyRow[];
  report: AnyRow | null;
  session: AnyRow | null;
  plan: { id: string; status: "draft" | "confirmed" | "closed"; freeform_intent: string | null; focus_summary?: string | null; items: AnyRow[] } | null;
  workspaceSummary?: {
    date: string; readOnly: boolean; completed: number; total: number; overdueCount: number;
    goal: { text: string | null; provenance: string | null; revision: number | null };
    carryOverGroups: Array<{ key: string; label: string; tasks: AnyRow[] }>;
    sessionQuality: { status: string; message: string | null; sessionId?: string | null; clockedInAt?: string | null };
  };
  attendance?: AnyRow;
  breakPolicy?: { worktivityAuthoritative: boolean };
}

interface TaskDayResponse {
  tasks: AnyRow[];
  workspace: NonNullable<DayResponse["workspaceSummary"]> & { goal: { text: string | null; provenance: string | null; revision: number | null } };
  cursor: { next: string | null };
}

interface InsightsResponse {
  range: "day" | "7d" | "30d";
  from: string;
  through: string;
  days: Array<{ date: string; goal: { text: string | null; provenance: string | null }; completed: number; progressed: number; deferred: number; carried: number; unplanned: number; breakFreshness: string; sessionQuality: { status: string; message: string | null }; references: Array<{ id: string; label: string; target: string }> }>;
  brief: { summary: string; wins: string[]; attention: string[]; nextFocus: string[] };
  freshness: { stale: boolean; staleAt: string | null; error: string | null };
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || `Request failed: ${response.status}`);
  return body as T;
}

function formatTime(value?: string | null, timezone?: string) {
  if (!value) return "--:--";
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function operationLabel(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function TaskAssigneeTags({ task }: { task: AnyRow }) {
  const people = Array.isArray(task.assignees) ? task.assignees.filter((person: AnyRow) => typeof person?.displayName === "string") : [];
  if (!people.length) return null;
  return <div className="mt-2 flex flex-wrap gap-1.5" aria-label={`Assigned to ${people.map((person: AnyRow) => person.displayName).join(", ")}`}>
    {people.map((person: AnyRow) => <span key={person.personId || person.displayName} title={person.email || person.displayName} className="inline-flex min-h-6 items-center rounded-full border px-2 text-[10px] font-semibold" style={{ borderColor: "var(--accent)", color: "var(--text-primary)", background: "color-mix(in srgb, var(--accent) 8%, var(--bg-card))" }}>{person.displayName}</span>)}
  </div>;
}

function proposalSummary(proposal: AnyRow) {
  const change = proposal.proposed_change ?? {};
  return change.name || change.title || change.summary || change.progress || change.description || proposal.input_text;
}

function requestId() {
  return globalThis.crypto.randomUUID();
}

export default function EmployeeWorkOsHome() {
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const [goal, setGoal] = useState("");
  const [selectedTaskDate, setSelectedTaskDate] = useState("");
  const [eodListOpen, setEodListOpen] = useState(false);
  const [insightRange, setInsightRange] = useState<"day" | "7d" | "30d">("7d");
  const [taskMenuId, setTaskMenuId] = useState<string | null>(null);
  const [subtaskMenuId, setSubtaskMenuId] = useState<string | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [taskEdit, setTaskEdit] = useState<AnyRow | null>(null);
  const [taskEditTitle, setTaskEditTitle] = useState("");
  const [taskEditDescription, setTaskEditDescription] = useState("");
  const [taskCreateOpen, setTaskCreateOpen] = useState(false);
  const [taskCreateTitle, setTaskCreateTitle] = useState("");
  const [taskCreateDescription, setTaskCreateDescription] = useState("");
  const [clockExceptionReason, setClockExceptionReason] = useState<string | null>(null);
  const [lateReasonDraft, setLateReasonDraft] = useState("");
  const [clockConfirmKind, setClockConfirmKind] = useState<"late" | "exception" | null>(null);
  const [expandedEvidence, setExpandedEvidence] = useState(false);
  const [reportMarkdown, setReportMarkdown] = useState("");
  const [goalLoomOpen, setGoalLoomOpen] = useState(false);
  const [goalLoomUrl, setGoalLoomUrl] = useState("");
  const [goalLoomTranscript, setGoalLoomTranscript] = useState("");
  const [goalLoomNote, setGoalLoomNote] = useState<string | null>(null);
  const [onboardingName, setOnboardingName] = useState("");
  const [onboardingEmail, setOnboardingEmail] = useState("");
  const [onboardingTimezone, setOnboardingTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [onboardingLanguage, setOnboardingLanguage] = useState("en");
  const [onboardingStart, setOnboardingStart] = useState("09:00");
  const [onboardingEnd, setOnboardingEnd] = useState("17:00");
  const [onboardingBreakStart, setOnboardingBreakStart] = useState("");
  const [onboardingBreakEnd, setOnboardingBreakEnd] = useState("");
  const [onboardingDesktop, setOnboardingDesktop] = useState(true);
  const [onboardingConsent, setOnboardingConsent] = useState(false);
  const [onboardingExclusions, setOnboardingExclusions] = useState("");
  const onboardingHydrationKey = useRef<string | null>(null);
  const onboarding = useQuery<AnyRow>({
    queryKey: ["work-os", "employee-onboarding"],
    queryFn: () => fetchJson("/api/work-os/me/onboarding"),
    staleTime: 30_000,
  });
  const day = useQuery<DayResponse>({
    queryKey: ["work-os", "my-day"],
    queryFn: () => fetchJson("/api/work-os/me/day"),
    refetchInterval: 60_000,
  });
  const historicalWorkspace = useQuery<TaskDayResponse>({
    queryKey: ["work-os", "task-day", selectedTaskDate],
    queryFn: () => fetchJson(`/api/work-os/me/tasks?view=day&date=${encodeURIComponent(selectedTaskDate)}&limit=100`),
    enabled: !!selectedTaskDate && selectedTaskDate !== day.data?.shiftDate,
    staleTime: 5 * 60_000,
  });
  const selectedDay = useQuery<DayResponse>({
    queryKey: ["work-os", "my-day", selectedTaskDate],
    queryFn: () => fetchJson(`/api/work-os/me/day?date=${encodeURIComponent(selectedTaskDate)}`),
    enabled: !!selectedTaskDate && selectedTaskDate !== day.data?.shiftDate,
    staleTime: 2 * 60_000,
  });
  const outstanding = useQuery<OutstandingEodsResponse>({
    queryKey: ["work-os", "eod-outstanding"],
    queryFn: () => fetchJson("/api/work-os/me/eod/outstanding?days=14"),
    staleTime: 2 * 60_000,
    refetchInterval: 5 * 60_000,
  });
  const insightsThrough = selectedTaskDate || day.data?.shiftDate;
  const insights = useQuery<InsightsResponse>({
    queryKey: ["work-os", "employee-insights", insightRange, insightsThrough],
    queryFn: () => fetchJson(`/api/work-os/me/insights?range=${insightRange}&through=${encodeURIComponent(insightsThrough ?? "")}`),
    enabled: !!insightsThrough,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (day.data?.shiftDate) setSelectedTaskDate((current) => current || day.data!.shiftDate);
  }, [day.data?.shiftDate]);

  useEffect(() => {
    const historicalGoal = historicalWorkspace.data?.workspace.goal.text;
    setGoal(selectedTaskDate && selectedTaskDate !== day.data?.shiftDate ? historicalGoal ?? "" : day.data?.workspaceSummary?.goal.text ?? day.data?.plan?.focus_summary ?? day.data?.plan?.freeform_intent ?? "");
  }, [selectedTaskDate, historicalWorkspace.data?.workspace.goal.text, day.data?.shiftDate, day.data?.workspaceSummary?.goal.text, day.data?.plan?.focus_summary, day.data?.plan?.freeform_intent]);

  useEffect(() => {
    const profile = onboarding.data?.profile;
    if (!profile) return;
    const resetKey = `${String(profile.email ?? "").trim().toLowerCase()}:${onboarding.data?.status ?? "not_started"}`;
    if (onboardingHydrationKey.current === resetKey) return;
    onboardingHydrationKey.current = resetKey;
    setOnboardingName(profile.displayName || "");
    setOnboardingEmail(profile.email || "");
    setOnboardingTimezone(profile.timezone || "UTC");
    setOnboardingLanguage(profile.language || "en");
    const schedule = profile.schedule || {};
    setOnboardingStart(schedule.shiftStart || "09:00");
    setOnboardingEnd(schedule.shiftEnd || "17:00");
    const firstBreak = Array.isArray(schedule.breaks) ? schedule.breaks[0] : null;
    setOnboardingBreakStart(firstBreak?.start || "");
    setOnboardingBreakEnd(firstBreak?.end || "");
    setOnboardingDesktop(typeof profile.notifications?.desktopEnabled === "boolean" ? profile.notifications.desktopEnabled : true);
    setOnboardingConsent(onboarding.data?.employeeRequirements?.consentProvided === true && onboarding.data?.employeeRequirements?.screenshotConsentProvided === true && onboarding.data?.employeeRequirements?.privacyAcknowledged === true);
    setOnboardingExclusions((profile.privacy?.sensitiveAppExclusions ?? []).join(", "));
  }, [onboarding.data?.profile?.email, onboarding.data?.status]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["work-os", "my-day"] }),
      queryClient.invalidateQueries({ queryKey: ["work-os", "task-day"] }),
      queryClient.invalidateQueries({ queryKey: ["work-os", "employee-insights"] }),
      queryClient.invalidateQueries({ queryKey: ["work-os", "eod-outstanding"] }),
    ]);
  };
  const saveOnboarding = useMutation({
    mutationFn: () => fetchJson("/api/work-os/me/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        preferredName: onboardingName,
        email: onboardingEmail,
        timezone: onboardingTimezone,
        language: onboardingLanguage,
        schedule: {
          daysOfWeek: [1, 2, 3, 4, 5],
          shiftStart: onboardingStart,
          shiftEnd: onboardingEnd,
          breaks: onboardingBreakStart && onboardingBreakEnd ? [{ start: onboardingBreakStart, end: onboardingBreakEnd }] : [],
        },
        notifications: { desktopEnabled: onboardingDesktop },
        privacy: {
          screenshotAnalysisConsent: true,
          sensitiveAppExclusions: onboardingExclusions.split(",").map((value) => value.trim()).filter(Boolean),
        },
        acceptTrackingConsent: true,
        privacyNoticeAcknowledged: true,
        revision: onboarding.data?.draft?.revision ?? 0,
        clientMutationKey: requestId(),
        source: "web",
      }),
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["work-os", "employee-onboarding"] });
      await refresh();
    },
  });
  const changeConsent = useMutation({
    mutationFn: (action: "withdraw_tracking" | "withdraw_screenshot_analysis") => fetchJson("/api/work-os/me/onboarding", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, source: "web" }),
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["work-os", "employee-onboarding"] });
      await refresh();
    },
  });
  const sessionAction = useMutation({
    mutationFn: ({ method, body }: { method: "POST" | "PATCH"; body: AnyRow }) => fetchJson("/api/work-os/me/workday", {
      method,
      headers: { "Content-Type": "application/json", "Idempotency-Key": requestId() },
      body: JSON.stringify(body),
    }),
    onSuccess: refresh,
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
      body: JSON.stringify({
        url: goalLoomUrl.trim(),
        transcript: goalLoomTranscript.trim() || undefined,
        targetDate: selectedTaskDate || day.data?.shiftDate,
      }),
    }),
    onSuccess: (result) => {
      if (result.blocked) {
        setGoalLoomNote(`That recording is from ${result.temporal?.createdLocalDate ?? "another day"}, so it can't shape today's goal.`);
        return;
      }
      if (!result.analysis) {
        setGoalLoomNote("No transcript was supplied, so the recording could only be read for its title. Paste the transcript and analyze again.");
        return;
      }
      if (!goal.trim()) setGoal(result.analysis.summary);
      setGoalLoomNote(`Analyzed “${result.metadata?.title ?? "Loom recording"}”: ${result.analysis.summary}${result.analysis.suggestedTasks.length ? ` · ${result.analysis.suggestedTasks.length} suggested task${result.analysis.suggestedTasks.length === 1 ? "" : "s"} — describe them in your update to file them.` : ""}`);
    },
    onError: (error) => setGoalLoomNote(error instanceof Error ? error.message : "The recording could not be analyzed."),
  });
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
  const review = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: "accept" | "reject" }) => {
      const row = await fetchJson<{ outcome?: string; failure_reason?: string | null }>(`/api/work-os/proposals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Idempotency-Key": requestId() },
        body: JSON.stringify({ decision }),
      });
      // A 200 is not proof the decision landed: the proposal may be stale,
      // already decided in another window, or still applying.
      const expected = decision === "accept" ? "applied" : "rejected";
      if (row?.outcome && row.outcome !== expected) {
        throw new Error(row.failure_reason?.trim()
          || (row.outcome === "applying" ? "This action is still being applied. Recheck in a moment." : `This action could not be ${decision === "accept" ? "approved" : "rejected"}.`));
      }
      return row;
    },
    onSuccess: () => void refresh(),
  });
  const saveGoal = useMutation({
    mutationFn: () => fetchJson("/api/work-os/me/plan", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Idempotency-Key": requestId() },
      body: JSON.stringify({ shift_date: day.data?.shiftDate, revision: day.data?.workspaceSummary?.goal.revision ?? 0, freeform_intent: goal, focus_summary: null, goal_provenance: goal.trim() ? "employee" : null, suggestion_task_ids: [] }),
    }),
    onSuccess: refresh,
  });
  const changeTask = useMutation({
    mutationFn: ({ task, body, method = "PATCH", mode }: { task: AnyRow; body?: AnyRow; method?: "PATCH" | "DELETE"; mode?: "archive" | "delete" }) => fetchJson(`/api/work-os/me/tasks/${encodeURIComponent(String(task.provider_task_id || task.id))}${method === "DELETE" ? `?mode=${mode ?? "archive"}` : ""}`, {
      method, headers: { "Content-Type": "application/json", "Idempotency-Key": requestId() }, ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    onSuccess: () => { setTaskMenuId(null); setTaskEdit(null); void refresh(); },
  });
  const createTask = useMutation({
    mutationFn: () => fetchJson("/api/work-os/me/tasks", {
      method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": requestId() },
      body: JSON.stringify({ name: taskCreateTitle.trim(), description: taskCreateDescription.trim() || undefined }),
    }),
    onSuccess: () => { setTaskCreateOpen(false); setTaskCreateTitle(""); setTaskCreateDescription(""); void refresh(); },
  });
  const draftEod = useMutation({
    mutationFn: () => {
      if (!eodDay?.shiftDate) throw new Error("Load the day before drafting its EOD");
      return fetchJson("/api/work-os/reports/eod", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": requestId() },
        body: JSON.stringify({ date: eodDay.shiftDate }),
      });
    },
    onSuccess: () => void refresh(),
  });
  const submitEod = useMutation({
    mutationFn: () => {
      if (!eodReport?.id) throw new Error("Draft the EOD report before submitting it");
      return fetchJson(`/api/work-os/reports/${eodReport.id}/submit`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Idempotency-Key": requestId() },
        body: JSON.stringify({ markdown: reportMarkdown }),
      });
    },
    onSuccess: () => void refresh(),
  });
  const disputeEvidence = useMutation({
    mutationFn: (eventId: string) => fetchJson(`/api/work-os/evidence/${eventId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correction_status: "disputed", reason: "Employee disputed this evidence from My Day." }),
    }),
    onSuccess: refresh,
  });

  const historical = !!selectedTaskDate && selectedTaskDate !== day.data?.shiftDate;
  const eodDay = historical ? selectedDay.data ?? null : day.data ?? null;
  const eodReport = eodDay?.report ?? null;
  const eodPanelVisible = historical || day.data?.prompt.kind === "eod" || !!day.data?.report;
  useEffect(() => {
    setReportMarkdown(eodReport?.markdown ?? "");
  }, [eodReport?.id, eodReport?.markdown]);
  const displayedWorkspace = historical ? historicalWorkspace.data?.workspace : day.data?.workspaceSummary;
  const tasks = historical ? historicalWorkspace.data?.tasks ?? [] : day.data?.tasks ?? [];
  const proposals = day.data?.proposals ?? [];
  const evidence = day.data?.evidence ?? [];
  const timezone = day.data?.shift?.timezone;
  const workSession = day.data?.session;
  const sessionIsActive = !!workSession && !["scheduled", "clocked_out"].includes(String(workSession.state));
  const shiftStartsAt = day.data?.shift ? Date.parse(day.data.shift.startsAt) : Number.NaN;
  const shiftEndsAt = day.data?.shift ? Date.parse(day.data.shift.endsAt) : Number.NaN;
  const shiftStartable = Number.isFinite(shiftStartsAt) && Date.now() >= shiftStartsAt - 30 * 60_000 && Date.now() < shiftEndsAt;
  const organizationSetup = onboarding.data?.organizationSetup;
  const officialSchedule = organizationSetup?.officialSchedule;
  const officialScheduleLabel = officialSchedule
    ? `${officialSchedule.shiftStart}–${officialSchedule.shiftEnd} · ${officialSchedule.timezone}`
    : "Pending manager setup";
  const beginClockIn = () => {
    if (!shiftStartable) { setClockExceptionReason(""); setClockConfirmKind("exception"); return; }
    if (Date.now() > shiftStartsAt + 15 * 60_000) { setClockExceptionReason(""); setClockConfirmKind("late"); return; }
    sessionAction.mutate({ method: "POST", body: { source: "web" } });
  };
  const lateStartProlonged = clockConfirmKind === "late" && Number.isFinite(shiftStartsAt) && Date.now() >= shiftStartsAt + PROLONGED_ABSENCE_MINUTES * 60_000;
  const lateReasonMissing = !historical && lateReasonRequired(day.data?.session);
  const error = onboarding.error || saveOnboarding.error || changeConsent.error || day.error || sessionAction.error || checkIn.error || review.error || saveGoal.error || changeTask.error || createTask.error || draftEod.error || submitEod.error;

  return (
    <div className="min-h-[calc(100vh-8rem)] border" style={{ borderColor: "var(--border)", background: "var(--bg-primary)" }}>
      <header className="border-b px-5 py-4" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[12px] font-semibold uppercase text-[var(--text-tertiary)]">
              <CalendarClock size={15} /> {selectedTaskDate || day.data?.shiftDate || "My day"}
            </div>
            <h1 className="mt-1 text-xl font-semibold text-[var(--text-primary)]">My Day</h1>
          </div>
          <div className="flex items-center gap-3">
            <label className="grid gap-1 text-[9px] font-semibold uppercase text-[var(--text-tertiary)]">Task date<input type="date" value={selectedTaskDate || day.data?.shiftDate || ""} max={day.data?.shiftDate} onChange={(event) => setSelectedTaskDate(event.target.value)} className="border bg-transparent px-2 py-1 text-[11px] font-normal normal-case text-[var(--text-primary)]" style={{ borderColor: "var(--border)" }} /></label>
            {day.data?.shift ? (
              <div className="text-right text-[12px]">
                <p className="font-semibold text-[var(--text-primary)]">
                  {formatTime(day.data.shift.startsAt, timezone)} - {formatTime(day.data.shift.endsAt, timezone)}
                </p>
                <p className="text-[var(--text-tertiary)]">{timezone}</p>
              </div>
            ) : null}
            <EmployeeEodOutstandingBell
              days={outstanding.data?.days ?? []}
              loading={outstanding.isFetching && !outstanding.data}
              error={outstanding.error ? outstanding.error.message : null}
              open={eodListOpen}
              onToggle={() => { const next = !eodListOpen; setEodListOpen(next); if (next) void outstanding.refetch(); }}
              onClose={() => setEodListOpen(false)}
              onSelect={(selected: OutstandingEodDay) => { setEodListOpen(false); setSelectedTaskDate(selected.date); window.requestAnimationFrame(() => document.getElementById("employee-eod-panel")?.scrollIntoView({ behavior: "smooth", block: "start" })); }}
              onRetry={() => void outstanding.refetch()}
            />
            <button
              aria-label="Refresh My Day"
              title="Refresh My Day"
              onClick={() => void refresh()}
              className="grid size-9 place-items-center border text-[var(--text-secondary)]"
              style={{ borderColor: "var(--border)" }}
            >
              <RefreshCw size={15} className={day.isFetching ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1180px] gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="lg:col-span-2">
          <section className="border p-4" style={{ borderColor: onboarding.data?.onboardingRequired ? "var(--status-warn)" : "var(--border)", background: "var(--bg-card)" }}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold">{onboarding.data?.onboardingRequired ? "Complete your Work OS setup" : "Work OS privacy and setup"}</h2>
                <p className="mt-1 max-w-3xl text-[12px] leading-5 text-[var(--text-secondary)]">
                  Confirm your profile, working hours, notification preference, and purpose-limited tracking consent. Sampled Worktivity screenshot analysis is mandatory for this onboarding policy, excluded by app/domain policy, encrypted, retained for 30 days, and never proves productivity or task completion.
                </p>
              </div>
              <span className="border px-2 py-1 text-[10px] font-semibold uppercase text-[var(--text-tertiary)]" style={{ borderColor: "var(--border)" }}>
                {onboarding.data?.onboardingRequired ? "Action required" : "Configured"}
              </span>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <div className="border px-3 py-2" style={{ borderColor: "var(--border)" }}><span className="block text-[9px] font-semibold uppercase text-[var(--text-tertiary)]">Official role</span><strong className="mt-1 block text-[12px] font-medium">{organizationSetup?.roleProfile?.name || "Pending manager setup"}</strong></div>
              <div className="border px-3 py-2" style={{ borderColor: "var(--border)" }}><span className="block text-[9px] font-semibold uppercase text-[var(--text-tertiary)]">Team</span><strong className="mt-1 block text-[12px] font-medium">{organizationSetup?.teams?.map((team: AnyRow) => team.name).filter(Boolean).join(", ") || "Pending manager setup"}</strong></div>
              <div className="border px-3 py-2" style={{ borderColor: "var(--border)" }}><span className="block text-[9px] font-semibold uppercase text-[var(--text-tertiary)]">Manager</span><strong className="mt-1 block text-[12px] font-medium">{organizationSetup?.managers?.map((manager: AnyRow) => manager.display_name).filter(Boolean).join(", ") || "Pending manager setup"}</strong></div>
              <div className="border px-3 py-2" style={{ borderColor: "var(--border)" }}><span className="block text-[9px] font-semibold uppercase text-[var(--text-tertiary)]">Official schedule</span><strong className="mt-1 block text-[12px] font-medium">{officialScheduleLabel}</strong></div>
            </div>
            {onboarding.data?.onboardingRequired ? (
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <label className="grid gap-1 text-[11px] font-semibold uppercase text-[var(--text-tertiary)]">Preferred name<input value={onboardingName} onChange={(event) => setOnboardingName(event.target.value)} className="border bg-transparent px-3 py-2 text-[12px] font-normal normal-case text-[var(--text-primary)] outline-none" /></label>
                <label className="grid gap-1 text-[11px] font-semibold uppercase text-[var(--text-tertiary)]">Work email<input type="email" value={onboardingEmail} onChange={(event) => setOnboardingEmail(event.target.value)} className="border bg-transparent px-3 py-2 text-[12px] font-normal normal-case text-[var(--text-primary)] outline-none" /></label>
                <label className="grid gap-1 text-[11px] font-semibold uppercase text-[var(--text-tertiary)]">Timezone<input role="combobox" aria-autocomplete="list" list="employee-work-os-timezones" value={onboardingTimezone} onChange={(event) => setOnboardingTimezone(event.target.value)} placeholder="Search IANA timezone" className="border bg-transparent px-3 py-2 text-[12px] font-normal normal-case text-[var(--text-primary)] outline-none" /><datalist id="employee-work-os-timezones">{supportedTimezones().map((zone) => <option key={zone} value={zone}>{timezoneLabel(zone)}</option>)}</datalist></label>
                <label className="grid gap-1 text-[11px] font-semibold uppercase text-[var(--text-tertiary)]">Language<input value={onboardingLanguage} onChange={(event) => setOnboardingLanguage(event.target.value)} className="border bg-transparent px-3 py-2 text-[12px] font-normal normal-case text-[var(--text-primary)] outline-none" /></label>
                <label className="grid gap-1 text-[11px] font-semibold uppercase text-[var(--text-tertiary)]">Shift start<input type="time" value={onboardingStart} onChange={(event) => setOnboardingStart(event.target.value)} className="border bg-transparent px-3 py-2 text-[12px] font-normal normal-case text-[var(--text-primary)] outline-none" /></label>
                <label className="grid gap-1 text-[11px] font-semibold uppercase text-[var(--text-tertiary)]">Shift end<input type="time" value={onboardingEnd} onChange={(event) => setOnboardingEnd(event.target.value)} className="border bg-transparent px-3 py-2 text-[12px] font-normal normal-case text-[var(--text-primary)] outline-none" /></label>
                {!onboarding.data?.breakPolicy?.worktivityAuthoritative && <><label className="grid gap-1 text-[11px] font-semibold uppercase text-[var(--text-tertiary)]">Break start<input type="time" value={onboardingBreakStart} onChange={(event) => setOnboardingBreakStart(event.target.value)} className="border bg-transparent px-3 py-2 text-[12px] font-normal normal-case text-[var(--text-primary)] outline-none" /></label>
                <label className="grid gap-1 text-[11px] font-semibold uppercase text-[var(--text-tertiary)]">Break end<input type="time" value={onboardingBreakEnd} onChange={(event) => setOnboardingBreakEnd(event.target.value)} className="border bg-transparent px-3 py-2 text-[12px] font-normal normal-case text-[var(--text-primary)] outline-none" /></label></>}
                <label className="flex items-center gap-2 border px-3 py-2 text-[12px] text-[var(--text-secondary)]"><input type="checkbox" checked={onboardingDesktop} onChange={(event) => setOnboardingDesktop(event.target.checked)} /> Desktop notifications</label>
                <label className="flex items-center gap-2 border px-3 py-2 text-[12px] text-[var(--text-secondary)]"><input type="checkbox" checked={onboardingConsent} onChange={(event) => setOnboardingConsent(event.target.checked)} /> I accept Work OS tracking and sampled screenshot analysis, including encrypted 30-day raw retention, sensitive-capture deletion, and that screenshots do not prove productivity or task completion.</label>
                <label className="grid gap-1 text-[11px] font-semibold uppercase text-[var(--text-tertiary)] md:col-span-2">Sensitive apps/domains to exclude<input value={onboardingExclusions} onChange={(event) => setOnboardingExclusions(event.target.value)} placeholder="password manager, bank.example" className="border bg-transparent px-3 py-2 text-[12px] font-normal normal-case text-[var(--text-primary)] outline-none" /></label>
                <div className="flex items-end md:col-span-2 xl:col-span-1"><button disabled={!onboardingName.trim() || !onboardingEmail.trim() || !onboardingConsent || saveOnboarding.isPending} onClick={() => saveOnboarding.mutate()} className="w-full px-3 py-2 text-[12px] font-semibold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--text-inverse)" }}>{saveOnboarding.isPending ? "Saving..." : "Save required consent"}</button></div>
              </div>
            ) : (
              <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                <span>Tracking consent is active.</span>
                <span>Required Work OS and screenshot-analysis consent is active.</span>
                <button disabled={changeConsent.isPending} onClick={() => changeConsent.mutate("withdraw_screenshot_analysis")} className="border px-2 py-1 text-[11px] font-semibold text-[var(--status-warn)]" style={{ borderColor: "var(--status-warn)" }}>Withdraw required screenshot consent</button>
                <button disabled={changeConsent.isPending} onClick={() => changeConsent.mutate("withdraw_tracking")} className="border px-2 py-1 text-[11px] font-semibold text-[var(--status-err)]" style={{ borderColor: "var(--status-err)" }}>Withdraw tracking consent</button>
              </div>
            )}
          </section>
        </div>
        <div className="space-y-5">
          <section className="border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold"><Clock3 size={16} style={{ color: "var(--accent)" }} /> Workday session</h2>
                <p className="mt-1 text-[12px] text-[var(--text-secondary)]">{workSession ? `State: ${operationLabel(workSession.state)}` : "No Work OS session is active."}</p>
                {day.data?.attendance?.message ? <p className="mt-2 text-[11px] leading-5 text-[var(--text-tertiary)]">Observed context only: {day.data.attendance.message}</p> : null}
              </div>
              <span className="border px-2 py-1 text-[10px] font-semibold uppercase text-[var(--text-tertiary)]" style={{ borderColor: "var(--border)" }}>{sessionIsActive ? "Employee-owned" : "Clock-in required"}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {!sessionIsActive ? (
                <button disabled={sessionAction.isPending} onClick={beginClockIn} className="inline-flex items-center gap-2 px-3 py-2 text-[12px] font-semibold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--text-inverse)" }}><Check size={14} /> Clock in</button>
              ) : (
                <>
                  {!day.data?.breakPolicy?.worktivityAuthoritative && workSession?.state !== "eod_due" ? <button disabled={sessionAction.isPending} onClick={() => sessionAction.mutate({ method: "PATCH", body: { action: workSession?.state === "paused" ? "resume" : "pause" } })} className="inline-flex items-center gap-2 border px-3 py-2 text-[12px] font-semibold disabled:opacity-50" style={{ borderColor: "var(--border)" }}>{workSession?.state === "paused" ? "Resume" : "Pause"}</button> : null}
                  <button disabled={sessionAction.isPending} onClick={() => window.confirm("Clock out and close today’s workspace?") && sessionAction.mutate({ method: "PATCH", body: { action: "clock_out", extended_acknowledged: true } })} className="inline-flex items-center gap-2 border px-3 py-2 text-[12px] font-semibold text-[var(--status-warn)] disabled:opacity-50" style={{ borderColor: "var(--status-warn)" }}>Clock out</button>
                </>
              )}
            </div>
          </section>
          <section className="border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1"><h2 className="flex items-center gap-2 text-sm font-semibold"><ListTodo size={16} style={{ color: "var(--accent)" }} /> {historical ? `Workspace for ${selectedTaskDate}` : "Today’s workspace"}</h2><p className="mt-1 text-[11px] text-[var(--text-tertiary)]">Goal · {displayedWorkspace?.goal.provenance === "ai_draft" ? "drafted with Otto" : displayedWorkspace?.goal.provenance === "accepted_suggestion" ? "accepted suggestion" : goal.trim() ? "written by you" : "optional"}</p></div>
              <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full text-center text-[10px] font-semibold" style={{ background: `radial-gradient(circle at center, var(--bg-card) 56%, transparent 58%), conic-gradient(var(--accent) ${displayedWorkspace?.total ? displayedWorkspace.completed / displayedWorkspace.total * 360 : 0}deg, var(--border) 0deg)` }}><span>{displayedWorkspace?.completed ?? 0}<small className="block font-normal">of {displayedWorkspace?.total ?? tasks.length}</small></span></div>
            </div>
            <textarea value={goal} onChange={(event) => setGoal(event.target.value)} readOnly={historical} rows={2} maxLength={4000} placeholder="What will you do today?" className="mt-3 w-full resize-y border bg-transparent px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none" style={{ borderColor: "var(--border)" }} />
            <div className="mt-2 flex items-center justify-between gap-3"><span className="text-[11px] text-[var(--text-tertiary)]">{historical ? "Historical workspaces are read-only." : "Goal setting is independent of attendance."}</span>{!historical ? <button disabled={saveGoal.isPending || goal === (day.data?.workspaceSummary?.goal.text ?? day.data?.plan?.freeform_intent ?? "")} onClick={() => saveGoal.mutate()} className="border px-3 py-1.5 text-[11px] font-semibold disabled:opacity-50" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>{saveGoal.isPending ? "Saving…" : "Update goal"}</button> : null}</div>
            {!historical && day.data?.access?.featureFlags?.loom_updates === true ? <div className="mt-3 border px-3 py-3" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase text-[var(--text-tertiary)]">Recorded a Loom for today?</span>
                <button type="button" className="text-[11px] font-semibold text-[var(--accent)]" onClick={() => { setGoalLoomOpen((value) => !value); setGoalLoomNote(null); }}>{goalLoomOpen ? "Close" : "Analyze a Loom"}</button>
              </div>
              {goalLoomOpen ? <>
                <div className="mt-2 flex flex-wrap items-start gap-2">
                  <input
                    value={goalLoomUrl}
                    onChange={(event) => { setGoalLoomUrl(event.target.value); setGoalLoomNote(null); goalLoom.reset(); }}
                    placeholder="https://www.loom.com/share/…"
                    className="min-w-[240px] flex-1 border bg-transparent px-3 py-2 text-[12px] text-[var(--text-primary)] outline-none"
                    style={{ borderColor: "var(--border)" }}
                    aria-label="Loom share link"
                  />
                  <button
                    type="button"
                    disabled={!goalLoomUrl.trim() || goalLoom.isPending}
                    onClick={() => goalLoom.mutate()}
                    className="inline-flex items-center gap-2 border px-3 py-2 text-[11px] font-semibold disabled:opacity-50"
                    style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
                  >
                    <Video size={13} /> {goalLoom.isPending ? "Analyzing…" : "Analyze"}
                  </button>
                </div>
                <details className="mt-2">
                  <summary className="cursor-pointer text-[11px] font-semibold text-[var(--text-tertiary)]">Paste transcript (optional)</summary>
                  <textarea
                    value={goalLoomTranscript}
                    onChange={(event) => setGoalLoomTranscript(event.target.value)}
                    rows={3}
                    maxLength={50000}
                    placeholder="In Loom open Transcript, then Copy — paste it here so the recording can shape the goal."
                    className="mt-2 w-full resize-y border bg-transparent px-3 py-2 text-[12px] leading-5 text-[var(--text-primary)] outline-none"
                    style={{ borderColor: "var(--border)" }}
                    aria-label="Loom transcript"
                  />
                </details>
                {goalLoomNote ? <p className="mt-2 text-[11px] leading-5 text-[var(--text-secondary)]">{goalLoomNote}</p> : null}
                <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">Analysis only fills the goal text for you to review and save. It files nothing and stores no video.</p>
              </> : null}
            </div> : null}
            {(displayedWorkspace?.overdueCount ?? 0) > 0 ? <p className="mt-3 text-[11px] text-[var(--status-warn)]">{displayedWorkspace?.overdueCount} overdue task{displayedWorkspace?.overdueCount === 1 ? "" : "s"} require review.</p> : null}
            {lateReasonMissing ? (
              <div className="mt-3 border px-3 py-3" style={{ borderColor: "var(--status-warn)" }} role="status" aria-live="polite">
                <p className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: "var(--status-warn)" }}><AlertTriangle size={14} /> Late start — add a reason</p>
                <p className="mt-1 text-[11px] leading-5 text-[var(--text-tertiary)]">Your workday began 30+ minutes after your scheduled start. Record the reason to clear the reminder and Otto’s red signal.</p>
                <div className="mt-2 flex items-start gap-2">
                  <textarea value={lateReasonDraft} onChange={(event) => setLateReasonDraft(event.target.value)} rows={2} maxLength={1000} className="w-full resize-y border bg-transparent px-3 py-2 text-[12px] text-[var(--text-primary)] outline-none" style={{ borderColor: "var(--border)" }} placeholder="Reason for the late start" />
                  <button disabled={!lateReasonDraft.trim() || sessionAction.isPending} onClick={() => sessionAction.mutate({ method: "PATCH", body: { action: "late_reason", reason: lateReasonDraft.trim() } }, { onSuccess: () => setLateReasonDraft("") })} className="shrink-0 border px-3 py-2 text-[11px] font-semibold disabled:opacity-50" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>{sessionAction.isPending ? "Saving…" : "Save reason"}</button>
                </div>
              </div>
            ) : null}
          </section>
          {day.data?.niftySync?.error ? <div className="border px-3 py-2 text-[12px] text-[var(--status-warn)]" style={{ borderColor: "var(--status-warn)" }}>Nifty sync failed: {day.data.niftySync.error}</div> : null}
          <section className="border p-4" style={{ borderColor: day.data?.prompt.required ? "var(--status-warn)" : "var(--border)", background: "var(--bg-card)" }}>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                  <MessageSquareText size={16} style={{ color: "var(--accent)" }} />
                  {day.data?.prompt.kind === "catch_up" ? "Shift check-in" : day.data?.prompt.kind === "eod" ? "End-of-day update" : "What are you working on?"}
                </h2>
                <p className="mt-1 text-[12px] text-[var(--text-tertiary)]">{day.data?.prompt.reason || "Add an update whenever your plan changes."}</p>
              </div>
              {day.data?.prompt.required ? (
                <span className="border px-2 py-1 text-[10px] font-semibold uppercase text-[var(--status-warn)]" style={{ borderColor: "var(--status-warn)" }}>Required</span>
              ) : null}
            </div>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              rows={4}
              placeholder="Describe what you plan to do, progress made, blockers, or completed work."
              className="w-full resize-y border bg-transparent px-3 py-2 text-[13px] leading-6 text-[var(--text-primary)] outline-none"
              style={{ borderColor: "var(--border)" }}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                disabled={!input.trim() || checkIn.isPending}
                onClick={() => checkIn.mutate({ input_text: input })}
                className="inline-flex items-center gap-2 px-3 py-2 text-[12px] font-semibold disabled:opacity-50"
                style={{ background: "var(--accent)", color: "var(--text-inverse)" }}
              >
                <Send size={14} /> Send update
              </button>
              <button
                disabled={checkIn.isPending}
                onClick={() => checkIn.mutate({ snoozed_until: new Date(Date.now() + 30 * 60_000).toISOString() })}
                className="ml-auto inline-flex items-center gap-2 border px-3 py-2 text-[12px] text-[var(--text-tertiary)] disabled:opacity-50"
                style={{ borderColor: "var(--border)" }}
              >
                <TimerReset size={14} /> 30 min
              </button>
            </div>
          </section>


          {eodPanelVisible ? (
            <section id="employee-eod-panel" className="border" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
                <div>
                  <h2 className="flex items-center gap-2 text-sm font-semibold"><FileCheck2 size={16} style={{ color: "var(--accent)" }} /> EOD report</h2>
                  {historical ? <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">Drafting for {calendarDateLabel(selectedTaskDate)}. <button type="button" className="font-semibold underline" onClick={() => setSelectedTaskDate(day.data?.shiftDate ?? "")}>Back to today</button></p> : null}
                </div>
                <span className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">{eodReport?.status || (historical && selectedDay.isLoading ? "Loading" : "Not drafted")}</span>
              </div>
              {historical && selectedDay.isLoading && !selectedDay.data ? <p className="px-4 py-4 text-[12px] text-[var(--text-tertiary)]">Loading that day’s record…</p>
                : historical && selectedDay.error && !selectedDay.data ? <div className="flex flex-wrap items-center gap-3 px-4 py-4 text-[12px] text-[var(--status-warn)]"><span>That day could not be loaded.</span><button type="button" className="border px-2.5 py-1.5 text-[11px] font-semibold text-[var(--text-primary)]" style={{ borderColor: "var(--border)" }} onClick={() => void selectedDay.refetch()}>Try again</button></div>
                  : eodReport ? (
                    <>
                      <textarea
                        value={reportMarkdown}
                        onChange={(event) => setReportMarkdown(event.target.value)}
                        rows={16}
                        className="w-full resize-y border-0 bg-transparent px-4 py-3 font-mono text-[12px] leading-5 text-[var(--text-primary)] outline-none"
                        disabled={eodReport.status === "pending_review" || eodReport.status === "approved"}
                      />
                      <div className="flex flex-wrap items-center justify-between gap-3 border-t p-3" style={{ borderColor: "var(--border)" }}>
                        <span className="text-[11px] text-[var(--text-tertiary)]">{eodReport.status === "pending_review" ? "Submitted — waiting for review." : eodReport.status === "approved" ? "Approved." : eodReport.status === "rejected" ? "Changes were requested. Update the report and resubmit it." : "Nothing is filed until you submit."}</span>
                        <button
                          disabled={!reportMarkdown.trim() || eodReport.status === "pending_review" || eodReport.status === "approved" || submitEod.isPending}
                          onClick={() => submitEod.mutate()}
                          className="inline-flex items-center gap-2 px-3 py-2 text-[12px] font-semibold disabled:opacity-50"
                          style={{ background: "var(--accent)", color: "var(--text-inverse)" }}
                        >
                          <Send size={14} /> Submit for review
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="p-4">
                      <button onClick={() => draftEod.mutate()} disabled={draftEod.isPending || (historical && !selectedDay.data)} className="inline-flex items-center gap-2 border px-3 py-2 text-[12px] font-semibold disabled:opacity-50" style={{ borderColor: "var(--border)" }}>
                        <FileCheck2 size={14} /> {historical ? `Draft EOD for ${calendarDateLabel(selectedTaskDate)}` : "Draft EOD"}
                      </button>
                    </div>
                  )}
            </section>
          ) : null}
          {proposals.length ? (
            <section className="border" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
              <div className="border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
                <h2 className="flex items-center gap-2 text-sm font-semibold"><FileCheck2 size={16} style={{ color: "var(--accent)" }} /> Review proposed changes</h2>
              </div>
              <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                {proposals.map((proposal) => (
                  <article key={proposal.id} className="flex flex-wrap items-start gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold uppercase text-[var(--text-tertiary)]">{operationLabel(proposal.operation)}</p>
                      <p className="mt-1 text-[13px] font-medium text-[var(--text-primary)]">{proposal.task?.title || proposal.before_state?.title || proposalSummary(proposal)}</p>
                      {proposal.task?.title || proposal.before_state?.title ? <p className="mt-1 text-[12px] text-[var(--text-secondary)]">{proposalSummary(proposal)}</p> : null}
                      {proposal.failure_reason ? <p className="mt-2 text-[12px] text-[var(--status-warn)]">{proposal.failure_reason}</p> : null}
                    </div>
                    <div className="flex gap-2">
                      <button aria-label="Reject proposal" title="Reject" onClick={() => review.mutate({ id: proposal.id, decision: "reject" })} className="grid size-9 place-items-center border text-[var(--text-tertiary)]" style={{ borderColor: "var(--border)" }}><X size={15} /></button>
                      {proposal.status !== "stale" ? <button aria-label="Accept proposal" title="Accept" onClick={() => review.mutate({ id: proposal.id, decision: "accept" })} className="grid size-9 place-items-center bg-[var(--accent)] text-[var(--text-inverse)]"><Check size={15} /></button> : null}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <section className="border" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
            <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
              <h2 className="flex items-center gap-2 text-sm font-semibold"><ListTodo size={16} style={{ color: "var(--accent)" }} /> {historical ? `Tasks for ${selectedTaskDate}` : "Today’s tasks"}</h2>
              <div className="flex items-center gap-2"><span className="text-[12px] text-[var(--text-tertiary)]">{tasks.length}</span>{!historical ? <button onClick={() => setTaskCreateOpen(true)} className="border px-2 py-1 text-[11px] font-semibold" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>Add task</button> : null}</div>
            </div>
            {tasks.length ? tasks.map((task) => {
              const taskId = String(task.provider_task_id || task.id);
              const subtasks = historical ? [] : Array.isArray(task.subtasks) ? task.subtasks : [];
              const progress = task.subtaskProgress ?? { completed: subtasks.filter((item: AnyRow) => item.completed).length, total: subtasks.length };
              return <article key={task.id} className="relative border-b px-4 py-3 last:border-b-0" style={{ borderColor: "var(--border)" }}>
                <div className="flex items-start gap-3"><button aria-label={`${expandedTaskId === taskId ? "Collapse" : "Expand"} ${task.title}`} onClick={() => setExpandedTaskId(expandedTaskId === taskId ? null : taskId)} className="mt-0.5 text-[var(--text-tertiary)]">{expandedTaskId === taskId ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button><div className="min-w-0 flex-1"><p className={`text-[13px] font-medium ${task.completed ? "line-through text-[var(--text-tertiary)]" : "text-[var(--text-primary)]"}`}>{task.title}</p><TaskAssigneeTags task={task} /><div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--text-tertiary)]">{task.project?.name ? <span>{task.project.name}</span> : null}{task.milestone?.name ? <span>{task.milestone.name}</span> : null}{task.priority ? <span>{operationLabel(task.priority)}</span> : null}{task.due_date ? <span>Due {task.due_date}</span> : null}<span>{String(task.provider ?? "") === "local" ? "Work OS task" : task.synced_at ? "Nifty synced" : "Sync pending"}</span></div></div>
                  {progress.total > 0 ? <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[9px] font-semibold" style={{ background: `radial-gradient(circle at center, var(--bg-card) 55%, transparent 57%), conic-gradient(var(--accent) ${progress.completed / progress.total * 360}deg, var(--border) 0deg)` }}>{progress.completed}/{progress.total}</div> : null}
                  {!historical ? <button aria-label={`Actions for ${task.title}`} onClick={() => setTaskMenuId(taskMenuId === taskId ? null : taskId)} className="border p-1.5" style={{ borderColor: "var(--border)" }}><MoreHorizontal size={15} /></button> : String(task.provider ?? "") === "local" ? <span className="text-[10px] text-[var(--text-tertiary)]">Work OS record</span> : <a href={String(task.url || task.provider_url || task.raw?.url || "#")} target="_blank" rel="noreferrer" className="text-[10px] font-semibold text-[var(--accent)]">Open Nifty</a>}
                  {!historical && taskMenuId === taskId ? <div className="absolute right-4 top-11 z-10 grid min-w-48 border p-1 text-[11px] shadow-lg" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}><button className="flex items-center gap-2 px-2 py-1.5 text-left" onClick={() => changeTask.mutate({ task, body: { completed: !task.completed } })}>{task.completed ? <RotateCcw size={13} /> : <Check size={13} />}{task.completed ? "Reopen" : "Mark done"}</button><button className="flex items-center gap-2 px-2 py-1.5 text-left" onClick={() => { setTaskEdit(task); setTaskEditTitle(task.title || ""); setTaskEditDescription(task.description || ""); setTaskMenuId(null); }}><Pencil size={13} /> Edit</button><button className="flex items-center gap-2 px-2 py-1.5 text-left" onClick={() => window.confirm(String(task.provider ?? "") === "local" ? "Archive this task? It will be hidden from active work but retained in Work OS history." : "Archive this task? It will be hidden from active work but retained and restorable in Nifty.") && changeTask.mutate({ task, method: "DELETE", mode: "archive" })}><Archive size={13} /> Archive (reversible)</button><button className="flex items-center gap-2 px-2 py-1.5 text-left text-[var(--status-warn)]" onClick={() => window.confirm(String(task.provider ?? "") === "local" ? "Permanently delete this task from Work OS? This cannot be undone." : "Permanently delete this task from Nifty? This cannot be undone.") && changeTask.mutate({ task, method: "DELETE", mode: "delete" })}><Trash2 size={13} /> Delete permanently</button></div> : null}
                </div>
{expandedTaskId === taskId ? <div className="ml-7 mt-3 border-t pt-2" style={{ borderColor: "var(--border)" }}>{subtasks.length ? subtasks.map((subtask: AnyRow) => { const subtaskId = String(subtask.provider_task_id || subtask.id); return <div key={subtask.id} className="relative flex items-center gap-2 py-1.5 text-[11px]"><CircleDot size={12} /><div className="min-w-0 flex-1"><span className={subtask.completed ? "line-through text-[var(--text-tertiary)]" : ""}>{subtask.title}</span><TaskAssigneeTags task={subtask} /></div><button aria-label={`Actions for ${subtask.title}`} onClick={() => setSubtaskMenuId(subtaskMenuId === subtaskId ? null : subtaskId)} className="border p-1.5" style={{ borderColor: "var(--border)" }}><MoreHorizontal size={13} /></button>{subtaskMenuId === subtaskId ? <div className="absolute right-0 top-8 z-20 grid min-w-48 border p-1 shadow-lg" role="menu" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}><button role="menuitem" className="flex items-center gap-2 px-2 py-1.5 text-left" onClick={() => changeTask.mutate({ task: subtask, body: { completed: !subtask.completed } })}>{subtask.completed ? <RotateCcw size={13} /> : <Check size={13} />}{subtask.completed ? "Reopen" : "Mark done"}</button><button role="menuitem" className="flex items-center gap-2 px-2 py-1.5 text-left" onClick={() => { setTaskEdit(subtask); setTaskEditTitle(subtask.title || ""); setTaskEditDescription(subtask.description || ""); setSubtaskMenuId(null); }}><Pencil size={13} /> Edit</button><label className="grid gap-1 border-t px-2 py-1.5 text-[10px] text-[var(--text-tertiary)]" style={{ borderColor: "var(--border)" }}>Move to parent<select aria-label={`Move ${subtask.title}`} value="" onChange={(event) => event.target.value && changeTask.mutate({ task: subtask, body: { parent_task_id: event.target.value } })}><option value="">Choose…</option>{tasks.filter((target) => target.id !== task.id && !target.completed).map((target) => <option key={target.id} value={target.provider_task_id || target.id}>{target.title}</option>)}</select></label><button role="menuitem" className="flex items-center gap-2 px-2 py-1.5 text-left" onClick={() => window.confirm(String(subtask.provider ?? "") === "local" ? "Archive this subtask? It will be hidden but retained in Work OS history." : "Archive this subtask? It will be hidden but retained and restorable in Nifty.") && changeTask.mutate({ task: subtask, method: "DELETE", mode: "archive" })}><Archive size={13} /> Archive (reversible)</button><button role="menuitem" className="flex items-center gap-2 px-2 py-1.5 text-left text-[var(--status-warn)]" onClick={() => window.confirm(String(subtask.provider ?? "") === "local" ? "Permanently delete this subtask from Work OS? This cannot be undone." : "Permanently delete this subtask from Nifty? This cannot be undone.") && changeTask.mutate({ task: subtask, method: "DELETE", mode: "delete" })}><Trash2 size={13} /> Delete permanently</button></div> : null}</div>; }) : <p className="py-2 text-[11px] text-[var(--text-tertiary)]">No subtasks.</p>}</div> : null}
              </article>;
            }) : <p className="p-4 text-[12px] text-[var(--text-tertiary)]">No tasks are attributed to today.</p>}
          </section>
        </div>

        <aside className="space-y-5">
          <section className="border" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
            <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
              <h2 className="flex items-center gap-2 text-sm font-semibold"><Clock3 size={16} style={{ color: "var(--accent)" }} /> Evidence</h2>
              <button onClick={() => setExpandedEvidence((value) => !value)} className="text-[11px] font-semibold text-[var(--accent)]">{expandedEvidence ? "Collapse" : "View all"}</button>
            </div>
            <div className="divide-y" style={{ borderColor: "var(--border)" }}>
              {(expandedEvidence ? evidence : evidence.slice(0, 5)).map((item) => (
                <div key={item.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[12px] font-medium text-[var(--text-primary)]">{item.title}</p>
                    <span className="text-[10px] uppercase text-[var(--text-tertiary)]">{item.source === "loom" ? "Loom recording" : item.source}</span>
                  </div>
                  {item.summary ? <p className="mt-1 text-[11px] leading-5 text-[var(--text-secondary)]">{item.summary}</p> : null}
                  {item.source === "loom" && item.url ? <a href={String(item.url)} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[10px] font-semibold text-[var(--accent)]">Open recording</a> : null}
                  {item.evidence_event_id && item.event?.correction_status !== "disputed" ? <button disabled={disputeEvidence.isPending} onClick={() => disputeEvidence.mutate(item.evidence_event_id)} className="mt-2 text-[10px] font-semibold text-[var(--status-warn)] disabled:opacity-50">Dispute</button> : null}
                  {item.event?.correction_status === "disputed" ? <span className="mt-2 block text-[10px] font-semibold uppercase text-[var(--status-warn)]">Disputed</span> : null}
                </div>
              ))}
              {!evidence.length ? <p className="p-4 text-[12px] text-[var(--text-tertiary)]">No evidence recorded for this shift date.</p> : null}
            </div>
          </section>

          <section className="border p-4" style={{ borderColor: insights.data?.freshness.stale ? "var(--status-warn)" : "var(--border)", background: "var(--bg-card)" }}>
            <div className="flex items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-sm font-semibold"><FileCheck2 size={16} style={{ color: "var(--accent)" }} /> Insights</h2><p className="mt-1 text-[11px] text-[var(--text-tertiary)]">Shared daily-workspace record · no productivity score</p></div><select aria-label="Insights range" value={insightRange} onChange={(event) => setInsightRange(event.target.value as typeof insightRange)} className="border bg-transparent px-2 py-1 text-[10px]" style={{ borderColor: "var(--border)" }}><option value="day">Day</option><option value="7d">7 days</option><option value="30d">30 days</option></select></div>
            {insights.data?.freshness.stale ? <p className="mt-3 border px-2 py-1.5 text-[10px] text-[var(--status-warn)]" style={{ borderColor: "var(--status-warn)" }}>Retained data is stale{insights.data.freshness.staleAt ? ` since ${new Date(insights.data.freshness.staleAt).toLocaleString()}` : ""}. {insights.data.freshness.error || "Refresh is pending."}</p> : null}
            <p className="mt-3 text-[12px] leading-5 text-[var(--text-secondary)]">{insights.isLoading ? "Loading insights…" : insights.data?.brief.summary || "No insight record is available."}</p>
            <div className="mt-3 grid gap-2">{insights.data?.days.slice(-7).reverse().map((item) => <article key={item.date} className="border p-2 text-[10px]" style={{ borderColor: "var(--border)" }}><button className="font-semibold text-[var(--accent)]" onClick={() => setSelectedTaskDate(item.date)}>{item.date}</button><p className="mt-1 text-[var(--text-secondary)]">{item.completed} completed · {item.progressed} progressed · {item.deferred} deferred · {item.carried} carried · {item.unplanned} unplanned</p>{item.goal.text ? <p className="mt-1">Goal: {item.goal.text}</p> : null}{item.sessionQuality.message ? <p className="mt-1 text-[var(--status-warn)]">{item.sessionQuality.message}</p> : null}<div className="mt-1 flex flex-wrap gap-2">{item.references.slice(0, 3).map((reference) => <a key={reference.id} href={reference.target} className="text-[var(--accent)]">{reference.label}</a>)}</div></article>)}</div>
          </section>

          <section className="border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
            <h2 className="flex items-center gap-2 text-sm font-semibold"><Clock3 size={16} style={{ color: "var(--accent)" }} /> Next check-in</h2>
            <p className="mt-3 text-lg font-semibold text-[var(--text-primary)]">{formatTime(day.data?.prompt.nextPromptAt, timezone)}</p>
            <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">{day.data?.prompt.required ? "Response required" : "Quiet notification"}</p>
          </section>
        </aside>
      </main>

      {taskEdit ? <div className="fixed inset-0 z-40 grid place-items-center bg-black/50 p-4"><section className="w-full max-w-lg border p-4 shadow-xl" role="dialog" aria-modal="true" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}><div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Edit {taskEdit && String(taskEdit.provider ?? "") === "local" ? "Work OS" : "Nifty"} task</h2><button aria-label="Close" onClick={() => setTaskEdit(null)}><X size={16} /></button></div><label className="mt-4 block text-[11px] text-[var(--text-secondary)]">Title<input autoFocus value={taskEditTitle} onChange={(event) => setTaskEditTitle(event.target.value)} className="mt-1 w-full border bg-transparent px-3 py-2 text-[13px]" style={{ borderColor: "var(--border)" }} /></label><label className="mt-3 block text-[11px] text-[var(--text-secondary)]">Description<textarea value={taskEditDescription} onChange={(event) => setTaskEditDescription(event.target.value)} rows={5} className="mt-1 w-full border bg-transparent px-3 py-2 text-[13px]" style={{ borderColor: "var(--border)" }} /></label><div className="mt-4 flex justify-end gap-2"><button onClick={() => setTaskEdit(null)} className="border px-3 py-2 text-[11px]" style={{ borderColor: "var(--border)" }}>Cancel</button><button disabled={!taskEditTitle.trim() || changeTask.isPending} onClick={() => changeTask.mutate({ task: taskEdit, body: { name: taskEditTitle.trim(), description: taskEditDescription } })} className="px-3 py-2 text-[11px] font-semibold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--text-inverse)" }}>Save changes</button></div></section></div> : null}
      {taskCreateOpen ? <div className="fixed inset-0 z-40 grid place-items-center bg-black/50 p-4"><section className="w-full max-w-lg border p-4 shadow-xl" role="dialog" aria-modal="true" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}><div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Create Nifty task</h2><button aria-label="Close" onClick={() => setTaskCreateOpen(false)}><X size={16} /></button></div><label className="mt-4 block text-[11px] text-[var(--text-secondary)]">Title<input autoFocus value={taskCreateTitle} onChange={(event) => setTaskCreateTitle(event.target.value)} className="mt-1 w-full border bg-transparent px-3 py-2 text-[13px]" style={{ borderColor: "var(--border)" }} /></label><label className="mt-3 block text-[11px] text-[var(--text-secondary)]">Description<textarea value={taskCreateDescription} onChange={(event) => setTaskCreateDescription(event.target.value)} rows={5} className="mt-1 w-full border bg-transparent px-3 py-2 text-[13px]" style={{ borderColor: "var(--border)" }} /></label><div className="mt-4 flex justify-end gap-2"><button onClick={() => setTaskCreateOpen(false)} className="border px-3 py-2 text-[11px]" style={{ borderColor: "var(--border)" }}>Cancel</button><button disabled={!taskCreateTitle.trim() || createTask.isPending} onClick={() => createTask.mutate()} className="px-3 py-2 text-[11px] font-semibold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--text-inverse)" }}>Create task</button></div></section></div> : null}
      {clockConfirmKind ? <div className="fixed inset-0 z-40 grid place-items-center bg-black/50 p-4"><section className="w-full max-w-md border p-4 shadow-xl" role="alertdialog" aria-modal="true" style={{ borderColor: "var(--status-warn)", background: "var(--bg-card)" }}><h2 className="text-sm font-semibold">{clockConfirmKind === "late" ? "Confirm late start" : "Confirm exception start"}</h2><p className="mt-2 text-[12px] leading-5 text-[var(--text-secondary)]">{clockConfirmKind === "late" ? lateStartProlonged ? "This start is 30+ minutes after your scheduled time. Add the reason now, or from the reminder in your workspace." : "This start is after the scheduled time. Your acknowledgement will be audited." : "No shift is startable now. Explain why you are starting an exception workday."}</p>{clockConfirmKind === "exception" || lateStartProlonged ? <textarea autoFocus value={clockExceptionReason ?? ""} onChange={(event) => setClockExceptionReason(event.target.value)} rows={3} className="mt-3 w-full border bg-transparent px-3 py-2 text-[12px]" style={{ borderColor: "var(--border)" }} placeholder={clockConfirmKind === "late" ? "Reason for the late start (optional)" : "Exception reason"} /> : null}<div className="mt-4 flex justify-end gap-2"><button onClick={() => { setClockConfirmKind(null); setClockExceptionReason(null); }} className="border px-3 py-2 text-[11px]" style={{ borderColor: "var(--border)" }}>Cancel</button><button disabled={sessionAction.isPending || (clockConfirmKind === "exception" && !clockExceptionReason?.trim())} onClick={() => { sessionAction.mutate({ method: "POST", body: clockConfirmKind === "late" ? { source: "web", late_acknowledged: true, late_reason: clockExceptionReason?.trim() || undefined } : { source: "web", exception_acknowledged: true, exception_reason: clockExceptionReason?.trim() } }); setClockConfirmKind(null); setClockExceptionReason(null); }} className="px-3 py-2 text-[11px] font-semibold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--text-inverse)" }}>Confirm clock-in</button></div></section></div> : null}

      {error ? (
        <div className="fixed bottom-5 right-5 flex max-w-md items-start gap-2 border px-4 py-3 text-[12px] text-[var(--status-err)] shadow-lg" style={{ borderColor: "var(--status-err)", background: "var(--bg-card)" }}>
          <AlertCircle size={16} className="mt-0.5 shrink-0" /> {(error as Error).message}
        </div>
      ) : null}
    </div>
  );
}
