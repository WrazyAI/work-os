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

describe("administration overview signal board", () => {
  it("leads with the last seven workdays and makes every measure a control", () => {
    const markup = render();
    expect(markup).toContain("Last seven workdays against the seven before");
    expect(markup).toContain('aria-label="Outcomes: 21 in the last seven workdays, level with prior 7. Open Tasks"');
    expect(markup).toContain('aria-label="Updates: 54 in the last seven workdays, 4% above prior 7. Open People"');
    expect(markup).toContain('aria-label="Recaps: 35 in the last seven workdays, level with prior 7. Open Admin Otto recaps"');
    expect(markup).toContain('aria-label="Evidence: 142 in the last seven workdays, 1% above prior 7. Open Evidence"');
    expect(markup.match(/class="ovp-pulse-cell"/g)).toHaveLength(4);
    expect(markup).not.toContain("Recaps today");
    expect(markup).not.toContain("Updates today");
  });

  it("keeps the trend's exact-value fallback and full-day readout", () => {
    const markup = render();
    expect(markup).toContain("Use the left and right arrow keys to review each workday.");
    expect(markup).toContain("Outcomes per workday with the full daily record");
    expect(markup).toContain("Observed minutes");
    expect(markup).toContain("14-day mean");
    expect(markup).toContain("days above mean");
  });

  it("shows the live shape, people, decisions, and observed time without the heatmap", () => {
    const markup = render();
    expect(markup).toContain("Right now");
    expect(markup).toContain("Oldest waiting report");
    expect(markup).toContain("Day close");
    expect(markup).toContain("Today, by person");
    expect(markup).toContain("Needs a decision");
    expect(markup).toContain("1 evidence item is disputed and needs a decision.");
    expect(markup).toContain("Observed time");
    expect(markup).toContain("Observed work time per workday for the last 14 workdays, split by teammate");
    expect(markup).toContain("Sources and freshness");
    expect(markup).not.toContain("Consistency across the fortnight");
  });

  it("keeps the fixture's recap total equal to its per-person rows", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedAdminFixtures(client, "dense");
    const overview = client.getQueryData<AdminOverview>(adminKeys.overview(todayIso()));
    expect(overview).toBeTruthy();
    expect(overview!.counts.recapsToday).toBe(overview!.people.reduce((sum, person) => sum + person.recapsToday, 0));
    expect(overview!.counts.recapsReviewedToday).toBe(overview!.people.reduce((sum, person) => sum + person.recapsReviewedToday, 0));
  });
});
