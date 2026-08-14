"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CalendarClock,
  Check,
  CircleDot,
  Clock3,
  FileCheck2,
  ListTodo,
  MessageSquareText,
  RefreshCw,
  Send,
  TimerReset,
  X,
} from "lucide-react";

type AnyRow = Record<string, any>;

interface DayResponse {
  at: string;
  shiftDate: string;
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
  plan: { id: string; status: "draft" | "confirmed" | "closed"; freeform_intent: string | null; items: AnyRow[] } | null;
  attendance?: AnyRow;
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
  const [expandedEvidence, setExpandedEvidence] = useState(false);
  const [reportMarkdown, setReportMarkdown] = useState("");
  const [onboardingName, setOnboardingName] = useState("");
  const [onboardingEmail, setOnboardingEmail] = useState("");
  const [onboardingTimezone, setOnboardingTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [onboardingLanguage, setOnboardingLanguage] = useState("en");
  const [onboardingStart, setOnboardingStart] = useState("09:00");
  const [onboardingEnd, setOnboardingEnd] = useState("17:00");
  const [onboardingBreakStart, setOnboardingBreakStart] = useState("");
  const [onboardingBreakEnd, setOnboardingBreakEnd] = useState("");
  const [onboardingDesktop, setOnboardingDesktop] = useState(true);
  const [onboardingScreenshot, setOnboardingScreenshot] = useState(false);
  const [onboardingExclusions, setOnboardingExclusions] = useState("");
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

  useEffect(() => {
    setReportMarkdown(day.data?.report?.markdown ?? "");
  }, [day.data?.report?.id, day.data?.report?.markdown]);

  useEffect(() => {
    const profile = onboarding.data?.profile;
    if (!profile) return;
    setOnboardingName((value) => value || profile.displayName || "");
    setOnboardingEmail((value) => value || profile.email || "");
    setOnboardingTimezone((value) => value || profile.timezone || "UTC");
    setOnboardingLanguage((value) => value || profile.language || "en");
    const schedule = profile.schedule || {};
    setOnboardingStart((value) => value === "09:00" && schedule.shiftStart ? schedule.shiftStart : value);
    setOnboardingEnd((value) => value === "17:00" && schedule.shiftEnd ? schedule.shiftEnd : value);
    const firstBreak = Array.isArray(schedule.breaks) ? schedule.breaks[0] : null;
    setOnboardingBreakStart((value) => value || firstBreak?.start || "");
    setOnboardingBreakEnd((value) => value || firstBreak?.end || "");
    setOnboardingDesktop(typeof profile.notifications?.desktopEnabled === "boolean" ? profile.notifications.desktopEnabled : true);
    setOnboardingScreenshot(profile.privacy?.screenshotAnalysisConsent === true);
    setOnboardingExclusions((value) => value || (profile.privacy?.sensitiveAppExclusions ?? []).join(", "));
  }, [onboarding.data]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["work-os", "my-day"] });
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
          screenshotAnalysisConsent: onboardingScreenshot,
          sensitiveAppExclusions: onboardingExclusions.split(",").map((value) => value.trim()).filter(Boolean),
        },
        acceptTrackingConsent: true,
        privacyNoticeAcknowledged: true,
        source: "web",
      }),
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["work-os", "employee-onboarding"] });
      await refresh();
    },
  });
  const changeConsent = useMutation({
    mutationFn: (action: "withdraw_tracking" | "withdraw_screenshot_analysis" | "accept_screenshot_analysis") => fetchJson("/api/work-os/me/onboarding", {
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
    mutationFn: ({ id, decision }: { id: string; decision: "accept" | "reject" }) => fetchJson(`/api/work-os/proposals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Idempotency-Key": requestId() },
      body: JSON.stringify({ decision }),
    }),
    onSuccess: () => void refresh(),
  });
  const proposeRemoval = useMutation({
    mutationFn: ({ planItemId, reason }: { planItemId: string; reason: string }) => fetchJson("/api/work-os/me/plan/removals", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": requestId() },
      body: JSON.stringify({ plan_item_id: planItemId, reason }),
    }),
    onSuccess: refresh,
  });
  const draftEod = useMutation({
    mutationFn: () => fetchJson("/api/work-os/reports/eod", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": requestId() },
      body: JSON.stringify({ date: day.data?.shiftDate }),
    }),
    onSuccess: () => void refresh(),
  });
  const submitEod = useMutation({
    mutationFn: () => {
      if (!day.data?.report?.id) throw new Error("Draft the EOD report before submitting it");
      return fetchJson(`/api/work-os/reports/${day.data.report.id}/submit`, {
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

  const tasks = day.data?.tasks ?? [];
  const proposals = day.data?.proposals ?? [];
  const evidence = day.data?.evidence ?? [];
  const timezone = day.data?.shift?.timezone;
  const workSession = day.data?.session;
  const sessionIsActive = !!workSession && !["scheduled", "clocked_out"].includes(String(workSession.state));
  const error = onboarding.error || saveOnboarding.error || changeConsent.error || day.error || sessionAction.error || checkIn.error || review.error || proposeRemoval.error || draftEod.error || submitEod.error;

  return (
    <div className="min-h-[calc(100vh-8rem)] border" style={{ borderColor: "var(--border)", background: "var(--bg-primary)" }}>
      <header className="border-b px-5 py-4" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[12px] font-semibold uppercase text-[var(--text-tertiary)]">
              <CalendarClock size={15} /> {day.data?.shiftDate || "My day"}
            </div>
            <h1 className="mt-1 text-xl font-semibold text-[var(--text-primary)]">My Day</h1>
          </div>
          <div className="flex items-center gap-3">
            {day.data?.shift ? (
              <div className="text-right text-[12px]">
                <p className="font-semibold text-[var(--text-primary)]">
                  {formatTime(day.data.shift.startsAt, timezone)} - {formatTime(day.data.shift.endsAt, timezone)}
                </p>
                <p className="text-[var(--text-tertiary)]">{timezone}</p>
              </div>
            ) : null}
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
                  Confirm your profile, working hours, notification preference, and purpose-limited tracking consent. Screenshots are optional, excluded by app/domain policy, encrypted, and retained for 30 days when enabled.
                </p>
              </div>
              <span className="border px-2 py-1 text-[10px] font-semibold uppercase text-[var(--text-tertiary)]" style={{ borderColor: "var(--border)" }}>
                {onboarding.data?.onboardingRequired ? "Action required" : "Configured"}
              </span>
            </div>
            {onboarding.data?.onboardingRequired ? (
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <label className="grid gap-1 text-[11px] font-semibold uppercase text-[var(--text-tertiary)]">Preferred name<input value={onboardingName} onChange={(event) => setOnboardingName(event.target.value)} className="border bg-transparent px-3 py-2 text-[12px] font-normal normal-case text-[var(--text-primary)] outline-none" /></label>
                <label className="grid gap-1 text-[11px] font-semibold uppercase text-[var(--text-tertiary)]">Work email<input type="email" value={onboardingEmail} onChange={(event) => setOnboardingEmail(event.target.value)} className="border bg-transparent px-3 py-2 text-[12px] font-normal normal-case text-[var(--text-primary)] outline-none" /></label>
                <label className="grid gap-1 text-[11px] font-semibold uppercase text-[var(--text-tertiary)]">Timezone<input value={onboardingTimezone} onChange={(event) => setOnboardingTimezone(event.target.value)} placeholder="America/New_York" className="border bg-transparent px-3 py-2 text-[12px] font-normal normal-case text-[var(--text-primary)] outline-none" /></label>
                <label className="grid gap-1 text-[11px] font-semibold uppercase text-[var(--text-tertiary)]">Language<input value={onboardingLanguage} onChange={(event) => setOnboardingLanguage(event.target.value)} className="border bg-transparent px-3 py-2 text-[12px] font-normal normal-case text-[var(--text-primary)] outline-none" /></label>
                <label className="grid gap-1 text-[11px] font-semibold uppercase text-[var(--text-tertiary)]">Shift start<input type="time" value={onboardingStart} onChange={(event) => setOnboardingStart(event.target.value)} className="border bg-transparent px-3 py-2 text-[12px] font-normal normal-case text-[var(--text-primary)] outline-none" /></label>
                <label className="grid gap-1 text-[11px] font-semibold uppercase text-[var(--text-tertiary)]">Shift end<input type="time" value={onboardingEnd} onChange={(event) => setOnboardingEnd(event.target.value)} className="border bg-transparent px-3 py-2 text-[12px] font-normal normal-case text-[var(--text-primary)] outline-none" /></label>
                <label className="grid gap-1 text-[11px] font-semibold uppercase text-[var(--text-tertiary)]">Break start<input type="time" value={onboardingBreakStart} onChange={(event) => setOnboardingBreakStart(event.target.value)} className="border bg-transparent px-3 py-2 text-[12px] font-normal normal-case text-[var(--text-primary)] outline-none" /></label>
                <label className="grid gap-1 text-[11px] font-semibold uppercase text-[var(--text-tertiary)]">Break end<input type="time" value={onboardingBreakEnd} onChange={(event) => setOnboardingBreakEnd(event.target.value)} className="border bg-transparent px-3 py-2 text-[12px] font-normal normal-case text-[var(--text-primary)] outline-none" /></label>
                <label className="flex items-center gap-2 border px-3 py-2 text-[12px] text-[var(--text-secondary)]"><input type="checkbox" checked={onboardingDesktop} onChange={(event) => setOnboardingDesktop(event.target.checked)} /> Desktop notifications</label>
                <label className="flex items-center gap-2 border px-3 py-2 text-[12px] text-[var(--text-secondary)]"><input type="checkbox" checked={onboardingScreenshot} onChange={(event) => setOnboardingScreenshot(event.target.checked)} /> Allow neutral screenshot summaries</label>
                <label className="grid gap-1 text-[11px] font-semibold uppercase text-[var(--text-tertiary)] md:col-span-2">Sensitive apps/domains to exclude<input value={onboardingExclusions} onChange={(event) => setOnboardingExclusions(event.target.value)} placeholder="password manager, bank.example" className="border bg-transparent px-3 py-2 text-[12px] font-normal normal-case text-[var(--text-primary)] outline-none" /></label>
                <div className="flex items-end md:col-span-2 xl:col-span-1"><button disabled={!onboardingName.trim() || !onboardingEmail.trim() || saveOnboarding.isPending} onClick={() => saveOnboarding.mutate()} className="w-full px-3 py-2 text-[12px] font-semibold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--text-inverse)" }}>{saveOnboarding.isPending ? "Saving..." : "Save setup and consent"}</button></div>
              </div>
            ) : (
              <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                <span>Tracking consent is active.</span>
                <span>Screenshot analysis: {onboarding.data?.profile?.privacy?.screenshotAnalysisConsent ? "enabled" : "disabled"}.</span>
                {onboarding.data?.profile?.privacy?.screenshotAnalysisConsent ? (
                  <button disabled={changeConsent.isPending} onClick={() => changeConsent.mutate("withdraw_screenshot_analysis")} className="border px-2 py-1 text-[11px] font-semibold text-[var(--status-warn)]" style={{ borderColor: "var(--status-warn)" }}>Disable screenshots</button>
                ) : (
                  <button disabled={changeConsent.isPending} onClick={() => changeConsent.mutate("accept_screenshot_analysis")} className="border px-2 py-1 text-[11px] font-semibold" style={{ borderColor: "var(--border)" }}>Enable screenshots</button>
                )}
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
                <button disabled={!day.data?.shift || sessionAction.isPending} onClick={() => sessionAction.mutate({ method: "POST", body: { source: "web", late_acknowledged: true } })} className="inline-flex items-center gap-2 px-3 py-2 text-[12px] font-semibold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--text-inverse)" }}><Check size={14} /> Clock in</button>
              ) : (
                <>
                  {workSession?.state !== "eod_due" ? <button disabled={sessionAction.isPending} onClick={() => sessionAction.mutate({ method: "PATCH", body: { action: workSession?.state === "paused" ? "resume" : "pause" } })} className="inline-flex items-center gap-2 border px-3 py-2 text-[12px] font-semibold disabled:opacity-50" style={{ borderColor: "var(--border)" }}>{workSession?.state === "paused" ? "Resume" : "Pause"}</button> : null}
                  <button disabled={sessionAction.isPending} onClick={() => window.confirm("Clock out and close today’s plan?") && sessionAction.mutate({ method: "PATCH", body: { action: "clock_out", extended_acknowledged: true } })} className="inline-flex items-center gap-2 border px-3 py-2 text-[12px] font-semibold text-[var(--status-warn)] disabled:opacity-50" style={{ borderColor: "var(--status-warn)" }}>Clock out</button>
                </>
              )}
            </div>
          </section>
          {day.data?.plan ? <section className="border" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
            <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
              <h2 className="flex items-center gap-2 text-sm font-semibold"><ListTodo size={16} style={{ color: "var(--accent)" }} /> Today&apos;s plan</h2>
              <span className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">{operationLabel(day.data.plan.status)}</span>
            </div>
            <div className="divide-y" style={{ borderColor: "var(--border)" }}>
              {day.data.plan.items.map((item) => (
                <div key={item.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1"><p className="text-[12px] font-medium text-[var(--text-primary)]">{item.title_snapshot}</p><p className="mt-1 text-[10px] uppercase text-[var(--text-tertiary)]">{operationLabel(item.disposition)} · {operationLabel(item.source)}</p></div>
                  {item.disposition === "selected" || item.disposition === "deferred" ? <button disabled={proposeRemoval.isPending || !sessionIsActive} onClick={() => { const reason = window.prompt(`Why should “${item.title_snapshot}” be removed from today’s plan?`, "Priority changed or no longer relevant."); if (reason?.trim()) proposeRemoval.mutate({ planItemId: item.id, reason: reason.trim() }); }} className="border px-2 py-1 text-[10px] font-semibold text-[var(--status-warn)] disabled:opacity-50" style={{ borderColor: "var(--status-warn)" }}>Propose removal</button> : <span className="text-[10px] text-[var(--text-tertiary)]">{item.disposition === "removal_proposed" ? "Pending review" : "Removed"}</span>}
                </div>
              ))}
              {!day.data.plan.items.length ? <p className="p-4 text-[12px] text-[var(--text-tertiary)]">No task-backed items are in today&apos;s plan.</p> : null}
            </div>
          </section> : null}
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
                onClick={() => checkIn.mutate({ confirmed_existing_tasks: true })}
                className="inline-flex items-center gap-2 border px-3 py-2 text-[12px] font-semibold text-[var(--text-secondary)] disabled:opacity-50"
                style={{ borderColor: "var(--border)" }}
              >
                <Check size={14} /> Current tasks are my plan
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


          {(day.data?.prompt.kind === "eod" || day.data?.report) ? (
            <section className="border" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
              <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
                <h2 className="flex items-center gap-2 text-sm font-semibold"><FileCheck2 size={16} style={{ color: "var(--accent)" }} /> EOD report</h2>
                <span className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">{day.data?.report?.status || "Not drafted"}</span>
              </div>
              {day.data?.report ? (
                <>
                  <textarea
                    value={reportMarkdown}
                    onChange={(event) => setReportMarkdown(event.target.value)}
                    rows={16}
                    className="w-full resize-y border-0 bg-transparent px-4 py-3 font-mono text-[12px] leading-5 text-[var(--text-primary)] outline-none"
                    disabled={day.data.report.status === "pending_review" || day.data.report.status === "approved"}
                  />
                  <div className="flex justify-end border-t p-3" style={{ borderColor: "var(--border)" }}>
                    <button
                      disabled={!reportMarkdown.trim() || day.data.report.status === "pending_review" || day.data.report.status === "approved" || submitEod.isPending}
                      onClick={() => submitEod.mutate()}
                      className="inline-flex items-center gap-2 px-3 py-2 text-[12px] font-semibold disabled:opacity-50"
                      style={{ background: "var(--accent)", color: "var(--text-inverse)" }}
                    >
                      <Send size={14} /> Submit for review
                    </button>
                  </div>
                </>
              ) : (
                <button onClick={() => draftEod.mutate()} disabled={draftEod.isPending} className="m-4 inline-flex items-center gap-2 border px-3 py-2 text-[12px] font-semibold disabled:opacity-50" style={{ borderColor: "var(--border)" }}>
                  <FileCheck2 size={14} /> Draft EOD
                </button>
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
              <h2 className="flex items-center gap-2 text-sm font-semibold"><ListTodo size={16} style={{ color: "var(--accent)" }} /> Today&apos;s tasks</h2>
              <span className="text-[12px] text-[var(--text-tertiary)]">{tasks.length}</span>
            </div>
            {tasks.length ? tasks.map((task) => (
              <article key={task.id} className="border-b px-4 py-3 last:border-b-0" style={{ borderColor: "var(--border)" }}>
                <div className="flex items-start gap-3">
                  <CircleDot size={16} className="mt-0.5 shrink-0" style={{ color: task.blocked ? "var(--status-warn)" : "var(--text-tertiary)" }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-[var(--text-primary)]">{task.title}</p>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--text-tertiary)]">
                      {task.project?.name ? <span>{task.project.name}</span> : null}
                      {task.priority ? <span>{operationLabel(task.priority)}</span> : null}
                      {task.due_date ? <span>Due {task.due_date}</span> : null}
                      {task.estimated_effort_minutes ? <span>{task.estimated_effort_minutes} min</span> : null}
                    </div>
                    {task.expected_outcome ? <p className="mt-2 text-[12px] text-[var(--text-secondary)]">Outcome: {task.expected_outcome}</p> : null}
                    {task.definition_of_done ? <p className="mt-1 text-[12px] text-[var(--text-secondary)]">Done when: {task.definition_of_done}</p> : null}
                    {task.blocked_reason ? <p className="mt-2 text-[12px] text-[var(--status-warn)]">Blocked: {task.blocked_reason}</p> : null}
                  </div>
                </div>
              </article>
            )) : <p className="p-4 text-[12px] text-[var(--text-tertiary)]">No open or due Nifty tasks.</p>}
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
                    <span className="text-[10px] uppercase text-[var(--text-tertiary)]">{item.source}</span>
                  </div>
                  {item.summary ? <p className="mt-1 text-[11px] leading-5 text-[var(--text-secondary)]">{item.summary}</p> : null}
                  {item.evidence_event_id && item.event?.correction_status !== "disputed" ? <button disabled={disputeEvidence.isPending} onClick={() => disputeEvidence.mutate(item.evidence_event_id)} className="mt-2 text-[10px] font-semibold text-[var(--status-warn)] disabled:opacity-50">Dispute</button> : null}
                  {item.event?.correction_status === "disputed" ? <span className="mt-2 block text-[10px] font-semibold uppercase text-[var(--status-warn)]">Disputed</span> : null}
                </div>
              ))}
              {!evidence.length ? <p className="p-4 text-[12px] text-[var(--text-tertiary)]">No evidence recorded for this shift date.</p> : null}
            </div>
          </section>

          <section className="border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
            <h2 className="flex items-center gap-2 text-sm font-semibold"><Clock3 size={16} style={{ color: "var(--accent)" }} /> Next check-in</h2>
            <p className="mt-3 text-lg font-semibold text-[var(--text-primary)]">{formatTime(day.data?.prompt.nextPromptAt, timezone)}</p>
            <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">{day.data?.prompt.required ? "Response required" : "Quiet notification"}</p>
          </section>
        </aside>
      </main>

      {error ? (
        <div className="fixed bottom-5 right-5 flex max-w-md items-start gap-2 border px-4 py-3 text-[12px] text-[var(--status-err)] shadow-lg" style={{ borderColor: "var(--status-err)", background: "var(--bg-card)" }}>
          <AlertCircle size={16} className="mt-0.5 shrink-0" /> {(error as Error).message}
        </div>
      ) : null}
    </div>
  );
}
