"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FileSearch, Pencil, Square, Volume2 } from "lucide-react";
import { fetchJson, formatTime, requestId, type ActivityInterval, type ActivityIntervalsResponse } from "./model";
import { hasRecapForSlot, recapEnsureSlot, recapPromptDueInMs } from "./recaps";
import { useRecapRead } from "./recapAudio";
import { Panel, PanelHeader, PrimaryButton, QuietButton, SecondaryButton, Skeleton, StatusPill } from "./ui";

const REVIEW_LABELS: Record<ActivityInterval["reviewStatus"], string> = {
  inferred: "Not reviewed",
  confirmed: "Confirmed",
  amended: "Updated by you",
};

/** Quiet coverage summary for the evidence disclosure: "8 of 28 frames
 * analyzed", or just "8 frames analyzed" when nothing was left out. */
function coverageLabel(coverage: ActivityInterval["coverage"]): string | null {
  const analyzed = coverage?.framesAnalyzed;
  if (analyzed == null || analyzed < 0) return null;
  const recorded = coverage?.framesRecorded;
  if (recorded != null && recorded > analyzed) return `${analyzed} of ${recorded} frames analyzed`;
  return `${analyzed} frame${analyzed === 1 ? "" : "s"} analyzed`;
}

/** One ensure per prompt slot per app session (the server call is idempotent
 * per slot; this keeps a navigation-heavy session from repeating it). */
const ensuredRecapSlots = new Set<string>();

/**
 * The employee's Activity Interval Review stream (companion parity).
 *
 * A recap is evidence-bounded and describes visible activity only — it never
 * claims productivity or completion. "Looks right" confirms the recap;
 * "Add or correct" hands the correction to the employee's own words. Neither
 * action creates a check-in or advances the prompt cadence.
 *
 * When a progress prompt is due, the recap is ensured for that exact prompt
 * slot before the stream settles — the same interval-first check-in the
 * companion performs for its notification.
 */
export default function EmployeeActivityRecaps({
  date,
  timezone,
  prompt,
  voiceAvailable = false,
}: {
  date: string;
  timezone?: string;
  prompt?: { kind: string | null; nextPromptAt: string | null } | null;
  /** The organization may read recaps aloud (flag + deployment capability). */
  voiceAvailable?: boolean;
}) {
  const queryClient = useQueryClient();
  const [preparingRecap, setPreparingRecap] = useState(false);
  const [promptTick, setPromptTick] = useState(0);
  /* One read for the stream, like the companion: pressing a second card's
     Listen replaces the first instead of stacking two voices. */
  const read = useRecapRead({ onStale: () => void queryClient.invalidateQueries({ queryKey: ["work-os", "activity-intervals", date] }) });
  const query = useQuery<ActivityIntervalsResponse>({
    queryKey: ["work-os", "activity-intervals", date],
    enabled: !!date,
    queryFn: () => fetchJson(`/api/work-os/me/activity-intervals?date=${encodeURIComponent(date)}&days=30`),
    refetchInterval: (result) => (result.state.data?.intervals ?? []).some((interval) => interval.generationStatus === "preparing") ? 15_000 : false,
    staleTime: 60_000,
  });

  const ensure = useMutation({
    mutationFn: (slot: string) => fetchJson("/api/work-os/me/activity-intervals/ensure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt_due_at: slot.slice(slot.indexOf(":") + 1) }),
    }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["work-os", "activity-intervals", date] }),
  });

  /* A future progress prompt becomes due while the page stays open: tick at the
     due moment so the ensure below runs then, like the companion's schedule. */
  useEffect(() => {
    const dueInMs = recapPromptDueInMs(prompt, Date.now());
    if (dueInMs === null) return;
    const timer = setTimeout(() => setPromptTick((value) => value + 1), Math.min(dueInMs + 500, 2_147_000_000));
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt?.kind, prompt?.nextPromptAt, promptTick]);

  useEffect(() => {
    if (!prompt || !date) return;
    const slot = recapEnsureSlot(prompt, Date.now());
    if (!slot || ensuredRecapSlots.has(slot)) return;
    const intervals = query.data?.intervals ?? [];
    if (hasRecapForSlot(intervals, slot)) {
      ensuredRecapSlots.add(slot);
      return;
    }
    ensuredRecapSlots.add(slot);
    setPreparingRecap(true);
    ensure.mutate(slot, {
      // A failed ensure releases the slot so a later check can retry it.
      onError: () => { ensuredRecapSlots.delete(slot); },
      onSettled: () => setPreparingRecap(false),
    });
    // The ref guard owns repetition; query/mutation objects are not inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt?.kind, prompt?.nextPromptAt, date, query.data, promptTick]);

  const intervals = query.data?.intervals ?? [];
  if (!intervals.length && !preparingRecap) return null;

  return (
    <Panel>
      <PanelHeader
        icon={<FileSearch size={16} />}
        title="Recent activity"
        meta="Grounded recaps of the intervals Worktivity observed. Evidence-bounded context only — never a productivity measure."
        actions={<QuietButton onClick={() => void query.refetch()} disabled={query.isFetching}>{query.isFetching ? "Refreshing…" : "Refresh"}</QuietButton>}
      />
      {preparingRecap && !intervals.length ? (
        <div className="grid gap-2 px-5 py-4" aria-busy="true" role="status">
          <span className="text-[12px] font-semibold text-[var(--text-secondary)]">Preparing your activity recap…</span>
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-full" />
        </div>
      ) : (
        <ul>
          {intervals.map((interval) => (
            <RecapCard
              key={interval.id}
              interval={interval}
              timezone={timezone}
              onDecided={() => void query.refetch()}
              voiceAvailable={voiceAvailable}
              read={read}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function RecapCard({ interval, timezone, onDecided, voiceAvailable, read }: {
  interval: ActivityInterval;
  timezone?: string;
  onDecided: () => void;
  voiceAvailable: boolean;
  read: ReturnType<typeof useRecapRead>;
}) {
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
  const coverage = coverageLabel(interval.coverage);
  const listening = read.state.intervalId === interval.id && read.state.status !== "idle";
  // The spoken lines are the card's own: the lead detail first, then the
  // activities in order. The highlight follows the audio's clock.
  const activeLine = listening && read.state.status === "playing" ? read.state.activeIndex : -1;
  const preparing = interval.generationStatus === "preparing";
  const unavailable = interval.generationStatus === "unavailable" || interval.generationStatus === "failed";

  return (
    <li className="border-b px-5 py-4 last:border-b-0" style={{ borderColor: "var(--border)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11.5px] font-semibold tabular-nums text-[var(--text-tertiary)]">{interval.label}</p>
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
          {interval.detail ? (
            <p
              className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]"
              style={activeLine === 0 ? { color: "var(--text-primary)", fontWeight: 600 } : undefined}
            >{interval.detail}</p>
          ) : null}
          {interval.activities?.length ? (
            <ul className="mt-2 grid gap-0.5">
              {interval.activities.map((activity, index) => (
                <li
                  key={activity}
                  className="text-[11px] leading-5 text-[var(--text-secondary)]"
                  style={activeLine === index + 1 ? { color: "var(--text-primary)", fontWeight: 600 } : undefined}
                >· {activity}</li>
              ))}
            </ul>
          ) : null}
          {interval.workflow && interval.workflow.length > 1 ? (
            <p className="mt-1.5 text-[11px] leading-5 text-[var(--text-secondary)]"><strong className="text-[var(--text-primary)]">Flow:</strong> {interval.workflow.join(" → ")}</p>
          ) : null}
        </>
      )}

      {interval.employeeFeedback ? (
        <p className="mt-2 rounded-lg border px-3 py-2 text-[12px] leading-5 text-[var(--text-secondary)]" style={{ borderColor: "var(--border)", background: "var(--bg-primary)" }}>
          Your note: {interval.employeeFeedback}
        </p>
      ) : null}

      {interval.uncertainties?.length ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] font-semibold text-[var(--text-tertiary)]">Extra notes</summary>
          <ul className="mt-1.5 grid gap-0.5">
            {interval.uncertainties.map((note) => (
              <li key={note} className="text-[11px] leading-5 text-[var(--text-tertiary)]">· {note}</li>
            ))}
          </ul>
        </details>
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
                {frame.usedInModel ? <span className="text-[10.5px] text-[var(--text-tertiary)]">used in recap</span> : null}
              </li>
            ))}
          </ul>
          {coverage ? <p className="mt-2 text-[10px] leading-5 text-[var(--text-tertiary)]">{coverage}</p> : null}
        </details>
      ) : interval.evidenceExpired ? (
        <p className="mt-2 text-[11px] leading-5 text-[var(--text-tertiary)]">
          Screenshots expired under the 30-day retention policy. The recap text is kept.
        </p>
      ) : null}

      {read.state.intervalId === interval.id && read.state.error ? (
        <p className="mt-2 text-[11px] leading-5" role="alert" style={{ color: "var(--status-error)" }}>{read.state.error}</p>
      ) : null}
      {voiceAvailable && !preparing && !unavailable ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <SecondaryButton
            aria-label={listening ? `Stop reading the recap for ${interval.label}` : `Listen to the recap for ${interval.label}`}
            aria-pressed={listening}
            onClick={() => void read.toggle(interval)}
          >
            {listening ? <Square size={12} /> : <Volume2 size={14} />}
            {listening ? (read.state.status === "loading" ? "Preparing…" : "Stop") : "Listen"}
          </SecondaryButton>
          {listening && read.state.status === "playing" ? (
            <span className="self-center text-[11px] tabular-nums text-[var(--text-tertiary)]">
              {Math.round(read.state.progress * 100)}%
            </span>
          ) : null}
        </div>
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
