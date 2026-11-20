import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { NotificationProvider } from "./NotificationFlyouts";
import { seedAdminFixtures } from "./admin/adminFixtures";
import { adminKeys, isoDaysAgo, todayIso } from "./admin/data";
import EvidencePage from "./admin/EvidencePage";

describe("admin evidence record", () => {
  it("shows a retained frame beside Worktivity evidence rows", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedAdminFixtures(client, "dense");
    const markup = renderToStaticMarkup(
      createElement(QueryClientProvider, { client },
        createElement(NotificationProvider, null,
          createElement(EvidencePage, {}))),
    );

    expect(markup).toContain("Worktivity (activity)");
    // Every row now carries the time the provider record happened, including
    // the GHL row whose fixture records 13:10 rather than the 09:30 mirror time.
    expect(markup).toContain('class="admin-evidence-time"');
    expect(markup).toContain('dateTime="2026-');
    expect(markup).toContain("13:10:00.000Z");
    // An image row reserves its frame tile and loads the real preview when the
    // surface mounts; the server render is the skeleton, never a broken image.
    // Five Worktivity rows carry a retained frame; the GitHub and Loom rows in
    // the same fixture stay text-only.
    expect(markup.match(/admin-evidence-frame/g)?.length).toBe(5);
  });

  it("names an assigned-only GHL owner instead of reading as unknown", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedAdminFixtures(client, "dense");
    const today = todayIso();
    const filters = { personId: "", source: "", from: isoDaysAgo(13), to: today, correction: "", summary: "1", limit: "100" };
    client.setQueryData(adminKeys.evidence(filters), {
      evidence: [{
        id: "e-ghl-owner",
        person_id: null,
        task_id: null,
        evidence_date: today,
        source: "ghl",
        title: "Opportunity open",
        summary: "Opportunity state recorded by GHL; ownership is not proof of an employee action.",
        url: null,
        metrics: { relation: "assigned_only" },
        created_at: `${today}T13:10:00.000Z`,
        recorded_at: `${today}T13:10:00.000Z`,
        person: null,
        task: null,
        event: { correction_status: "original", evidence_class: "output_evidence", metadata: { ghl: { relation: "assigned_only" } }, screenshot: null },
        ghl: { eventId: "e-ghl-owner", relation: "assigned_only", actorLabel: "Assigned contact only — actor unknown", assigneeLabels: ["Kalia Bell"], contentAvailability: "metadata_only", coverage: "contextual_snapshot" },
      }],
      summary: { sources: [], days: [] },
    });
    const markup = renderToStaticMarkup(
      createElement(QueryClientProvider, { client },
        createElement(NotificationProvider, null,
          createElement(EvidencePage, {}))),
    );

    expect(markup).toContain("Assigned to Kalia Bell");
    expect(markup).not.toContain("Unmapped person");
  });

  it("offers older evidence when a busy first page hides sent email", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedAdminFixtures(client, "dense");
    const today = todayIso();
    const filters = { personId: "", source: "", from: isoDaysAgo(13), to: today, correction: "", summary: "1", limit: "100" };
    const rows = Array.from({ length: 100 }, (_, index) => ({
      id: `e-${index}`,
      person_id: "p-1",
      task_id: null,
      evidence_date: today,
      source: "ghl",
      title: index === 99 ? "Email sent" : "Call outbound",
      summary: "Recorded outbound call with status completed.",
      url: null,
      metrics: null,
      created_at: `${today}T13:10:00.000Z`,
      recorded_at: `${today}T13:10:00.000Z`,
      person: { id: "p-1", display_name: "Amara Okafor" },
      task: null,
      event: null,
      ghl: null,
    }));
    client.setQueryData(adminKeys.evidence(filters), { evidence: rows, summary: { sources: [], days: [] } });
    const markup = renderToStaticMarkup(
      createElement(QueryClientProvider, { client },
        createElement(NotificationProvider, null,
          createElement(EvidencePage, {}))),
    );

    expect(markup).toContain("Show older evidence");
  });
});
