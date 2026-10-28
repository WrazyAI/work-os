import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdminRecapInbox } from "./AdminRecapInbox";
import { fixtureInboxPage, FIXTURE_CONFIRMED_RECAP, FIXTURE_REVIEWED_RECAP } from "./fixtures";

const scope = { userId: "actor", organizationId: "org", mode: "admin" as const };

const render = (props: Partial<Parameters<typeof AdminRecapInbox>[0]> = {}) =>
  renderToStaticMarkup(createElement(AdminRecapInbox, {
    scope,
    onOpenRecap() {},
    onListen() {},
    ...props,
  }));

describe("admin recap inbox", () => {
  it("inbox_initial_loading_is_not_an_empty_or_failed_record", () => {
    const html = render();
    expect(html).toContain("Getting reviewed recaps");
    expect(html).not.toContain("No reviewed recaps");
    expect(html).not.toContain("Couldn't");
    expect(html).toContain('aria-busy="true"');
  });

  it("single_arrival_offers_listen_and_view", () => {
    const page = fixtureInboxPage({ count: 1, total: 1, nextCursor: null });
    const html = render({ initialPage: page });
    expect(html).toContain("Synthetic Ada");
    expect(html).toContain("Corrected by employee");
    expect(html).toContain("View recap");
    expect(html).toContain("Listen");
    expect(html).toContain("Showing 1 of 1");
    expect(html).not.toContain("Load more");
    // Order-facing actions share one horizontal card footer instead of a
    // stacked action column.
    expect(html).toContain('class="admin-otto-inbox-actions"');
    expect(html).toContain("Not listened, unread");
    // A row is a record, never an employee decision surface.
    expect(html).not.toMatch(/Looks right|Looks good|Add or correct|Confirm recap|Clock in|Clock out/);
  });

  it("multiple_arrivals_offer_counted_inbox", () => {
    const page = fixtureInboxPage({ count: 12, total: 25, nextCursor: "next-page" });
    const html = render({ initialPage: page });
    expect(html).toContain("Showing 12 of 25");
    expect(html).toContain("Load 12 more");
    expect(html).toContain("Synthetic Teammate 12");
    expect(html).toContain("Confirmed by employee");
    // The explicit load control names the server's complete total, not the
    // loaded rows.
    expect(html).toContain("Load 12 more");
    expect(html).not.toContain("On this page");
  });

  it("distinguishes a genuine empty inbox from a failure", () => {
    const empty = render({ initialPage: fixtureInboxPage({ count: 0, total: 0, nextCursor: null, unread: 0 }) });
    expect(empty).toContain("No reviewed recaps yet");
    expect(empty).not.toContain("Couldn&#x27;t load");
    const failed = render({ initialError: "The inbox could not be reached." });
    expect(failed).toContain("Otto couldn&#x27;t load the recaps");
    expect(failed).toContain("Try again");
    expect(failed).not.toContain("No reviewed recaps yet");
  });

  it("keeps existing records visible while the inbox is refreshing", () => {
    const html = render({ initialPage: fixtureInboxPage({ count: 2, total: 20 }), refreshing: true });
    expect(html).toContain("Synthetic Ada");
    expect(html).toContain("Checking for new recaps");
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("Loading reviewed recaps");
  });

  it("names the employee and review status on every row", () => {
    const page = fixtureInboxPage({ count: 2, total: 2, nextCursor: null, recap: FIXTURE_CONFIRMED_RECAP });
    const html = render({ initialPage: page });
    expect(html).toContain("Confirmed by employee");
    expect(html).toContain("Synthetic Teammate 2");
    // The reviewed window is in the employee's own timezone.
    expect(html).toContain("October 26, 2026");
    expect(html).toContain("Listened");
  });

  it("never renders a model or externally supplied URL as a link", () => {
    const page = fixtureInboxPage({
      count: 1,
      total: 1,
      nextCursor: null,
      recap: { ...FIXTURE_REVIEWED_RECAP, original: { ...FIXTURE_REVIEWED_RECAP.original, detail: "See https://example.invalid/model" } },
    });
    const html = render({ initialPage: page });
    expect(html).not.toContain('href="https://example.invalid');
    expect(html).not.toContain("javascript:");
    // The text itself remains readable, never silently stripped.
    expect(html).toContain("https://example.invalid/model");
  });
});
