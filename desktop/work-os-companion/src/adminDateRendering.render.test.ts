import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { NotificationProvider } from "./NotificationFlyouts";
import { seedAdminFixtures } from "./admin/adminFixtures";
import { adminKeys } from "./admin/data";
import PeoplePage from "./admin/PeoplePage";

/** ISO timestamps must never reach rendered administration text. The live
 * record serializes SQL dates as instants at UTC midnight ("2026-10-16T00:
 * 00:00.000Z"); the person drawer must read them as calendar days. */
const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}T/;

function renderPersonRecord() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seedAdminFixtures(client, "dense");
  // Override one person with the instant-shaped payload the live API returns
  // for a schedule and its workdays.
  client.setQueryData(adminKeys.person("p-1"), {
    person: { id: "p-1", display_name: "Amara Okafor", email: "amara@example.com", active: true },
    teams: [],
    schedules: [{ start: "09:00", end: "17:30", timezone: "Atlantic/Reykjavik", effective_from: "2026-08-14T00:00:00.000Z" }],
    exceptions: [],
    sessions: [
      { shift_date: "2026-10-16T00:00:00.000Z", state: "closed", observed_seconds: 7200, updates: 3 },
      { shift_date: "2026-10-15", state: "closed", observed_seconds: 3600, updates: 1 },
    ],
    reports: [{ id: "rep-1", report_date: "2026-10-15T00:00:00.000Z", status: "approved" }],
    updates: [],
    intervals: [],
    evidenceSummary: { total: 2, activity: 2, output: 0, disputed: 0 },
  });
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client },
      createElement(NotificationProvider, null,
        createElement(PeoplePage, { initialPersonId: "p-1" }))),
  );
}

describe("administration person record date rendering", () => {
  it("reads serialized dates as letter-month dates and never echoes an ISO instant", () => {
    const markup = renderPersonRecord();
    expect(markup).toContain("Atlantic/Reykjavik · from Aug 14, 2026");
    expect(markup).toContain("Oct 16, 2026");
    expect(markup).toContain("Oct 15, 2026");
    expect(markup).not.toContain("T00:00:00");
    expect(markup).not.toMatch(ISO_TIMESTAMP);
  });
});
