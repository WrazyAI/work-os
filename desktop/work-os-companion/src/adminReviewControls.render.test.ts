import { createElement } from "react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { NotificationProvider } from "./NotificationFlyouts";
import { adminKeys, isoDaysAgo, todayIso } from "./admin/data";
import { formatWorkOsFullDate } from "./dateFormat";
import ReviewPage, { ReportRangeControl, sortReportsNewestFirst } from "./admin/ReviewPage";
import type { ReportsResponse, WorkOsReportRow } from "./admin/types";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readText = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

/** One report row with every field a live payload carries. */
function report(id: string, overrides: Partial<WorkOsReportRow> = {}): WorkOsReportRow {
  return {
    id,
    person_id: null,
    report_date: "2026-10-01",
    status: "pending_review",
    title: id,
    markdown: "Goal: keep the week's outcomes moving",
    submitted_markdown: null,
    metrics: null,
    manager_notes: null,
    submitted_at: null,
    reviewed_at: null,
    created_at: "2026-10-01T08:00:00.000Z",
    person: null,
    ...overrides,
  };
}

function renderQueue(rows: WorkOsReportRow[], options: { status?: string; initialReportId?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const status = options.status ?? "pending_review";
  client.setQueryData(
    adminKeys.reports({ status: status === "all" ? "" : status, personId: "", from: isoDaysAgo(30), to: todayIso() }),
    { reports: rows, counts: { draft: 0, pending_review: rows.length, approved: 0, rejected: 0, total: rows.length } } satisfies ReportsResponse,
  );
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(NotificationProvider, null, createElement(ReviewPage, { initialReportId: options.initialReportId }))),
  );
}

function bodyOf(markup: string) {
  const start = markup.indexOf("<tbody>");
  const end = markup.indexOf("</tbody>");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return markup.slice(start + "<tbody>".length, end);
}

describe("review queue order", () => {
  it("sorts newest submission first, falls back to the report date, and puts missing values last", () => {
    const sorted = sortReportsNewestFirst([
      report("r-old", { report_date: "2026-10-01", submitted_at: "2026-10-01T09:00:00.000Z" }),
      report("r-new", { report_date: "2026-10-03", submitted_at: "2026-10-03T09:00:00.000Z" }),
      report("r-draft", { report_date: "2026-10-02" }),
      report("r-undated", { report_date: "" }),
    ]);
    expect(sorted.map((row) => row.id)).toEqual(["r-new", "r-draft", "r-old", "r-undated"]);
  });

  it("breaks equal clocks by report date then id so the order never jitters", () => {
    const sorted = sortReportsNewestFirst([
      report("b", { report_date: "2026-10-02", submitted_at: "2026-10-03T09:00:00.000Z" }),
      report("c", { report_date: "2026-10-01", submitted_at: "2026-10-03T09:00:00.000Z" }),
      report("a", { report_date: "2026-10-02", submitted_at: "2026-10-03T09:00:00.000Z" }),
    ]);
    expect(sorted.map((row) => row.id)).toEqual(["a", "b", "c"]);
  });

  it("renders the queue newest-first from unsorted rows", () => {
    const markup = renderQueue([
      report("r-old", { report_date: "2026-10-01", submitted_at: "2026-10-01T09:00:00.000Z", title: "Oldest submission" }),
      report("r-undated", { report_date: "", title: "Undated row" }),
      report("r-new", { report_date: "2026-10-03", submitted_at: "2026-10-03T09:00:00.000Z", title: "Newest submission" }),
      report("r-draft", { report_date: "2026-10-02", title: "Draft day" }),
    ]);
    const body = bodyOf(markup);
    const order = ["Newest submission", "Draft day", "Oldest submission", "Undated row"].map((title) => body.indexOf(title));
    for (const at of order) expect(at).toBeGreaterThan(-1);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("still opens the deep-linked report whatever its place in the order", () => {
    const markup = renderQueue([
      report("r-new", { report_date: "2026-10-03", submitted_at: "2026-10-03T09:00:00.000Z", title: "Newest submission" }),
      report("r-old", {
        report_date: "2026-10-01",
        submitted_at: "2026-10-01T09:00:00.000Z",
        title: "Oldest submission",
        person: { id: "p-old", display_name: "Casey Old", email: null },
      }),
    ], { status: "all", initialReportId: "r-old" });
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain("Casey Old");
    const body = bodyOf(markup);
    expect(body.indexOf("Newest submission")).toBeLessThan(body.indexOf("Oldest submission"));
  });

  it("keeps the card detail line to the counts and puts the range on the control", () => {
    const markup = renderQueue([report("r-1")]);
    const title = markup.slice(markup.indexOf("admin-card-title"), markup.indexOf("admin-card-controls"));
    expect(title).toContain("awaiting review");
    expect(title).not.toContain(formatWorkOsFullDate(isoDaysAgo(30)));
    expect(markup).toContain(`>${formatWorkOsFullDate(isoDaysAgo(30))} – ${formatWorkOsFullDate(todayIso())}<`);
  });
});

describe("review range control", () => {
  it("shows the current range in letter months on one button", () => {
    const markup = renderToStaticMarkup(createElement(ReportRangeControl, {
      from: "2026-09-16",
      to: "2026-10-16",
      onFromChange: () => undefined,
      onToChange: () => undefined,
    }));
    expect(markup).toContain("Sep 16, 2026 – Oct 16, 2026");
    expect(markup).toContain('class="admin-range-button"');
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain("admin-range-popup");
    expect(markup).not.toContain("<input");
  });

  it("opens as a labelled dialog holding the native pickers and a Done action", () => {
    const markup = renderToStaticMarkup(createElement(ReportRangeControl, {
      from: "2026-09-16",
      to: "2026-10-16",
      onFromChange: () => undefined,
      onToChange: () => undefined,
      initialOpen: true,
    }));
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('class="admin-range-popup"');
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-label="Report date range"');
    expect(markup).toContain('aria-label="Reports from date"');
    expect(markup).toContain('aria-label="Reports to date"');
    expect(markup).toContain('type="date"');
    expect(markup).toContain('value="2026-09-16"');
    expect(markup).toContain('value="2026-10-16"');
    expect(markup).toContain(">Done<");
  });

  it("wires Escape, outside press, and Done as the close paths", () => {
    // Vitest runs in the node/SSR environment, so the event paths themselves
    // are exercised in the rendered QA pass; this pins their wiring here.
    const source = readText(resolve(root, "src/admin/ReviewPage.tsx"));
    expect(source).toContain('event.key !== "Escape"');
    expect(source).toContain('window.addEventListener("keydown", close)');
    expect(source).toContain('window.addEventListener("pointerdown", close)');
    expect(source).toContain("onClick={() => setOpen(false)}");
    // The popup measures itself and clamps to the viewport on open.
    expect(source).toContain("getBoundingClientRect");
  });

  it("floats the popup above the card body, below the drawer, and stills it under reduced motion", () => {
    const css = readText(resolve(root, "src/admin/admin.css"));
    expect(css).toMatch(/\.admin-range-popup \{[\s\S]*?position: absolute/);
    expect(css).toMatch(/\.admin-range-popup \{[\s\S]*?z-index: 20/);
    // The drawer layer (60) and the notifications stack (5100) stay above it.
    expect(css).toMatch(/\.admin-drawer-backdrop \{[\s\S]*?z-index: 60/);
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)", css.indexOf(".admin-range-popup")));
    expect(reduced).toContain(".admin-range-popup");
    expect(reduced).toContain("animation: none");
  });
});
