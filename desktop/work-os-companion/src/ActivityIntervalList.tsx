import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ActivityIntervalCard } from "./ActivityIntervalCard";
import { decideActivityIntervalReview, useActivityIntervalsQuery } from "./workOsQueries";
import { workOsKeys } from "./queryClient";
import type { PreviewResolver } from "./ScreenshotGallery";

/** The Tasks tab's Recent activity stream: Activity Interval Reviews newest
 * first, oldest last, each able to reveal the exact frames it was built from.
 * Reads its own cached query so a new recap appears without reopening the tab. */
export function ActivityIntervalList({ date, enabled, timezone, onDecide, decidingId, pollMs, resolveSrc, onViewInApp, onOpenNextSteps }: {
  date: string | null;
  enabled: boolean;
  timezone?: string | null;
  onDecide: (id: string, action: "confirm" | "amend", feedback?: string) => Promise<void>;
  decidingId: string | null;
  pollMs?: number;
  resolveSrc?: PreviewResolver;
  /** Floating companion only: jump to the Focus tab in the main window. */
  onViewInApp?: () => void;
  /** Opens the Review queue from a recap's next-steps link. */
  onOpenNextSteps?: () => void;
}) {
  const query = useActivityIntervalsQuery({ enabled, date, pollMs });
  const intervals = query.data?.intervals ?? [];

  return (
    <section className="chat-activity-stream" aria-label="Recent activity">
      <header className="chat-activity-stream-head">
        <span className="chat-activity-eyebrow">Recent activity</span>
        {intervals.length > 0 ? <span className="chat-activity-count">{intervals.length}</span> : null}
        {onViewInApp ? <button type="button" className="chat-activity-view" onClick={onViewInApp}>View in app</button> : null}
      </header>
      {!date || query.isPending ? (
        <div className="chat-activity-skeletons" aria-hidden="true">
          <div className="chat-activity-skeleton" />
          <div className="chat-activity-skeleton" />
        </div>
      ) : query.isError ? (
        <div className="chat-activity-empty">
          <p>Activity recaps could not be loaded.</p>
          <button type="button" className="chat-activity-quiet" onClick={() => void query.refetch()}>Retry</button>
        </div>
      ) : intervals.length === 0 ? (
        <div className="chat-activity-empty">
          <p>No activity recaps yet.</p>
          <small>Otto will summarize each work interval after your next check-in.</small>
        </div>
      ) : (
        <div className="chat-activity-list">
          {intervals.map((interval) => (
            <ActivityIntervalCard
              key={interval.id}
              interval={interval}
              timezone={timezone}
              currentDate={query.data?.date ?? date}
              onDecide={onDecide}
              deciding={decidingId === interval.id}
              resolveSrc={resolveSrc}
              nextSteps={interval.nextSteps ?? null}
              onOpenNextSteps={onOpenNextSteps}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/** Self-contained stream for the in-app Focus tab: owns its decision calls and
 * cache invalidation so the dock can embed the same list without App-level
 * wiring. Renders only while a workday date is available. */
export function ActivityIntervalStream({ date, enabled = true, timezone, pollMs, onOpenReview }: {
  date: string | null;
  enabled?: boolean;
  timezone?: string | null;
  pollMs?: number;
  /** Opens the Review queue when the employee follows a recap's next-steps link. */
  onOpenReview?: () => void;
}) {
  const queryClient = useQueryClient();
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const decide = async (id: string, action: "confirm" | "amend", feedback?: string) => {
    setDecidingId(id);
    setError(null);
    try {
      await decideActivityIntervalReview(id, action, feedback);
      await queryClient.invalidateQueries({ queryKey: workOsKeys.activityIntervals(date ?? "none") });
    } catch (value) {
      setError(value instanceof Error ? value.message : "The recap decision could not be saved.");
    } finally {
      setDecidingId(null);
    }
  };
  return <>
    {error ? <p className="chat-activity-error" role="alert">{error}</p> : null}
    <ActivityIntervalList date={date} enabled={enabled} timezone={timezone} onDecide={decide} decidingId={decidingId} pollMs={pollMs} onOpenNextSteps={onOpenReview} />
  </>;
}
