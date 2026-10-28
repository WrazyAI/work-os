import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ActivityIntervalCard } from "./ActivityIntervalCard";
import { decideActivityIntervalReview, useActivityIntervalsQuery } from "./workOsQueries";
import { workOsKeys } from "./queryClient";
import type { PreviewResolver } from "./ScreenshotGallery";

/** The Tasks tab's Recent activity stream: Activity Interval Reviews newest
 * first, oldest last, each able to reveal the exact frames it was built from.
 * Reads its own cached query so a new recap appears without reopening the tab. */
export function ActivityIntervalList({ date, enabled, timezone, onDecide, decidingId, pollMs, resolveSrc, onViewInApp, onListen, listeningId }: {
  date: string | null;
  enabled: boolean;
  timezone?: string | null;
  onDecide: (id: string, action: "confirm" | "amend", feedback?: string, expectedReviewVersion?: number) => Promise<void>;
  decidingId: string | null;
  pollMs?: number;
  resolveSrc?: PreviewResolver;
  /** Floating companion only: jump to the Focus tab in the main window. */
  onViewInApp?: () => void;
  /** Readings are offered on the companion's own cards. */
  onListen?: (id: string, revision: number | null) => void;
  listeningId?: string | null;
}) {
  const query = useActivityIntervalsQuery({ enabled, date, pollMs });
  const intervals = useMemo(() => query.data?.pages.flatMap((page) => page.intervals) ?? [], [query.data]);
  // The badge states the complete range (design §6.4); the open edge reports
  // the loaded window whenever more history exists.
  const total = query.data?.pages[0]?.total ?? intervals.length;

  return (
    <section className="chat-activity-stream" aria-label="Recent activity">
      <header className="chat-activity-stream-head">
        <span className="chat-activity-eyebrow">Recent activity</span>
        {total > 0 ? <span className="chat-activity-count">{total}</span> : null}
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
              currentDate={query.data?.pages[0]?.date ?? date}
              onDecide={onDecide}
              deciding={decidingId === interval.id}
              resolveSrc={resolveSrc}
              onListen={onListen}
              listening={listeningId === interval.id}
            />
          ))}
        </div>
      )}
      {query.isFetchingNextPage ? (
        <div className="chat-activity-skeletons" aria-hidden="true">
          <div className="chat-activity-skeleton" />
          <div className="chat-activity-skeleton" />
        </div>
      ) : null}
      {query.hasNextPage ? (
        <div className="chat-activity-more">
          <small>{`Showing ${intervals.length} of ${total}`}</small>
          <button
            type="button"
            className="chat-activity-more-button"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? "Loading recaps…" : query.isFetchNextPageError ? "Retry load more" : "Load more"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

/** Self-contained stream for the in-app Focus tab: owns its decision calls and
 * cache invalidation so the dock can embed the same list without App-level
 * wiring. Renders only while a workday date is available. */
export function ActivityIntervalStream({ date, enabled = true, timezone, pollMs, onListen, listeningId }: {
  date: string | null;
  enabled?: boolean;
  timezone?: string | null;
  pollMs?: number;
  /** Read a recap aloud. Offered on both surfaces, so both wire the control. */
  onListen?: (id: string, revision: number | null) => void;
  listeningId?: string | null;
}) {
  const queryClient = useQueryClient();
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const decide = async (id: string, action: "confirm" | "amend", feedback?: string, expectedReviewVersion?: number) => {
    setDecidingId(id);
    setError(null);
    try {
      await decideActivityIntervalReview(id, action, feedback, expectedReviewVersion);
      await queryClient.invalidateQueries({ queryKey: workOsKeys.activityIntervals(date ?? "none") });
    } catch (value) {
      setError(value instanceof Error ? value.message : "The recap decision could not be saved.");
    } finally {
      setDecidingId(null);
    }
  };
  return <>
    {error ? <p className="chat-activity-error" role="alert">{error}</p> : null}
    <ActivityIntervalList date={date} enabled={enabled} timezone={timezone} onDecide={decide} decidingId={decidingId} pollMs={pollMs} onListen={onListen} listeningId={listeningId} />
  </>;
}
