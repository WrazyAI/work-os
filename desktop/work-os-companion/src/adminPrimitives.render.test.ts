import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { seedAdminFixtures } from "./admin/adminFixtures";
import { GroupedBars, ShareBars, StackedTimeBars } from "./admin/charts";
import { adminKeys } from "./admin/data";
import { Avatar, Drawer, Pill, Segmented } from "./admin/ui";

describe("administration primitives", () => {
  it("renders pills with their tone and avatar initials", () => {
    const markup = renderToStaticMarkup(createElement("div", null,
      createElement(Pill, { tone: "ok" }, "On shift"),
      createElement(Avatar, { name: "Amara Okafor", size: 30 }),
    ));
    expect(markup).toContain("admin-pill ok");
    expect(markup).toContain("On shift");
    expect(markup).toContain(">AO<");
  });

  it("marks the segmented filter's current option with aria-pressed", () => {
    const markup = renderToStaticMarkup(createElement(Segmented<"open" | "all">, {
      value: "open",
      onChange: () => undefined,
      ariaLabel: "Task filter",
      options: [{ value: "open", label: "Open", count: 43 }, { value: "all", label: "All" }],
    }));
    expect(markup).toContain('aria-label="Task filter"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain(">43<");
  });

  it("renders a drawer as a labelled modal only while open", () => {
    const open = renderToStaticMarkup(createElement(Drawer, { open: true, onClose: () => undefined, title: "Ben Sato", subtitle: "ben@example.com" }, "body copy"));
    expect(open).toContain('role="dialog"');
    expect(open).toContain('aria-modal="true"');
    expect(open).toContain("Ben Sato");
    expect(open).toContain("body copy");
    const closed = renderToStaticMarkup(createElement(Drawer, { open: false, onClose: () => undefined, title: "Closed" }, "hidden"));
    expect(closed).not.toContain("dialog");
  });

  it("draws the stacked time chart with a named legend and exact values", () => {
    const markup = renderToStaticMarkup(createElement(StackedTimeBars, {
      ariaLabel: "Observed work time per day",
      points: [
        { date: "2026-10-13", totalMinutes: 120, people: [{ personId: "p-1", name: "Amara Okafor", minutes: 120 }] },
        { date: "2026-10-14", totalMinutes: 60, people: [{ personId: "p-2", name: "Ben Sato", minutes: 60 }] },
      ],
    }));
    expect(markup).toContain("admin-stack-col");
    expect(markup).toContain("Amara Okafor");
    expect(markup).toContain("2h");
  });

  it("stays quiet when a chart has nothing to draw", () => {
    expect(renderToStaticMarkup(createElement(StackedTimeBars, { ariaLabel: "time", points: [{ date: "2026-10-14", totalMinutes: 0, people: [] }] }))).toContain("No observed work time");
    expect(renderToStaticMarkup(createElement(ShareBars, { ariaLabel: "mix", items: [] }))).toContain("Nothing to summarise");
    expect(renderToStaticMarkup(createElement(GroupedBars, {
      ariaLabel: "counts",
      points: [{ label: "Oct 14", values: { outcomes: 0, updates: 0 } }],
      series: [{ key: "outcomes", label: "Outcomes", color: "var(--ink)" }, { key: "updates", label: "Updates", color: "#82bd39" }],
    }))).toContain("Nothing was recorded");
  });

  it("seeds the preview fixtures for every administration surface", () => {
    const client = new QueryClient();
    seedAdminFixtures(client, "dense");
    expect(client.getQueryData(adminKeys.overview("2026-10-14"))).toBeTruthy();
    expect(client.getQueryData(adminKeys.people())).toBeTruthy();
    expect(client.getQueryData(adminKeys.person("p-2"))).toBeTruthy();
    expect(client.getQueryData(adminKeys.insights("7d", ""))).toBeTruthy();
    expect(client.getQueryData(adminKeys.reports({ status: "pending_review", personId: "", from: "2026-10-01", to: "2026-10-14" }))).toBeTruthy();
    expect(client.getQueryData(adminKeys.evidence({ personId: "", source: "", from: "2026-10-01", to: "2026-10-14", disputed: "", limit: "100" }))).toBeTruthy();
    expect(client.getQueryData(adminKeys.organization())).toBeTruthy();
    expect(client.getQueryData(adminKeys.tasks({ filter: "open", personId: "", projectId: "", limit: "200", completed: "false" }))).toBeTruthy();
  });
});
