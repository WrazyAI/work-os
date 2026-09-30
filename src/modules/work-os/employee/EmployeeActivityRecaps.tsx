"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, FileSearch, Pencil } from "lucide-react";
import { fetchJson, formatTime, requestId, type ActivityInterval, type ActivityIntervalsResponse } from "./model";
import { Panel, PanelHeader, PrimaryButton, QuietButton, SecondaryButton, Skeleton, StatusPill } from "./ui";

const REVIEW_LABELS: Record<ActivityInterval["reviewStatus"], string> = {
  inferred: "Not reviewed",
  confirmed: "Confirmed",
  amended: "Updated by you",
};

/**
 * The employee's Activity Interval Review stream (companion parity).
 *
 * A recap is evidence-bounded and describes visible activity only — it never
 * claims productivity or completion. "Looks right" confirms the recap;
 * "Add or correct" hands the correction to the employee's own words. Neither
 * action creates a check-in or advances the prompt cadence.
 */
export default function EmployeeActivityRecaps({ date, timezone }: { date: string; timezone?: string }) {
  const query = useQuery<ActivityIntervalsResponse>({
    queryKey: ["work-os", "activity-intervals", date],
    enabled: !!date,
    queryFn: () => fetchJson(`/api/work-os/me/activity-intervals?date=${encodeURIComponent(date)}&days=30`),
    refetchInterval: (result) => (result.state.data?.intervals ?? []).some((interval) => interval.generationStatus === "preparing") ? 15_000 : false,
    staleTime: 60_000,
  });

  const intervals = query.data?.intervals ?? [];
  if (!intervals.length) return null;

  return (
    <Panel>
      <PanelHeader
        icon={<FileSearch size={16} />}
        title="Recent activity"
        meta="Grounded recaps of the intervals Worktivity observed. Evidence-bounded context only — never a productivity measure."
        actions={<QuietButton onClick={() => void query.refetch()} disabled={query.isFetching}>{query.isFetching ? "Refreshing…" : "Refresh"}</QuietButton>}
      />
      <ul>
        {intervals.map((interval) => (
          <RecapCard key={interval.id} interval={interval} timezone={timezone} onDecided={() => void query.refetch()} />
        ))}
      </ul>
    </Panel>
  );
}

function RecapCard({ interval, timezone, onDecided }: { interval: ActivityInterval; timezone?: string; onDecided: () => void }) {
  const [amending, setAmending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const decide = useMutation({
    mutationFn: (action: "confirm" | "amend") => fetchJson(`/api/work-os/me/activity-intervals/${encodeURIComponent(interval.id)}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": requestId() },
      body: JSON.stringify(action === "amend" ? { action, feedback: feedback.trim() } : { action }),
    }),
    onSuccess: () => {
      setAmending(false);
      setFeedback("");
      onDecided();
    },
  });

  const evidence = interval.evidence ?? [];
  const preparing = interval.generationStatus === "preparing";
  const unavailable = interval.generationStatus === "unavailable" || interval.generationStatus === "failed";

  return (
    <li className="border-b px-5 py-4 last:border-b-0" style={{ borderColor: "var(--border)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">{interval.label}</p>
        <StatusPill tone={interval.reviewStatus === "confirmed" ? "done" : interval.reviewStatus === "amended" ? "info" : "open"}>
          {REVIEW_LABELS[interval.reviewStatus]}
        </StatusPill>
      </div>

      {preparing ? (
        <div className="mt-3 grid gap-2" aria-busy="true">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-full" />
        </div>
      ) : unavailable ? (
        <p className="mt-2 text-[12px] leading-5 text-[var(--text-secondary)]">
          {interval.failureReason || "The recap could not be generated for this interval."}
        </p>
      ) : (
        <>
          {interval.headline ? <p className="mt-2 text-[13px] font-semibold leading-5 text-[var(--text-primary)]">{interval.headline}</p> : null}
          {interval.detail ? <p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">{interval.detail}</p> : null}
          {interval.activities?.length ? (
            <ul className="mt-2 grid gap-0.5">
              {interval.activities.map((activity) => (
                <li key={activity} className="text-[11px] leading-5 text-[var(--text-secondary)]">· {activity}</li>
              ))}
            </ul>
          ) : null}
          {interval.workflow && interval.workflow.length > 1 ? (
            <p className="mt-1.5 text-[11px] leading-5 text-[var(--text-secondary)]"><strong className="text-[var(--text-primary)]">Flow:</strong> {interval.workflow.join(" → ")}</p>
          ) : null}
          {interval.uncertainties?.length ? (
            <p className="mt-1.5 text-[11px] leading-5 text-[var(--text-tertiary)]"><strong className="text-[var(--text-secondary)]">Not established:</strong> {interval.uncertainties.join("; ")}</p>
          ) : null}
        </>
      )}

      {interval.employeeFeedback ? (
        <p className="mt-2 rounded-lg border px-3 py-2 text-[12px] leading-5 text-[var(--text-secondary)]" style={{ borderColor: "var(--border)", background: "var(--bg-primary)" }}>
          Your note: {interval.employeeFeedback}
        </p>
      ) : null}

      {evidence.length ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] font-semibold text-[var(--text-tertiary)]">
            Evidence · {evidence.length} screenshot{evidence.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-2 grid gap-1.5">
            {evidence.map((frame, index) => (
              <li key={`${frame.summaryId ?? index}-${frame.capturedAt}`} className="flex flex-wrap items-baseline gap-x-2 text-[11px] leading-5">
                <span className="tabular-nums text-[var(--text-tertiary)]">{formatTime(frame.capturedAt, timezone)}</span>
                {frame.visibleApp ? <span className="font-semibold text-[var(--text-secondary)]">{frame.visibleApp}</span> : null}
                <span className="min-w-0 flex-1 text-[var(--text-secondary)]">{frame.frameSummary || "Frame retained without a text summary."}</span>
                {frame.usedInModel ? <span className="text-[10px] uppercase tracking-[0.05em] text-[var(--text-tertiary)]">used in recap</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : interval.evidenceExpired ? (
        <p className="mt-2 text-[11px] leading-5 text-[var(--text-tertiary)]">
          Screenshots expired under the 30-day retention policy. The recap text is kept.
        </p>
      ) : null}

      {decide.error ? <p className="mt-2 text-[11px] leading-5" style={{ color: "var(--status-error)" }}>{(decide.error as Error).message}</p> : null}

      {interval.reviewStatus === "inferred" && !preparing && !unavailable ? (
        amending ? (
          <div className="mt-3 grid gap-2">
            <label className="grid gap-1">
              <span className="text-[11px] font-semibold text-[var(--text-secondary)]">Add or correct this recap</span>
              <textarea
                value={feedback}
                onChange={(event) => setFeedback(event.target.value)}
                rows={3}
                maxLength={2000}
                className="w-full resize-y rounded-[10px] border px-3 py-2 text-[12px] leading-5 text-[var(--text-primary)] outline-none"
                style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}
                placeholder="What the recap missed or got wrong."
              />
            </label>
            <div className="flex justify-end gap-2">
              <SecondaryButton onClick={() => { setAmending(false); setFeedback(""); }}>Cancel</SecondaryButton>
              <PrimaryButton disabled={!feedback.trim() || decide.isPending} onClick={() => decide.mutate("amend")}>
                {decide.isPending ? "Saving…" : "Save correction"}
              </PrimaryButton>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            <PrimaryButton disabled={decide.isPending} onClick={() => decide.mutate("confirm")}>
              <Check size={14} /> {decide.isPending ? "Saving…" : "Looks right"}
            </PrimaryButton>
            <SecondaryButton disabled={decide.isPending} onClick={() => setAmending(true)}>
              <Pencil size={13} /> Add or correct
            </SecondaryButton>
          </div>
        )
      ) : null}
    </li>
  );
}
