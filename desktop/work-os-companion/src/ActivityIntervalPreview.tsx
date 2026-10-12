import { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ActivityIntervalCard } from "./ActivityIntervalCard";
import { ActivityIntervalList } from "./ActivityIntervalList";
import { workOsKeys } from "./queryClient";
import type { ActivityInterval, ActivityIntervalEvidence } from "./types";

/** DEV-only visual review surface for Activity Interval Reviews (design §9.1).
 * Renders the real Tasks-tab stream with deterministic fixture data, inline
 * thumbnail sources, and a local decision handler so confirm/amend can be
 * exercised without the API. Never shipped; see main.tsx preview routes. */

const DATE = "2026-09-28";

const shot = (label: string) => `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="#182018"/><text x="12" y="56" fill="#a8f15b" font-family="monospace" font-size="13">${label}</text></svg>`,
)}`;

const evidence: ActivityIntervalEvidence[] = [
  { summaryId: "frame-1", capturedAt: "2026-09-28T14:20:00.000Z", visibleApp: "VS Code", frameSummary: "Editing the activity interval engine in the repository.", usedInModel: true, rawImageShown: true, selectionReason: "first+raw", retained: true },
  { summaryId: "frame-2", capturedAt: "2026-09-28T14:41:00.000Z", visibleApp: "Windows Terminal", frameSummary: "Test output passing in the terminal.", usedInModel: true, rawImageShown: false, selectionReason: "app_transition", retained: true },
  { summaryId: "frame-3", capturedAt: "2026-09-28T15:02:00.000Z", visibleApp: "Google Chrome", frameSummary: "Companion Tasks tab open in the browser.", usedInModel: true, rawImageShown: false, selectionReason: "app_transition", retained: true },
  { summaryId: "frame-4", capturedAt: "2026-09-28T15:14:00.000Z", visibleApp: "VS Code", frameSummary: "Reviewing the diff before commit.", usedInModel: true, rawImageShown: true, selectionReason: "last+raw", retained: true },
];

const base = {
  promptKind: "hourly_fallback" as const,
  generationStatus: "ready" as const,
  generatedAt: "2026-09-28T15:18:00.000Z",
  failureReason: null,
};

const fixtures: ActivityInterval[] = [
  {
    ...base,
    id: "fixture-inferred",
    windowStart: "2026-09-28T14:17:00.000Z",
    windowEnd: "2026-09-28T15:17:00.000Z",
    label: "2:17–3:17 PM",
    reviewStatus: "inferred",
    headline: "Implementation and verification in the Work OS codebase",
    detail: "Worked in VS Code with terminal verification, then inspected the companion UI in the browser.",
    activities: [
      "2:20–2:41 PM — VS Code: editing the activity interval engine.",
      "2:41–3:02 PM — Terminal: running the recap tests.",
      "3:02–3:14 PM — Chrome: inspecting the companion Tasks stream.",
    ],
    workflow: ["implementation", "verification", "UI inspection"],
    uncertainties: ["whether the change was pushed", "whether the test run finished"],
    recordedActivity: [
      { description: "Pushed 3 commits to WrazyAI/work-os", relation: "performed", url: "https://github.com/WrazyAI/work-os/compare/abc123" },
      { description: "Pull request #42 (Recorded in GitHub on the recap card) merged", relation: "performed", url: "https://github.com/WrazyAI/work-os/pull/42" },
      { description: "CI for your commit on main: Work OS CI", relation: "triggered", url: "https://github.com/WrazyAI/work-os/actions/runs/1" },
    ],
    employeeFeedback: null,
    reviewedAt: null,
    evidenceExpired: false,
    evidenceCount: 4,
    evidence,
    coverage: { framesRecorded: 28, framesAnalyzed: 8 },
  },
  {
    ...base,
    id: "fixture-confirmed",
    windowStart: "2026-09-28T13:17:00.000Z",
    windowEnd: "2026-09-28T14:17:00.000Z",
    label: "1:17–2:17 PM",
    reviewStatus: "confirmed",
    headline: "Repository review and issue triage",
    detail: "Reviewed open pull requests and triaged the incoming issue list in the browser.",
    employeeFeedback: null,
    reviewedAt: "2026-09-28T14:20:00.000Z",
    evidenceExpired: false,
    evidenceCount: 3,
    evidence: evidence.slice(0, 3),
  },
  {
    ...base,
    id: "fixture-amended",
    windowStart: "2026-09-28T12:17:00.000Z",
    windowEnd: "2026-09-28T13:17:00.000Z",
    label: "12:17–1:17 PM",
    reviewStatus: "amended",
    headline: "Pairing session on the activity recap copy",
    detail: "Worked through the recap wording in the editor with a teammate.",
    employeeFeedback: "Also reviewed the deploy logs for the earlier release.",
    reviewedAt: "2026-09-28T13:25:00.000Z",
    evidenceExpired: false,
    evidenceCount: 2,
    evidence: evidence.slice(0, 2),
  },
  {
    ...base,
    id: "fixture-expired",
    windowStart: "2026-09-28T11:17:00.000Z",
    windowEnd: "2026-09-28T12:17:00.000Z",
    label: "11:17 AM–12:17 PM",
    reviewStatus: "inferred",
    headline: "Morning planning and inbox review",
    detail: "Planned the day and worked through the inbox. The screenshots for this interval have left retention.",
    employeeFeedback: null,
    reviewedAt: null,
    evidenceExpired: true,
    evidenceCount: 2,
    evidence: evidence.slice(0, 2).map((entry) => ({ ...entry, retained: false })),
  },
  {
    ...base,
    id: "fixture-unavailable",
    windowStart: "2026-09-28T10:17:00.000Z",
    windowEnd: "2026-09-28T11:17:00.000Z",
    label: "10:17–11:17 AM",
    generationStatus: "unavailable",
    reviewStatus: "inferred",
    headline: null,
    detail: null,
    employeeFeedback: null,
    reviewedAt: null,
    failureReason: "no_usable_frames",
    evidenceExpired: false,
    evidenceCount: 0,
    evidence: [],
  },
];

export default function ActivityIntervalPreview() {
  const [intervals, setIntervals] = useState(fixtures);
  const [editRequested, setEditRequested] = useState(false);
  // Seed the cache before the list mounts: a query with no data would start a
  // real fetch and its rejection could override the fixture.
  const client = useMemo(() => {
    const seeded = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    seeded.setQueryData(workOsKeys.activityIntervals(DATE), { date: DATE, intervals: fixtures });
    return seeded;
  }, []);
  useEffect(() => {
    client.setQueryData(workOsKeys.activityIntervals(DATE), { date: DATE, intervals });
  }, [client, intervals]);

  const decide = async (id: string, action: "confirm" | "amend", feedback?: string) => {
    setIntervals((current) => current.map((interval) => interval.id === id
      ? {
        ...interval,
        reviewStatus: action === "confirm" ? "confirmed" : "amended",
        employeeFeedback: action === "amend" ? (feedback ?? null) : interval.employeeFeedback,
        detail: action === "amend" && feedback ? `${interval.detail}\n\nEmployee addition: ${feedback}` : interval.detail,
        reviewedAt: "2026-09-28T15:30:00.000Z",
      }
      : interval));
  };

  const resolveSrc = (summaryId: string) => shot(summaryId.replace("frame-", "Frame "));

  return (
    <QueryClientProvider client={client}>
      <div className="avatar-window" style={{ width: 400, minHeight: "100vh", padding: 12, background: "var(--color-canvas, #eef1eb)" }}>
        <ActivityIntervalCard
          interval={intervals[0]}
          timezone="UTC"
          onDecide={decide}
          onEdit={() => setEditRequested(true)}
          resolveSrc={resolveSrc}
        />
        {editRequested ? (
          <div className="avatar-recap-edit" style={{ marginTop: 8 }}>
            <span>Editing your recap</span>
            <button type="button" onClick={() => setEditRequested(false)}>Cancel</button>
          </div>
        ) : null}
        <ActivityIntervalList
          date={DATE}
          enabled
          timezone="UTC"
          onDecide={decide}
          decidingId={null}
          resolveSrc={resolveSrc}
        />
      </div>
    </QueryClientProvider>
  );
}
