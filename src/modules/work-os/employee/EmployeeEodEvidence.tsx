"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ScanSearch } from "lucide-react";
import EvidenceImageDialog, { EvidenceThumb, evidenceScreenshotUrl, type EvidencePreview } from "@/modules/work-os/evidence-image-dialog";
import { fetchJson, formatTime, type EodScreenshotGallery } from "./model";
import styles from "./EmployeeReview.module.css";

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
  const [preview, setPreview] = useState<EvidencePreview | null>(null);
  const prepare = useMutation({
    mutationFn: () => fetchJson("/api/work-os/me/eod/screenshots/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, max_frames: 6 }),
    }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["work-os", "eod-screenshots", date] }),
  });
  const gallery = useQuery<EodScreenshotGallery>({
    queryKey: ["work-os", "eod-screenshots", date],
    enabled: enabled && !!date,
    staleTime: 60_000,
    // Poll only while an on-demand preparation is actually running; once it
    // settles the query is invalidated, so frames that keep failing stay
    // `pending` without an endless poll (companion parity).
    refetchInterval: () => (prepare.isPending ? 5_000 : false),
    queryFn: () => fetchJson(`/api/work-os/me/eod/screenshots?date=${encodeURIComponent(date)}`),
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
    <section className={styles.section} aria-labelledby="review-frames-title">
      <header className={styles.sectionHead}>
        <div>
          <h2 id="review-frames-title">Screenshot evidence</h2>
          <p className={styles.sectionMeta}>{counts}</p>
        </div>
      </header>

      <div className={styles.evidenceActions}>
        <p className={styles.evidenceNote}>One analyzed line per recorded hour. Frames are observations, never proof of completion.</p>
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={prepare.isPending || !data}
          onClick={() => prepare.mutate()}
        >
          <ScanSearch size={14} /> {prepare.isPending ? "Analyzing…" : "Analyze waiting screenshots"}
        </button>
      </div>

      {error ? <p className={styles.evidenceNote} style={{ color: "var(--status-error)" }}>{(error as Error).message}</p> : null}

      {gallery.isLoading && !data ? (
        <div className="grid gap-2 py-3" aria-busy="true">
          <div className={styles.skeleton} style={{ width: "66%" }} />
          <div className={styles.skeleton} style={{ width: "50%" }} />
        </div>
      ) : data && (hours.length || viewable.length) ? (
        <div>
          {hours.length ? (
            <ul className={styles.rows}>
              {hours.map((hour) => (
                <li key={hour.hourStart} className={styles.evidenceRow}>
                  <span className={styles.evidenceTime}>{hour.label}</span>
                  <div className={styles.evidenceBody}>
                    <span className={styles.evidenceCopy}>{hour.summary}</span>
                    <span className={styles.evidenceMeta}>
                      {!hour.synthesized ? <span>Counts only — the summarizer was unavailable</span> : null}
                      <span>{hour.frameCount} frame{hour.frameCount === 1 ? "" : "s"}</span>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          {viewable.length ? (
            <details className={styles.frames}>
              <summary>Analyzed frames · {viewable.length}</summary>
              <ul className={styles.rows}>
                {viewable.map((frame) => (
                  <li key={frame.summaryId} className={styles.evidenceRow}>
                    <EvidenceThumb
                      thumbSrc={evidenceScreenshotUrl(frame.summaryId, "thumb")}
                      fullSrc={evidenceScreenshotUrl(frame.summaryId, "preview")}
                      title={frame.visibleApp ?? "Screenshot evidence"}
                      caption={`${formatTime(frame.capturedAt, timezone)}${frame.visibleApp ? ` · ${frame.visibleApp}` : ""}${frame.summary ? ` — ${frame.summary}` : ""}`}
                      label={`Preview screenshot captured at ${formatTime(frame.capturedAt, timezone)}`}
                      onOpen={setPreview}
                    />
                    <span className={styles.evidenceTime}>{formatTime(frame.capturedAt, timezone)}</span>
                    <div className={styles.evidenceBody}>
                      {frame.visibleApp ? <span className={styles.evidenceTitle}>{frame.visibleApp}</span> : null}
                      <span className={styles.evidenceCopy}>{frame.summary}</span>
                      <span className={styles.evidenceMeta} title={`confidence ${frame.confidence}`}>{confidenceLabel(frame.confidence)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {data.pending > 0 ? (
            <p className={styles.evidenceNote} role="status">
              {data.pending} frame{data.pending === 1 ? " is" : "s are"} still being analyzed. This list refreshes automatically.
            </p>
          ) : null}
        </div>
      ) : (
        <div className={styles.empty}>
          <strong className={styles.emptyTitle}>No frames recorded for this day</strong>
          <p className={styles.emptyCopy}>Worktivity screenshots appear here once capture has observations for the day.</p>
          {data && (data.pending > 0 || data.total > 0) ? (
            <span className={styles.status}>{data.pending > 0 ? `${data.pending} pending analysis` : `${data.total} recorded`}</span>
          ) : null}
        </div>
      )}
      <EvidenceImageDialog preview={preview} onClose={() => setPreview(null)} />
    </section>
  );
}
