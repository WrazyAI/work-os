import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { AdminButton, AdminRowsSkeleton, Notice } from "./ui";
import { Skeleton } from "../LoadingUi";
import { ADMIN_STALE_MS, adminKeys, fetchAdminInsights, normalizeAdminInsights } from "./data";
import type { AdminInsightRange, AdminInsights } from "./types";
import InsightsControlRoom from "./InsightsControlRoom";

/** Administration Insights: the Control room. The range and person selectors
 * scope the record server-side; the matrix, ribbon, and person drawer all read
 * the same payload, so the facts can never disagree with the filter. */
export default function InsightsPage({ initialPersonId }: { initialPersonId?: string }) {
  const [range, setRange] = useState<AdminInsightRange>("7d");
  const [personId, setPersonId] = useState(initialPersonId ?? "");

  const insights = useQuery<AdminInsights>({
    queryKey: adminKeys.insights(range, personId),
    queryFn: () => fetchAdminInsights(range, personId),
    select: normalizeAdminInsights,
    staleTime: ADMIN_STALE_MS,
  });

  if (insights.isLoading) {
    return (
      <div className="insights-control-page" role="group" aria-label="Loading insights" aria-busy="true">
        <div className="control">
          <header className="control-head">
            <div className="control-title admin-loading-fields">
              <Skeleton className="skeleton-line skeleton-title" />
              <Skeleton className="skeleton-line skeleton-body" />
            </div>
            <div className="control-ribbon">
              {Array.from({ length: 4 }, (_, index) => (
                <div className="control-metric admin-loading-fields" key={index}>
                  <Skeleton className="skeleton-line skeleton-kicker" />
                  <Skeleton className="skeleton-line skeleton-value" />
                </div>
              ))}
            </div>
          </header>
          <div className="control-grid">
            <div className="control-matrix">
              <AdminRowsSkeleton label="Loading activity matrix" leading rows={5} />
            </div>
            <aside className="control-rail">
              <AdminRowsSkeleton label="Loading insights summary" rows={3} />
            </aside>
          </div>
        </div>
      </div>
    );
  }
  if (insights.error || !insights.data) {
    return (
      <Notice tone="err">
        Insights could not be loaded.
        <AdminButton variant="ghost" icon={RefreshCw} onClick={() => void insights.refetch()}>Retry</AdminButton>
      </Notice>
    );
  }

  return (
    <InsightsControlRoom
      data={insights.data}
      range={range}
      onRange={setRange}
      personId={personId}
      onPerson={setPersonId}
    />
  );
}
