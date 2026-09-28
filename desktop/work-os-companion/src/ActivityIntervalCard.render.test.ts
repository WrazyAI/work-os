import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { ActivityIntervalCard, localDateKey } from "./ActivityIntervalCard";
import { ActivityIntervalList } from "./ActivityIntervalList";
import { workOsKeys } from "./queryClient";
import type { ActivityInterval } from "./types";

const baseInterval: ActivityInterval = {
  id: "interval-1",
  windowStart: "2026-09-28T14:17:00.000Z",
  windowEnd: "2026-09-28T15:17:00.000Z",
  label: "2:17–3:17 PM",
  promptKind: "hourly_fallback",
  generationStatus: "ready",
  reviewStatus: "inferred",
  headline: "Implementation and verification in the Work OS codebase",
  detail: "Worked in VS Code with terminal verification, then inspected the companion UI in the browser. The screenshots do not establish whether the change was pushed.",
  employeeFeedback: null,
  failureReason: null,
  generatedAt: "2026-09-28T15:18:00.000Z",
  reviewedAt: null,
  evidenceExpired: false,
  evidenceCount: 3,
  evidence: [
    { summaryId: "frame-1", capturedAt: "2026-09-28T14:20:00.000Z", visibleApp: "VS Code", frameSummary: "Editing the activity interval engine.", usedInModel: true, rawImageShown: true, selectionReason: "first+raw", retained: true },
    { summaryId: "frame-2", capturedAt: "2026-09-28T14:45:00.000Z", visibleApp: "Windows Terminal", frameSummary: "Test output passing.", usedInModel: true, rawImageShown: false, selectionReason: "app_transition", retained: true },
    { summaryId: "frame-3", capturedAt: "2026-09-28T15:10:00.000Z", visibleApp: "Google Chrome", frameSummary: "Companion Tasks tab open.", usedInModel: true, rawImageShown: false, selectionReason: "last", retained: true },
  ],
};

describe("ActivityIntervalCard", () => {
  it("renders an inferred recap with provenance and both review actions", () => {
    const markup = renderToStaticMarkup(createElement(ActivityIntervalCard, {
      interval: baseInterval,
      timezone: "UTC",
      currentDate: "2026-09-28",
      onDecide: async () => undefined,
    }));
    expect(markup).toContain("2:17–3:17 PM");
    expect(markup).toContain("Not reviewed");
    expect(markup).toContain("Implementation and verification in the Work OS codebase");
    expect(markup).toContain("do not establish whether the change was pushed");
    expect(markup).toContain("Looks right");
    expect(markup).toContain("Add or correct");
    expect(markup).toContain("Inferred from your screenshots");
  });

  it("lists the exact analyzed frames in a collapsed evidence disclosure", () => {
    const markup = renderToStaticMarkup(createElement(ActivityIntervalCard, { interval: baseInterval, timezone: "UTC" }));
    expect(markup).toContain("Evidence · 3 screenshots");
    expect(markup).toContain("<details");
    expect(markup).not.toContain("<details class=\"chat-activity-evidence\" open");
    expect(markup).toContain("Editing the activity interval engine.");
    expect(markup).toContain("Companion Tasks tab open.");
    expect(markup).not.toContain("Looks right");
  });

  it("renders a confirmed recap as an employee-accepted record without actions", () => {
    const markup = renderToStaticMarkup(createElement(ActivityIntervalCard, {
      interval: { ...baseInterval, reviewStatus: "confirmed", reviewedAt: "2026-09-28T15:20:00.000Z" },
      onDecide: async () => undefined,
    }));
    expect(markup).toContain("Confirmed");
    expect(markup).not.toContain("Looks right");
    expect(markup).not.toContain("Add or correct");
  });

  it("renders an amended recap with the employee note and no actions", () => {
    const markup = renderToStaticMarkup(createElement(ActivityIntervalCard, {
      interval: { ...baseInterval, reviewStatus: "amended", employeeFeedback: "Also reviewed the deploy logs." },
      onDecide: async () => undefined,
    }));
    expect(markup).toContain("Updated by you");
    expect(markup).toContain("Also reviewed the deploy logs.");
    expect(markup).not.toContain("Looks right");
  });

  it("degrades honestly when screenshots expired and when no recap exists", () => {
    const expired = renderToStaticMarkup(createElement(ActivityIntervalCard, {
      interval: { ...baseInterval, evidence: baseInterval.evidence.map((entry) => ({ ...entry, retained: false })), evidenceExpired: true },
    }));
    expect(expired).toContain("Screenshots expired under the 30-day retention policy");
    expect(expired).not.toContain("eod-shot-thumb");
    const unavailable = renderToStaticMarkup(createElement(ActivityIntervalCard, {
      interval: { ...baseInterval, generationStatus: "unavailable", failureReason: "no_usable_frames" },
    }));
    expect(unavailable).toContain("No recap");
    expect(unavailable).toContain("No usable activity frames were available for this interval.");
    expect(unavailable).not.toContain("Looks right");
  });

  it("shows the calendar date only for older intervals", () => {
    const sameDay = renderToStaticMarkup(createElement(ActivityIntervalCard, { interval: baseInterval, timezone: "UTC", currentDate: "2026-09-28" }));
    expect(sameDay).not.toContain("September 28, 2026");
    const older = renderToStaticMarkup(createElement(ActivityIntervalCard, { interval: baseInterval, timezone: "UTC", currentDate: "2026-09-29" }));
    expect(older).toContain("September 28, 2026");
  });
});

describe("localDateKey", () => {
  it("resolves the employee-local calendar day", () => {
    expect(localDateKey("2026-09-28T23:30:00.000Z", "America/New_York")).toBe("2026-09-28");
    expect(localDateKey("2026-09-29T02:30:00.000Z", "America/New_York")).toBe("2026-09-28");
    expect(localDateKey("not-a-date", "UTC")).toBeNull();
  });
});

describe("ActivityIntervalList", () => {
  it("renders recaps newest first with an honest empty state", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(workOsKeys.activityIntervals("2026-09-28"), {
      date: "2026-09-28",
      intervals: [
        { ...baseInterval, id: "newest", label: "3–4 PM" },
        { ...baseInterval, id: "oldest", label: "2–3 PM", reviewStatus: "confirmed" as const },
      ],
    });
    const markup = renderToStaticMarkup(createElement(QueryClientProvider, { client: queryClient },
      createElement(ActivityIntervalList, {
        date: "2026-09-28",
        enabled: true,
        timezone: "UTC",
        onDecide: async () => undefined,
        decidingId: null,
      }),
    ));
    expect(markup).toContain("Recent activity");
    expect(markup.indexOf("3–4 PM")).toBeLessThan(markup.indexOf("2–3 PM"));
    expect(markup).toContain("Confirmed");

    queryClient.setQueryData(workOsKeys.activityIntervals("2026-09-28"), { date: "2026-09-28", intervals: [] });
    const empty = renderToStaticMarkup(createElement(QueryClientProvider, { client: queryClient },
      createElement(ActivityIntervalList, {
        date: "2026-09-28",
        enabled: true,
        timezone: "UTC",
        onDecide: async () => undefined,
        decidingId: null,
      }),
    ));
    expect(empty).toContain("No activity recaps yet.");
  });
});
