import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdminRecapView } from "./AdminRecapView";
import type { ReviewedRecap } from "../../../../src/modules/work-os/admin-otto/contracts";
import { FIXTURE_CONFIRMED_RECAP, FIXTURE_REVIEWED_RECAP } from "./fixtures";

export const reviewed: ReviewedRecap = {
  intervalId: "interval-1", eventId: "event-1", person: { id: "person-1", displayName: "Synthetic Ada", active: true, timezone: "UTC" },
  reviewVersion: 2, reviewKey: "review-2", sourceRevision: 7, scriptHash: "hash", reviewStatus: "amended",
  reviewedAt: "2026-10-26T12:00:00Z", windowStart: "2026-10-26T10:00:00Z", windowEnd: "2026-10-26T11:00:00Z", timezone: "UTC",
  original: { headline: "Compared the layouts", detail: "Inspected a local preview.", activities: ["Opened the prototype"] },
  employeeFeedback: "The prototype was local, not deployed.", speechLines: [{ text: "Compared the layouts", time: null }, { text: "The prototype was local, not deployed.", time: null }],
  coverage: [],
  recordUrl: "/work-os/admin/people/person-1?recap=interval-1",
};

const render = (props: Partial<Parameters<typeof AdminRecapView>[0]> = {}, recap: ReviewedRecap = reviewed) =>
  renderToStaticMarkup(createElement(AdminRecapView, { recap, onListen() {}, onOpenRecord() {}, ...props }));

describe("admin recap view", () => {
  it("admin_view_has_no_employee_confirm_controls", () => {
    const html = render();
    expect(html).toContain("Corrected by employee");
    expect(html).toContain("Original recap");
    expect(html).toContain("Employee correction");
    expect(html).toContain(reviewed.original.headline);
    expect(html).toContain(reviewed.employeeFeedback);
    expect(html).toContain("Listen");
    expect(html).toContain('href="/work-os/admin/people/person-1?recap=interval-1"');
    expect(html).not.toMatch(/Looks right|Looks good|Add or correct|Clock in|Clock out|Confirm recap/);
    expect(html).not.toContain('role="textbox"');
  });

  it("confirmed_original_has_no_invented_correction", () => {
    const html = render({ recap: { ...reviewed, reviewStatus: "confirmed", employeeFeedback: null } });
    expect(html).toContain("Confirmed by employee");
    expect(html).not.toContain("Employee correction");
    expect(html).not.toContain("Corrected by employee");
  });

  it("matches the reviewed speech sections and marks them as the spoken script", () => {
    const html = render({}, FIXTURE_REVIEWED_RECAP);
    // Task 2's amended script begins with these exact markers. The visible
    // sections use the same words, so the page and the read cannot drift.
    expect(html).toContain("Original AI summary.");
    expect(html).toContain("Employee correction.");
    expect(html.indexOf("Original AI summary.")).toBeLessThan(html.indexOf("Employee correction."));
    expect(html).toContain("The prototype was local, not deployed.");
    // The employee identity and review window are always present.
    expect(html).toContain("Synthetic Ada");
    expect(html).toContain("October 26, 2026");
  });

  it("renders a confirmed recap without claiming a correction or a decision", () => {
    const html = render({}, FIXTURE_CONFIRMED_RECAP);
    expect(html).toContain("Confirmed by employee");
    expect(html).not.toContain("Corrected by employee");
    expect(html).not.toContain("Employee correction.");
    expect(html).not.toContain("Confirm recap");
    expect(html).not.toContain("Approve");
  });

  it("shows the server-provided spoken lines in the shared bounded prompter while reading", () => {
    const html = render({
      playback: {
        status: "playing",
        intervalId: FIXTURE_REVIEWED_RECAP.intervalId,
        lines: FIXTURE_REVIEWED_RECAP.speechLines,
        progress: 0.5,
        activeIndex: 2,
        slow: false,
        error: null,
      },
    }, FIXTURE_REVIEWED_RECAP);
    expect(html).toContain("recap-prompter");
    expect(html).toContain("Original AI summary.");
    expect(html).toContain('data-progress="0.500"');
    expect(html).toContain('data-active="true"');
    expect(html).toContain("Stop reading");
  });

  it("shows preparing/slow and finished states without a live Stop after completion", () => {
    const preparing = render({
      playback: { status: "loading", intervalId: FIXTURE_REVIEWED_RECAP.intervalId, lines: [], progress: 0, activeIndex: 0, slow: false, error: null },
    }, FIXTURE_REVIEWED_RECAP);
    expect(preparing).toContain("Preparing the read");
    expect(preparing).toContain("Cancel");
    expect(preparing).not.toContain("Stop");
    const slow = render({
      playback: { status: "loading", intervalId: FIXTURE_REVIEWED_RECAP.intervalId, lines: [], progress: 0, activeIndex: 0, slow: true, error: null },
    }, FIXTURE_REVIEWED_RECAP);
    expect(slow).toContain("Still preparing the read");
    const finished = render({
      playback: {
        status: "finished", intervalId: FIXTURE_REVIEWED_RECAP.intervalId,
        lines: FIXTURE_REVIEWED_RECAP.speechLines, progress: 1, activeIndex: 4, slow: false, error: null,
      },
    }, FIXTURE_REVIEWED_RECAP);
    expect(finished).toContain("Read complete");
    expect(finished).not.toContain("Reading this reviewed recap");
    expect(finished).not.toContain("Stop reading");
    expect(finished).toContain("Listen again");
    expect(finished).toContain("recap-prompter");
  });

  it("does not auto-open a record surface and exposes no invented URL", () => {
    const html = render();
    expect(html).not.toContain("autoFocus");
    expect(html).not.toContain("report=");
    expect(html).not.toContain("javascript:");
  });
});
