import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { AdminButton, Notice, Skeleton } from "./ui";
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
      <div className="insights-control-page">
        <Skeleton className="h-10" />
        <Skeleton className="h-28" />
        <div className="control-loading-grid">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
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
