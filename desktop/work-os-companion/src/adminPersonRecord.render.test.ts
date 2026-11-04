import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { NotificationProvider } from "./NotificationFlyouts";
import { seedAdminFixtures } from "./admin/adminFixtures";
import { adminKeys, todayIso } from "./admin/data";
import PeoplePage from "./admin/PeoplePage";

function renderRecord(detail: Record<string, unknown>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seedAdminFixtures(client, "dense");
  client.setQueryData(adminKeys.person("p-1"), detail);
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client },
      createElement(NotificationProvider, null,
        createElement(PeoplePage, {
          initialPersonId: "p-1",
          onOpenSection: () => undefined,
          onOpenRecaps: () => undefined,
        }))),
  );
}

function personDetail(overrides: Record<string, unknown> = {}) {
  const today = todayIso();
  return {
    person: {
      id: "p-1",
      display_name: "Amara Okafor",
      email: "amara@example.com",
      role_profile_id: "role-design",
      role_profile: { id: "role-design", name: "Design" },
      nifty_member_id: "nifty-p-1",
      worktivity_employee_id: "wt-p-1",
      active: true,
    },
    teams: [],
    schedules: [{ shift_start: "09:00", shift_end: "17:30", timezone: "Europe/Berlin", effective_from: "2026-08-14T00:00:00.000Z" }],
    exceptions: [],
    sessions: [
      { shift_date: today, state: "active", observed_seconds: 7200, clocked_in_at: `${today}T07:00:00Z` },
      { shift_date: today, state: "active", observed_seconds: 1800, clocked_in_at: `${today}T12:00:00Z` },
      { shift_date: "2026-11-03", state: "closed", observed_seconds: 5400, clocked_in_at: "2026-11-03T07:00:00Z" },
    ],
    recapDays: [
      { date: today, total: 3, reviewed: 1 },
      { date: "2026-11-03", total: 1, reviewed: 1 },
    ],
    reports: [
      { id: "report-today", report_date: today, status: "pending_review", submitted_at: `${today}T17:00:00Z` },
    ],
    updates: [],
    intervals: [
      {
        id: "recap-1",
        local_date: today,
        window_start: `${today}T07:00:00Z`,
        window_end: `${today}T08:00:00Z`,
        generation_status: "ready",
        review_status: "confirmed",
        headline: "Reviewed the settings IA and the mapping states.",
        timezone: "Europe/Berlin",
      },
      {
        id: "recap-2",
        local_date: today,
        window_start: `${today}T08:00:00Z`,
        window_end: `${today}T09:00:00Z`,
        generation_status: "ready",
        review_status: "inferred",
        headline: "Worked through the provider mapping review.",
        timezone: "Europe/Berlin",
      },
    ],
    evidenceSummary: { total: 146, activity: 120, output: 26, disputed: 0 },
    ...overrides,
  };
}

describe("admin person record", () => {
  it("renders the day's measures as real destinations and the workday record", () => {
    const markup = renderRecord(personDetail());

    expect(markup).toContain('aria-label="Open recaps in Admin Otto: 3"');
    expect(markup).toContain('aria-label="Open completed tasks for this person: 2"');
    expect(markup).toContain('aria-label="Open evidence for this person: 0"');
    expect(markup).toContain("Open today&#x27;s EOD report: Pending review");
    expect(markup).toContain("View all recaps");
    expect(markup).toContain("View all reports");
    expect(markup).toContain("Reviewed the settings IA and the mapping states.");
    expect(markup).toContain("Worked through the provider mapping review.");
    expect(markup).toContain('aria-label="Open EOD report for');

    // The workday is grouped: three sessions across two days become two rows,
    // with the day's observed time and exact recap count.
    expect(markup).toContain("2h 30m");
    expect(markup).toContain("1h 30m");
    expect(markup).toContain("3 recaps · 1 reviewed");
    expect(markup).toContain("1 recap · 1 reviewed");
  });

  it("keeps EOD blank when no report exists and names an empty recap day", () => {
    const markup = renderRecord(personDetail({
      intervals: [],
      recapDays: [],
      reports: [],
    }));

    expect(markup).not.toContain("Open today&#x27;s EOD report");
    expect(markup).not.toContain("Outstanding");
    expect(markup).toContain("No recaps recorded today.");
  });
});
