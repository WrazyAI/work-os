import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { NotificationProvider } from "./NotificationFlyouts";
import { seedAdminFixtures } from "./admin/adminFixtures";
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
    // An image row reserves its frame tile and loads the real preview when the
    // surface mounts; the server render is the skeleton, never a broken image.
    // Five Worktivity rows carry a retained frame; the GitHub and Loom rows in
    // the same fixture stay text-only.
    expect(markup.match(/admin-evidence-frame/g)?.length).toBe(5);
  });
});
