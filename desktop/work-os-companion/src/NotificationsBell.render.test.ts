import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NotificationsBell, outstandingRowMeta } from "./NotificationsBell";
import type { OutstandingEodDay } from "./types";

const noop = () => undefined;
const days: OutstandingEodDay[] = [
  { date: "2026-09-10", status: "draft_unsubmitted", reportId: "r-1", observedMinutes: 290, completedTasks: 10, hasPlan: true },
  { date: "2026-09-08", status: "no_draft", reportId: null, observedMinutes: 319, completedTasks: 7, hasPlan: true },
];

type Props = Parameters<typeof NotificationsBell>[0];

function render(overrides: Partial<Props> = {}) {
  return renderToStaticMarkup(createElement(NotificationsBell, {
    memoryCandidates: 0,
    recap: null,
    days: [],
    loading: false,
    error: null,
    open: false,
    onToggle: noop,
    onClose: noop,
    onSelect: noop,
    onOpenMemory: noop,
    onOpenRecap: noop,
    onRetry: noop,
    ...overrides,
  }));
}

describe("NotificationsBell trigger", () => {
  it("hides the count when nothing is waiting", () => {
    const markup = render();
    expect(markup).toContain('aria-label="Notifications"');
    expect(markup).not.toContain("notifications-bell-count");
  });

  it("counts memories, a ready recap, and outstanding EOD days together", () => {
    const markup = render({ memoryCandidates: 2, recap: { id: "recap-1", label: "2:00–3:00 PM" }, days });
    expect(markup).toContain('aria-label="Notifications, 5 items need attention"');
    expect(markup).toContain("notifications-bell-count");
    expect(markup).toContain(">5<");
  });
});

describe("NotificationsBell panel", () => {
  it("lists the memory reminder with the agent mark and a Review action", () => {
    const markup = render({ memoryCandidates: 3, open: true });
    expect(markup).toContain('aria-label="Notifications"');
    expect(markup).toContain("This is what Otto remembers about you so far");
    expect(markup).toContain("3 proposed facts waiting for your review");
    expect(markup).toContain("notifications-mascot");
    expect(markup).toContain("Review");
    expect(markup).toContain("3 memories to review");
  });

  it("lists the ready recap with its interval label", () => {
    const markup = render({ recap: { id: "recap-1", label: "2:00–3:00 PM" }, open: true });
    expect(markup).toContain("Your recap is ready");
    expect(markup).toContain("2:00–3:00 PM is ready to confirm or correct");
  });

  it("keeps the outstanding EOD rows with their status pills", () => {
    const markup = render({ days, open: true });
    expect(markup).toContain("Outstanding EODs");
    expect(markup).toContain("Thursday · 4h 50m observed · 10 task outcomes");
    expect(markup).toContain("eod-pill");
  });

  it("shows the caught-up empty state only when nothing is waiting", () => {
    const empty = render({ open: true });
    expect(empty).toContain("caught up");
    const busy = render({ days, open: true });
    expect(busy).not.toContain("caught up");
  });
});

describe("outstandingRowMeta", () => {
  it("names the weekday, observed time, and outcomes", () => {
    expect(outstandingRowMeta(days[0]!)).toBe("Thursday · 4h 50m observed · 10 task outcomes");
  });

  it("omits empty observed and outcome segments", () => {
    expect(outstandingRowMeta({ ...days[0]!, observedMinutes: 0, completedTasks: 0 })).toBe("Thursday");
  });

  it("never renders an invalid date", () => {
    expect(outstandingRowMeta({ ...days[0]!, date: "not-a-date" })).toBe("4h 50m observed · 10 task outcomes");
  });
});
