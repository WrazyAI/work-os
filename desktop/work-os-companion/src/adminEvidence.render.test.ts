import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { NotificationProvider } from "./NotificationFlyouts";
import { seedAdminFixtures } from "./admin/adminFixtures";
import { adminKeys, isoDaysAgo, todayIso } from "./admin/data";
import EvidencePage from "./admin/EvidencePage";

function renderEvidence() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seedAdminFixtures(client, "dense");
  const markup = renderToStaticMarkup(
    createElement(QueryClientProvider, { client },
      createElement(NotificationProvider, null,
        createElement(EvidencePage, {}))),
  );
  return { client, markup };
}

function pageFilters(overrides: Record<string, string> = {}) {
  return {
    personId: "", unattributed: "", source: "", from: isoDaysAgo(13), to: todayIso(),
    correction: "", q: "", summary: "1", limit: "500", ...overrides,
  };
}

describe("admin evidence record", () => {
  it("shows a retained Worktivity frame and the provider occurrence time", () => {
    const { markup } = renderEvidence();
    const today = todayIso();

    // The email is an individual row with its provider occurrence time, not
    // the mirror write that copied it into Work OS.
    expect(markup).toContain('class="evidence-time"');
    expect(markup).toContain(`dateTime="${today}T13:05:00.000Z"`);
    expect(markup).toContain("Email sent");
    // Worktivity rows reserve a real frame tile; the server render is the
    // skeleton, never a broken image.
    expect(markup).toContain("evidence-kind-tile is-worktivity");
    expect(markup.match(/evidence-thumb/g)?.length).toBe(2);
    expect(markup.match(/eod-shot-skeleton/g)?.length).toBe(2);
  });

  it("names an assigned-only GHL owner without crediting them as the actor", () => {
    const { client } = renderEvidence();
    const today = todayIso();
    client.setQueryData(adminKeys.evidence(pageFilters()), {
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
      summary: { sources: [], days: [], kinds: [{ kind: "context", count: 1 }], peopleCount: 0 },
    });
    const markup = renderToStaticMarkup(
      createElement(QueryClientProvider, { client },
        createElement(NotificationProvider, null,
          createElement(EvidencePage, {}))),
    );

    expect(markup).toContain("Kalia Bell");
    expect(markup).toContain("Assigned only");
    expect(markup).not.toContain("Unmapped person");
  });

  it("discloses a partial 500-row ledger instead of pretending the page is complete", () => {
    const { client } = renderEvidence();
    const today = todayIso();
    const filters = pageFilters();
    const rows = Array.from({ length: 500 }, (_, index) => ({
      id: `e-${index}`,
      person_id: "p-1",
      task_id: null,
      evidence_date: today,
      source: "ghl",
      title: index === 499 ? "Email sent" : "Call outbound",
      summary: index === 499 ? "Email sent recorded by GHL." : "Recorded outbound call with status completed.",
      url: null,
      metrics: null,
      created_at: `${today}T13:10:00.000Z`,
      recorded_at: `${today}T13:10:00.000Z`,
      person: { id: "p-1", display_name: "Amara Okafor" },
      task: null,
      event: null,
      ghl: null,
    }));
    client.setQueryData(adminKeys.evidence(filters), {
      evidence: rows,
      summary: { sources: [], days: [], kinds: [{ kind: "call", count: 501 }], peopleCount: 1 },
    });
    const markup = renderToStaticMarkup(
      createElement(QueryClientProvider, { client },
        createElement(NotificationProvider, null,
          createElement(EvidencePage, {}))),
    );

    expect(markup).toContain("Showing the most recent 500 records");
    expect(markup).toContain("Partial view");
  });
});
