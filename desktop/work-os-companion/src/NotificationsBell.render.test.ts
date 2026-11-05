import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NotificationsBell, outstandingRowMeta, type AdminNotificationFeed } from "./NotificationsBell";
import { adminPreviewOverview } from "./admin/adminFixtures";
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
    overdueTasks: 0,
    days: [],
    loading: false,
    error: null,
    open: false,
    onToggle: noop,
    onClose: noop,
    onSelect: noop,
    onOpenMemory: noop,
    onOpenRecap: noop,
    onOpenOverdue: noop,
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

  it("counts memories, a ready recap, overdue tasks, and outstanding EOD days together", () => {
    const markup = render({ memoryCandidates: 2, recap: { id: "recap-1", label: "2:00–3:00 PM" }, days });
    expect(markup).toContain('aria-label="Notifications, 5 items need attention"');
    expect(markup).toContain("notifications-bell-count");
    expect(markup).toContain(">5<");
    const withOverdue = render({ memoryCandidates: 1, overdueTasks: 2 });
    expect(withOverdue).toContain('aria-label="Notifications, 3 items need attention"');
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

  it("surfaces overdue tasks as a needs-attention row", () => {
    const markup = render({ overdueTasks: 2, open: true });
    expect(markup).toContain("Needs attention");
    expect(markup).toContain("2 tasks are overdue");
    expect(markup).toContain("Unfinished work past its due date");
    expect(markup).toContain("notifications-lead");
    expect(markup).toContain("2 overdue tasks");
  });

  it("says one task is overdue in the singular", () => {
    const markup = render({ overdueTasks: 1, open: true });
    expect(markup).toContain("1 task is overdue");
    expect(markup).toContain("1 overdue task");
  });

  it("shows the caught-up empty state only when nothing is waiting", () => {
    const empty = render({ open: true });
    expect(empty).toContain("caught up");
    const busy = render({ days, open: true });
    expect(busy).not.toContain("caught up");
  });
});

const admin: AdminNotificationFeed = {
  overview: adminPreviewOverview("dense"),
  loading: false,
  error: null,
  onRetry: noop,
  onNavigate: noop,
};

describe("NotificationsBell audiences", () => {
  it("keeps the single employee list when no administration record is supplied", () => {
    const markup = render({ open: true, memoryCandidates: 2 });
    expect(markup).not.toContain("notifications-tabs");
    expect(markup).toContain("This is what Otto remembers about you so far");
  });

  it("opens on the admin tab when the administration workspace is current", () => {
    const markup = render({ admin, defaultTab: "admin", open: true });
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('data-tab="admin"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain("2 EOD reports are waiting for review");
    expect(markup).toContain("5 open tasks are past their due date");
    expect(markup).toContain("Needs your decision");
    expect(markup).toContain("Today across the workspace");
    expect(markup).toContain("Recent team activity");
    expect(markup).toContain("Open the workspace overview");
    // The bell's badge and accessible name match the audience it will open on.
    expect(markup).toContain('aria-label="Notifications, 11 items need attention"');
    expect(markup).toContain(">9+<");
  });

  it("opens on the employee tab in the employee workspace even when admin data exists", () => {
    const markup = render({ admin, defaultTab: "employee", open: true, memoryCandidates: 2 });
    expect(markup).toContain("This is what Otto remembers about you so far");
    expect(markup).not.toContain("Needs your decision");
    expect(markup).toContain('aria-label="Notifications, 2 items need attention"');
  });

  it("renders the admin empty record without inventing decisions", () => {
    const empty = render({
      admin: { ...admin, overview: adminPreviewOverview("empty") },
      defaultTab: "admin",
      open: true,
    });
    expect(empty).toContain("caught up");
    expect(empty).toContain("No decisions are waiting.");
    expect(empty).toContain("No activity has been recorded today yet.");
    expect(empty).not.toContain("EOD reports are waiting for review");
  });

  it("keeps a retry path when the administration record fails to load", () => {
    const failed = render({
      admin: { ...admin, overview: null, loading: false, error: "Workspace notifications could not be loaded." },
      defaultTab: "admin",
      open: true,
    });
    expect(failed).toContain("Workspace notifications could not be loaded.");
    expect(failed).toContain("Try again");
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
