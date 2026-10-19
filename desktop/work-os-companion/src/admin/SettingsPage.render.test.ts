import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { NotificationProvider } from "../NotificationFlyouts";
import { seedAdminFixtures } from "./adminFixtures";
import SettingsPage from "./SettingsPage";

function render(page: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seedAdminFixtures(client, "dense");
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(NotificationProvider, null, page)),
  );
}

describe("administration settings personal half", () => {
  it("leads with the account's own settings when the shell supplies them", () => {
    const markup = render(createElement(SettingsPage, { personalSettings: createElement("p", null, "PERSONAL-HALF-MARKER") }));
    const personal = markup.indexOf("PERSONAL-HALF-MARKER");
    const workspace = markup.indexOf("Workspace status");
    expect(personal).toBeGreaterThan(-1);
    expect(workspace).toBeGreaterThan(-1);
    expect(personal).toBeLessThan(workspace);
  });

  it("renders the workspace configuration alone when no personal settings are supplied", () => {
    const markup = render(createElement(SettingsPage, {}));
    expect(markup).not.toContain("PERSONAL-HALF-MARKER");
    expect(markup).toContain("Workspace status");
    expect(markup).toContain("Features");
    expect(markup).toContain("Members");
  });
});
