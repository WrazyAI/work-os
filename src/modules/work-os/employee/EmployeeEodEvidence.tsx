"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ScanSearch } from "lucide-react";
import { fetchJson, formatTime, type EodScreenshotGallery } from "./model";
import { EmptyState, Panel, PanelHeader, PrimaryButton, Skeleton, StatusPill } from "./ui";

function confidenceLabel(value: number) {
  if (!Number.isFinite(value)) return "unrated";
  if (value >= 0.7) return "high confidence";
  if (value >= 0.4) return "medium confidence";
  return "low confidence";
}

/**
 * Screenshot evidence for the EOD day (companion parity).
 *
 * Frames are Worktivity observations, one synthesized line per local hour.
 * "Analyze waiting screenshots" runs one small bounded analysis batch; the
 * counts stay honest while frames are pending, and an hour without a
 * synthesis says so instead of inventing a summary.
 */
export default function EmployeeEodEvidence({ date, timezone, enabled }: { date: string; timezone?: string; enabled: boolean }) {
  const queryClient = useQueryClient();
  const gallery = useQuery<EodScreenshotGallery>({
    queryKey: ["work-os", "eod-screenshots", date],
    enabled: enabled && !!date,
    staleTime: 60_000,
    refetchInterval: (result) => ((result.state.data?.pending ?? 0) > 0 ? 5_000 : false),
    queryFn: () => fetchJson(`/api/work-os/me/eod/screenshots?date=${encodeURIComponent(date)}`),
  });
  const prepare = useMutation({
    mutationFn: () => fetchJson("/api/work-os/me/eod/screenshots/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, max_frames: 6 }),
    }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["work-os", "eod-screenshots", date] }),
  });

  if (!enabled) return null;

  const data = gallery.data;
  const hours = data?.hours ?? [];
  const viewable = data?.viewable ?? [];
  const error = gallery.error || prepare.error;
  const counts = data
    ? `${data.processed} analyzed${data.pending ? ` · ${data.pending} pending` : ""}${data.excludedPolicy ? ` · ${data.excludedPolicy} excluded by policy` : ""}${data.excludedSensitive ? ` · ${data.excludedSensitive} excluded as sensitive` : ""}${data.unavailable ? ` · ${data.unavailable} unavailable` : ""}`
    : "Checking recorded frames…";

  return (
    <Panel>
      <PanelHeader
        icon={<Camera size={16} />}
        title="Screenshot evidence"
        meta={counts}
        actions={
          <PrimaryButton disabled={prepare.isPending || !data} onClick={() => prepare.mutate()}>
            <ScanSearch size={14} /> {prepare.isPending ? "Analyzing…" : "Analyze waiting screenshots"}
          </PrimaryButton>
        }
      />
      {error ? <p className="px-5 py-3 text-[12px] leading-5" style={{ color: "var(--status-error)" }}>{(error as Error).message}</p> : null}
      {gallery.isLoading && !data ? (
        <div className="grid gap-2 px-5 py-4" aria-busy="true">
          <Skeleton className="h-3 w-2/3" /><Skeleton className="h-3 w-1/2" />
        </div>
      ) : data && (hours.length || viewable.length) ? (
        <div>
          {hours.length ? (
            <ul>
              {hours.map((hour) => (
                <li key={hour.hourStart} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-5 py-3 last:border-b-0" style={{ borderColor: "var(--border)" }}>
                  <span className="w-14 shrink-0 text-[11px] font-bold tabular-nums text-[var(--text-tertiary)]">{hour.label}</span>
                  <span className="min-w-0 flex-1 text-[12px] leading-5 text-[var(--text-secondary)]">
                    {hour.summary}
                    {!hour.synthesized ? <span className="ml-1 text-[11px] text-[var(--text-tertiary)]">(counts only — the summarizer was unavailable)</span> : null}
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-tertiary)]">{hour.frameCount} frame{hour.frameCount === 1 ? "" : "s"}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {viewable.length ? (
            <details className="border-t px-5 py-3" style={{ borderColor: "var(--border)" }}>
              <summary className="cursor-pointer text-[11px] font-semibold text-[var(--text-tertiary)]">
                Analyzed frames · {viewable.length}
              </summary>
              <ul className="mt-2 grid gap-2">
                {viewable.map((frame) => (
                  <li key={frame.summaryId} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="w-14 shrink-0 text-[11px] tabular-nums text-[var(--text-tertiary)]">{formatTime(frame.capturedAt, timezone)}</span>
                    {frame.visibleApp ? <span className="text-[11px] font-semibold text-[var(--text-secondary)]">{frame.visibleApp}</span> : null}
                    <span className="min-w-0 flex-1 text-[12px] leading-5 text-[var(--text-secondary)]">{frame.summary}</span>
                    <span className="text-[10px] uppercase tracking-[0.05em] text-[var(--text-tertiary)]" title={`confidence ${frame.confidence}`}>{confidenceLabel(frame.confidence)}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {data.pending > 0 ? (
            <p className="border-t px-5 py-3 text-[11px] leading-5 text-[var(--text-tertiary)]" style={{ borderColor: "var(--border)" }} role="status">
              {data.pending} frame{data.pending === 1 ? " is" : "s are"} still being analyzed. This list refreshes automatically.
            </p>
          ) : null}
        </div>
      ) : (
        <EmptyState
          icon={<Camera size={20} />}
          title="No frames recorded for this day"
          message="Worktivity screenshots appear here once capture has observations for the day."
          action={data && (data.pending > 0 || data.total > 0)
            ? <StatusPill tone="info">{data.pending > 0 ? `${data.pending} pending analysis` : `${data.total} recorded`}</StatusPill>
            : undefined}
        />
      )}
    </Panel>
  );
}
