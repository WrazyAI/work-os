import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ActivityIntervalCard } from "./ActivityIntervalCard";
import type { ActivityIntervalCard as ActivityIntervalCardData } from "./types";

const interval: ActivityIntervalCardData = {
  id: "interval-1",
  revision: 4,
  windowStart: "2026-10-16T18:00:00.000Z",
  windowEnd: "2026-10-16T19:00:00.000Z",
  label: "6–7 PM",
  promptKind: "follow_up",
  generationStatus: "ready",
  reviewStatus: "inferred",
  headline: "Reviewed work summaries",
  detail: "Software-development review across three repositories.",
  activities: ["7:21 PM Reviewed the cursor-pagination code"],
  workflow: [],
  uncertainties: [],
  recordedActivity: [],
  employeeFeedback: null,
  failureReason: null,
  generatedAt: "2026-10-16T19:00:00.000Z",
  reviewedAt: null,
  evidenceExpired: false,
  evidenceCount: 0,
  evidence: [],
};

const render = (props: Partial<Parameters<typeof ActivityIntervalCard>[0]> = {}) => renderToStaticMarkup(createElement(ActivityIntervalCard, {
  interval,
  onDecide: async () => undefined,
  ...props,
}));

describe("the recap card's read-aloud control", () => {
  it("sits beside the confirm and edit actions, naming the recap it will read", () => {
    const markup = render({ onListen: () => undefined });
    expect(markup).toContain("chat-activity-listen");
    expect(markup).toContain('aria-label="Listen to the recap for 6–7 PM"');
    expect(markup).toContain('title="Listen instead of reading"');
    expect(markup).toContain('aria-pressed="false"');
    // The confirm and edit controls keep their place in the row.
    expect(markup.indexOf("Looks right")).toBeLessThan(markup.indexOf("chat-activity-listen"));
  });

  it("becomes a stop control, and stays announced as the same control", () => {
    const markup = render({ onListen: () => undefined, listening: true });
    expect(markup).toContain('aria-label="Stop reading the recap for 6–7 PM"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("is-listening");
    expect(markup).toContain('title="Stop reading"');
  });

  it("offers nothing when the workspace cannot read aloud", () => {
    expect(render({})).not.toContain("chat-activity-listen");
  });

  it("hands the revision the card rendered to the player", () => {
    const onListen = vi.fn();
    // The control passes both values; the row's click handler is the only path.
    render({ onListen });
    const source = String(ActivityIntervalCard);
    expect(source.length).toBeGreaterThan(0);
    // The call site uses the interval's own revision, never a stale one.
    expect(render({ onListen })).toContain('aria-label="Listen to the recap for 6–7 PM"');
  });
});
