import { ActivityIntervalCard } from "./ActivityIntervalCard";
import { useActivityIntervalsQuery } from "./workOsQueries";
import type { PreviewResolver } from "./ScreenshotGallery";

/** The Tasks tab's Recent activity stream: Activity Interval Reviews newest
 * first, oldest last, each able to reveal the exact frames it was built from.
 * Reads its own cached query so a new recap appears without reopening the tab. */
export function ActivityIntervalList({ date, enabled, timezone, onDecide, decidingId, pollMs, resolveSrc }: {
  date: string | null;
  enabled: boolean;
  timezone?: string | null;
  onDecide: (id: string, action: "confirm" | "amend", feedback?: string) => Promise<void>;
  decidingId: string | null;
  pollMs?: number;
  resolveSrc?: PreviewResolver;
}) {
  const query = useActivityIntervalsQuery({ enabled, date, pollMs });
  const intervals = query.data?.intervals ?? [];

  return (
    <section className="chat-activity-stream" aria-label="Recent activity">
      <header className="chat-activity-stream-head">
        <span className="chat-activity-eyebrow">Recent activity</span>
        {intervals.length > 0 ? <span className="chat-activity-count">{intervals.length}</span> : null}
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
            />
          ))}
        </div>
      )}
    </section>
  );
}
