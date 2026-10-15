import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { seedAdminFixtures } from "./admin/adminFixtures";
import { GroupedBars, ShareBars, StackedTimeBars, chartReadoutPlacement } from "./admin/charts";
import { adminKeys, isoDaysAgo, todayIso } from "./admin/data";
import { AdminCard, AdminControls, AdminControlsGroup, Avatar, Drawer, Pill, Segmented } from "./admin/ui";

describe("administration primitives", () => {
  it("gives a card's controls their own band under the title", () => {
    const markup = renderToStaticMarkup(createElement(AdminCard, {
      title: "Organization tasks",
      detail: "43 open · 5 overdue",
      controls: createElement(AdminControls, {
        children: [
          createElement(AdminControlsGroup, { key: "views", children: createElement("button", { type: "button" }, "Open") }),
          createElement(AdminControlsGroup, { key: "action", end: true, children: createElement("button", { type: "button" }, "Add task") }),
        ],
      }),
      children: "rows",
    }));
    const titleRow = markup.slice(markup.indexOf("admin-card-title"), markup.indexOf("admin-card-controls"));
    // The first row is the name and its one-line detail only.
    expect(titleRow).toContain("Organization tasks");
    expect(titleRow).toContain("43 open · 5 overdue");
    expect(titleRow).not.toContain("<button");
    expect(titleRow).not.toContain("<select");
    expect(titleRow).not.toContain("<input");
    expect(titleRow).not.toContain('role="group"');
    // The controls band renders between the title and the body, and the
    // group that carries the primary action keeps its is-end marker so it
    // stays last and right-aligns while the row has room.
    expect(markup.indexOf("admin-card-title")).toBeLessThan(markup.indexOf("admin-card-controls"));
    expect(markup.indexOf("admin-card-controls")).toBeLessThan(markup.indexOf("admin-card-body"));
    expect(markup).toContain('class="admin-controls"');
    expect(markup).toContain('class="admin-controls-group"');
    expect(markup).toContain('class="admin-controls-group is-end"');
    expect(markup.indexOf("Open")).toBeLessThan(markup.indexOf("Add task"));
  });

  it("omits the controls band entirely when a card has none", () => {
    const markup = renderToStaticMarkup(createElement(AdminCard, { title: "Data sources", detail: "quiet meta", children: "body" }));
    expect(markup).not.toContain("admin-card-controls");
  });
  it("renders pills with their tone and avatar initials", () => {
    const markup = renderToStaticMarkup(createElement("div", null,
      createElement(Pill, { tone: "ok", children: "On shift" }),
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
    const open = renderToStaticMarkup(createElement(Drawer, { open: true, onClose: () => undefined, title: "Ben Sato", subtitle: "ben@example.com", children: "body copy" }));
    expect(open).toContain('role="dialog"');
    expect(open).toContain('aria-modal="true"');
    expect(open).toContain("Ben Sato");
    expect(open).toContain("body copy");
    const closed = renderToStaticMarkup(createElement(Drawer, { open: false, onClose: () => undefined, title: "Closed", children: "hidden" }));
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

  it("makes each chart plot one keyboard-reachable readout target", () => {
    const stacked = renderToStaticMarkup(createElement(StackedTimeBars, {
      ariaLabel: "Observed work time per day",
      points: [
        { date: "2026-10-13", totalMinutes: 120, people: [{ personId: "p-1", name: "Amara Okafor", minutes: 120 }] },
        { date: "2026-10-14", totalMinutes: 60, people: [{ personId: "p-2", name: "Ben Sato", minutes: 60 }] },
      ],
    }));
    expect(stacked).toContain('role="group"');
    expect(stacked).toContain('tabindex="0"');
    expect(stacked).toContain("aria-describedby=");
    expect(stacked).toContain("2h observed");
    expect(stacked).toContain('class="admin-legend-button"');
    expect(stacked).toContain('aria-pressed="false"');
    expect(stacked).toContain("admin-chart-live");
    expect(stacked).toContain('role="status"');
    // The readout is decoration: it only exists while a point is active.
    expect(stacked).not.toContain("admin-chart-readout");

    const grouped = renderToStaticMarkup(createElement(GroupedBars, {
      ariaLabel: "counts",
      points: [{ label: "Oct 14", values: { outcomes: 3, updates: 2 } }],
      series: [{ key: "outcomes", label: "Outcomes", color: "var(--ink)" }, { key: "updates", label: "Updates", color: "#82bd39" }],
    }));
    expect(grouped).toContain('tabindex="0"');
    expect(grouped).toContain("admin-grouped");
    expect(grouped).toContain("admin-chart-live");

    const share = renderToStaticMarkup(createElement(ShareBars, {
      ariaLabel: "mix",
      items: [{ label: "Progress", value: 4 }, { label: "Blockers", value: 1, note: "minutes" }],
    }));
    expect(share).toContain("admin-chart-share");
    expect(share).toContain('tabindex="0"');
    expect(share).toContain("admin-chart-live");
  });

  it("pins the readout to the plot edge and caps the centred ones", () => {
    expect(chartReadoutPlacement(0, 14)).toEqual({ left: 0, edge: "start", maxWidth: "min(240px, 100%)" });
    expect(chartReadoutPlacement(13, 14)).toEqual({ left: 100, edge: "end", maxWidth: "min(240px, 100%)" });
    // 25% of the plot is outside the pinned fifth: the box stays on the column
    // and only caps its width.
    const quarter = chartReadoutPlacement(3, 14);
    expect(quarter.edge).toBeNull();
    expect(quarter.left).toBeCloseTo(25, 6);
    expect(quarter.maxWidth).toBe("min(240px, 50.00%)");
    const middle = chartReadoutPlacement(6, 14);
    expect(middle.edge).toBeNull();
    expect(middle.left).toBeCloseTo((6.5 / 14) * 100, 6);
    expect(middle.maxWidth).toBe(`min(240px, ${(((6.5 / 14) * 100) * 2).toFixed(2)}%)`);
    // A single column keeps the full plot width; a two-column chart keeps each
    // readout on its own column, half the plot wide at most.
    expect(chartReadoutPlacement(0, 1)).toEqual({ left: 50, edge: null, maxWidth: "min(240px, 100.00%)" });
    expect(chartReadoutPlacement(0, 2)).toEqual({ left: 25, edge: null, maxWidth: "min(240px, 50.00%)" });
    expect(chartReadoutPlacement(1, 2)).toEqual({ left: 75, edge: null, maxWidth: "min(240px, 50.00%)" });
    // Four columns already reach into the pinned fifth on both sides.
    expect(chartReadoutPlacement(0, 4).edge).toBe("start");
    expect(chartReadoutPlacement(3, 4).edge).toBe("end");
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
    expect(client.getQueryData(adminKeys.overview(todayIso()))).toBeTruthy();
    expect(client.getQueryData(adminKeys.people())).toBeTruthy();
    expect(client.getQueryData(adminKeys.person("p-2"))).toBeTruthy();
    expect(client.getQueryData(adminKeys.insights("7d", ""))).toBeTruthy();
    expect(client.getQueryData(adminKeys.reports({ status: "pending_review", personId: "", from: isoDaysAgo(30), to: todayIso() }))).toBeTruthy();
    expect(client.getQueryData(adminKeys.evidence({ personId: "", source: "", from: isoDaysAgo(13), to: todayIso(), correction: "", summary: "1", limit: "100" }))).toBeTruthy();
    expect(client.getQueryData(adminKeys.organization())).toBeTruthy();
    expect(client.getQueryData(adminKeys.tasks({ filter: "open", personId: "", projectId: "", limit: "200", completed: "false" }))).toBeTruthy();
  });
});
