import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { NotificationProvider } from "../NotificationFlyouts";
import OverviewPage from "./OverviewPage";
import { seedAdminFixtures } from "./adminFixtures";
import { adminKeys, todayIso } from "./data";
import type { AdminOverview } from "./types";

function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seedAdminFixtures(client, "dense");
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client },
      createElement(NotificationProvider, null,
        createElement(OverviewPage, {
          onOpenSection: () => undefined,
          onOpenPerson: () => undefined,
          onOpenRecaps: () => undefined,
        }))),
  );
}

describe("administration overview measures", () => {
  it("names the generated recaps instead of the old updates count", () => {
    const markup = render();
    expect(markup).toContain("Recaps today");
    expect(markup).not.toContain("Updates today");
    expect(markup).toContain("Recaps per day over the last 14 days");
    expect(markup).toContain("3 reviewed · 6 waiting");
  });

  it("makes every measure a control that names where it leads", () => {
    const markup = render();
    expect(markup).toContain('aria-label="On shift now: 4, 1 paused · 8 teammates. Show the Right now table"');
    expect(markup).toContain('aria-label="Recaps today: 9, 3 reviewed · 6 waiting. Open Admin Otto recaps"');
    expect(markup).toContain('aria-label="Outcomes today: 6, 43 open · 5 overdue. Open Tasks"');
    expect(markup).toContain('aria-label="Awaiting review: 2, oldest 7h ago. Open EOD Review"');
    expect(markup).toContain('aria-label="Evidence today: 24, 3 output · 21 activity. Open Evidence"');
    expect(markup.match(/class="insight-kpi is-action"/g)).toHaveLength(5);
  });

  it("keeps the fixture's card total equal to its per-person rows", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedAdminFixtures(client, "dense");
    const overview = client.getQueryData<AdminOverview>(adminKeys.overview(todayIso()));
    expect(overview).toBeTruthy();
    expect(overview!.counts.recapsToday).toBe(overview!.people.reduce((sum, person) => sum + person.recapsToday, 0));
    expect(overview!.counts.recapsReviewedToday).toBe(overview!.people.reduce((sum, person) => sum + person.recapsReviewedToday, 0));
  });

  it("keeps the Right now table as the scroll target and counts each person's recaps", () => {
    const markup = render();
    expect(markup).toContain('role="region"');
    expect(markup).toContain('aria-label="Right now: teammates and their status"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain("Last recap");
    expect(markup).not.toContain("Last update");
    expect(markup).toContain("recap");
    expect(markup).not.toContain("update ·");
  });
});
