import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { ActivityIntervalCard, localDateKey, splitActivityTime } from "./ActivityIntervalCard";
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
    expect(markup).toContain('aria-label="Looks right"');
    expect(markup).toContain('aria-label="Add or correct"');
    expect(markup).toContain("lucide-check");
    expect(markup).toContain("lucide-pencil");
    expect(markup).toContain("Inferred from your screenshots");
  });

  it("renders scannable bullets, the ordered flow, and a collapsed Extra notes disclosure", () => {
    const markup = renderToStaticMarkup(createElement(ActivityIntervalCard, {
      interval: {
        ...baseInterval,
        detail: "Reviewed the recap card and its formatting contract.",
        activities: ["2:20 PM — VS Code: edited the recap card.", "2:45 PM — Terminal: ran the render tests."],
        workflow: ["implementation", "verification"],
        uncertainties: ["whether the change was pushed"],
      },
      timezone: "UTC",
    }));
    expect(markup).toContain("chat-activity-bullets");
    expect(markup).toContain("chat-activity-time-pill");
    expect(markup).toContain(">2:20 PM<");
    expect(markup).toContain("VS Code: edited the recap card.");
    expect(markup).toContain(">2:45 PM<");
    expect(markup).toContain("Terminal: ran the render tests.");
    expect(markup).not.toContain("2:20 PM — VS Code");
    expect(markup).toContain("chat-activity-flow");
    expect(markup).toContain(">Flow<");
    expect(markup).toContain("chat-activity-flow-chip");
    expect(markup).toContain(">implementation<");
    expect(markup).toContain(">verification<");
    expect(markup).toContain("chat-activity-panels");
    expect(markup).toContain("chat-activity-panel-button");
    expect(markup).toContain("Extra notes");
    expect(markup).toContain("whether the change was pushed");
    expect(markup).not.toContain("Not established:");
    expect(markup).toContain("chat-activity-panel-clip");
    expect(markup).not.toContain("is-open");
    expect(markup).toContain('aria-expanded="false"');
  });

  it("summarizes frame coverage inside the evidence disclosure", () => {
    const markup = renderToStaticMarkup(createElement(ActivityIntervalCard, {
      interval: { ...baseInterval, coverage: { framesRecorded: 28, framesAnalyzed: 8 } },
      timezone: "UTC",
    }));
    expect(markup).toContain("8 of 28 frames analyzed");
    const complete = renderToStaticMarkup(createElement(ActivityIntervalCard, {
      interval: { ...baseInterval, coverage: { framesRecorded: 8, framesAnalyzed: 8 } },
      timezone: "UTC",
    }));
    expect(complete).toContain("8 frames analyzed");
  });

  it("never claims a screenshot count from a compact payload", () => {
    const { evidence, evidenceCount, evidenceExpired, coverage, ...compact } = baseInterval;
    const markup = renderToStaticMarkup(createElement(ActivityIntervalCard, {
      interval: {
        ...compact,
        recordedActivity: [{ description: "Pushed a commit to main", relation: "performed", url: null }],
      },
      timezone: "UTC",
    }));
    expect(markup).toContain("1 GitHub event");
    expect(markup).not.toContain("0 screenshots");
  });

  it("keeps the lead-only fallback for older payloads without structure", () => {
    const markup = renderToStaticMarkup(createElement(ActivityIntervalCard, { interval: baseInterval, timezone: "UTC" }));
    expect(markup).not.toContain("chat-activity-bullets");
    expect(markup).toContain(String(baseInterval.detail));
  });

  it("renders provider-recorded GitHub activity with distinct relation labels", () => {
    const markup = renderToStaticMarkup(createElement(ActivityIntervalCard, {
      interval: {
        ...baseInterval,
        recordedActivity: [
          { description: "Pushed 3 commits to WrazyAI/work-os", relation: "performed", url: "https://github.com/WrazyAI/work-os/compare/abc123" },
          { description: "CI for your commit on main: Work OS CI", relation: "triggered", url: "https://github.com/WrazyAI/work-os/actions/runs/1" },
        ],
      },
      timezone: "UTC",
    }));
    expect(markup).toContain('aria-label="Evidence: 3 screenshots, 2 GitHub events"');
    expect(markup).toContain("chat-activity-panel-metric");
    expect(markup).toContain("chat-activity-panel-tooltip");
    expect(markup).toContain("3 screenshots · 2 GitHub events");
    expect(markup).toContain("lucide-camera");
    expect(markup).toContain("lucide-github");
    expect(markup).toContain("Screenshots</span>");
    expect(markup).toContain("chat-activity-panel-count\">3</span>");
    expect(markup).toContain("GitHub activity</span>");
    expect(markup).toContain("chat-activity-panel-count\">2</span>");
    expect(markup).toContain("Pushed 3 commits to WrazyAI/work-os");
    expect(markup).toContain("CI for your commit on main: Work OS CI");
    expect(markup).toContain("chat-activity-github-tag is-performed");
    expect(markup).toContain("chat-activity-github-tag is-triggered");
    expect(markup).toContain(">You<");
    expect(markup).toContain(">Your work<");
    expect(markup).toContain('href="https://github.com/WrazyAI/work-os/compare/abc123"');
    expect(markup).toContain('href="https://github.com/WrazyAI/work-os/actions/runs/1"');
    const githubEventPosition = markup.indexOf("Pushed 3 commits to WrazyAI/work-os");
    const enclosingSection = markup.lastIndexOf("<section", githubEventPosition);
    expect(markup.slice(enclosingSection, githubEventPosition)).toContain("GitHub activity");
  });

  it("keeps GitHub evidence available when the recap has no screenshots", () => {
    const markup = renderToStaticMarkup(createElement(ActivityIntervalCard, {
      interval: {
        ...baseInterval,
        evidence: [],
        evidenceCount: 0,
        recordedActivity: [
          { description: "Opened pull request #42", relation: "performed", url: "https://github.com/WrazyAI/work-os/pull/42" },
        ],
      },
    }));
    expect(markup).toContain("0 screenshots, 1 GitHub event");
    expect(markup).toContain("GitHub activity</span>");
    expect(markup).not.toContain("Screenshots</span>");
    const eventPosition = markup.indexOf("Opened pull request #42");
    const enclosingSection = markup.lastIndexOf("<section", eventPosition);
    expect(markup.slice(enclosingSection, eventPosition)).toContain("GitHub activity");
  });

  it("omits the GitHub section when no recorded activity is present", () => {
    const markup = renderToStaticMarkup(createElement(ActivityIntervalCard, { interval: baseInterval, timezone: "UTC" }));
    expect(markup).not.toContain("GitHub activity");
  });

  it("renders the chat bubble with Looks good / Edit actions", () => {
    const markup = renderToStaticMarkup(createElement(ActivityIntervalCard, {
      interval: baseInterval,
      timezone: "UTC",
      onDecide: async () => undefined,
      onEdit: () => undefined,
    }));
    expect(markup).toContain("Sounds good?");
    expect(markup).toContain('aria-label="Looks good"');
    expect(markup).toContain('aria-label="Edit"');
    expect(markup).toContain("lucide-check");
    expect(markup).toContain("lucide-pencil");
    expect(markup).toContain("Inferred from your screenshots");
    const notesPanelPosition = markup.indexOf('id="activity-notes-');
    const provenancePosition = markup.indexOf("Inferred from your screenshots");
    expect(notesPanelPosition).toBeGreaterThan(-1);
    expect(provenancePosition).toBeGreaterThan(notesPanelPosition);
    expect(markup).not.toContain("This is what we got from your last hour");
    expect(markup).not.toContain("Looks right");
    expect(markup).not.toContain("Add or correct");
    expect(markup).not.toContain("<textarea");
  });

  it("lists the exact analyzed frames in a hidden evidence panel", () => {
    const markup = renderToStaticMarkup(createElement(ActivityIntervalCard, { interval: baseInterval, timezone: "UTC" }));
    expect(markup).toContain("3 screenshots");
    expect(markup).toContain('id="activity-evidence-interval-1"');
    expect(markup).not.toContain("is-open");
    expect(markup).toContain("Editing the activity interval engine.");
    expect(markup).toContain("Companion Tasks tab open.");
    expect(markup).not.toContain("Looks right");
  });

  it("opens a panel only when its button asks for it", () => {
    const closed = renderToStaticMarkup(createElement(ActivityIntervalCard, { interval: baseInterval, timezone: "UTC" }));
    expect(closed).not.toContain("is-open");
    expect(closed).toContain('aria-hidden="true"');
    expect(closed).toContain('inert=""');
    expect(closed).toContain('style="height:0px"');
    const evidenceOpen = renderToStaticMarkup(createElement(ActivityIntervalCard, { interval: baseInterval, timezone: "UTC", defaultPanel: "evidence" }));
    expect(evidenceOpen).toContain('style="height:auto"');
    expect(evidenceOpen).toMatch(/is-open"[^>]*aria-hidden="false"><div class="chat-activity-panel" id="activity-evidence-/);
    const withNotes = { ...baseInterval, uncertainties: ["whether the change was pushed"] };
    const notesOpen = renderToStaticMarkup(createElement(ActivityIntervalCard, { interval: withNotes, timezone: "UTC", defaultPanel: "notes" }));
    expect(notesOpen).toMatch(/is-open"[^>]*aria-hidden="false"><div class="chat-activity-panel" id="activity-notes-/);
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

describe("splitActivityTime", () => {
  it("splits the leading clock time from the activity", () => {
    expect(splitActivityTime("2:20 PM — Edited the recap card in VS Code")).toEqual({ time: "2:20 PM", text: "Edited the recap card in VS Code" });
    expect(splitActivityTime("16:48 — Viewed the billing report")).toEqual({ time: "16:48", text: "Viewed the billing report" });
    expect(splitActivityTime("2:20–2:41 PM — VS Code: editing the engine.")).toEqual({ time: "2:20–2:41 PM", text: "VS Code: editing the engine." });
    expect(splitActivityTime("2:20 PM–2:41 PM: VS Code")).toEqual({ time: "2:20 PM–2:41 PM", text: "VS Code" });
  });

  it("keeps phrases without a leading time whole", () => {
    expect(splitActivityTime("Reviewed the billing report and the queue")).toEqual({ time: null, text: "Reviewed the billing report and the queue" });
    expect(splitActivityTime("30 minutes on the dossier")).toEqual({ time: null, text: "30 minutes on the dossier" });
    expect(splitActivityTime("2:20 PM")).toEqual({ time: null, text: "2:20 PM" });
    expect(splitActivityTime("2:20 PM — ")).toEqual({ time: null, text: "2:20 PM —" });
    expect(splitActivityTime("2:20 PM: ")).toEqual({ time: null, text: "2:20 PM:" });
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

  it("shows the View in app action only when the surface provides a handler", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(workOsKeys.activityIntervals("2026-09-28"), { date: "2026-09-28", intervals: [baseInterval] });
    const withHandler = renderToStaticMarkup(createElement(QueryClientProvider, { client: queryClient },
      createElement(ActivityIntervalList, {
        date: "2026-09-28",
        enabled: true,
        timezone: "UTC",
        onDecide: async () => undefined,
        decidingId: null,
        onViewInApp: () => undefined,
      }),
    ));
    expect(withHandler).toContain("View in app");
    const withoutHandler = renderToStaticMarkup(createElement(QueryClientProvider, { client: queryClient },
      createElement(ActivityIntervalList, {
        date: "2026-09-28",
        enabled: true,
        timezone: "UTC",
        onDecide: async () => undefined,
        decidingId: null,
      }),
    ));
    expect(withoutHandler).not.toContain("View in app");
  });
});
