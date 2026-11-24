import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { NotificationProvider } from "../NotificationFlyouts";
import { adminKeys } from "./data";
import { seedAdminFixtures } from "./adminFixtures";
import SettingsPage from "./SettingsPage";

function render(page: ReactElement, mutateClient?: (client: QueryClient) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seedAdminFixtures(client, "dense");
  mutateClient?.(client);
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

  it("renders per-row password reset controls for active members and disables inactive members", () => {
    const markup = render(createElement(SettingsPage, { activeCard: "members" }), (client) => {
      const current = client.getQueryData<Record<string, any>>(adminKeys.organization());
      if (!current) return;
      client.setQueryData(adminKeys.organization(), {
        ...current,
        memberships: [
          ...current.memberships,
          {
            id: "mem-inactive",
            user_id: "user-inactive",
            person_id: null,
            email: "former@maigreeks.com",
            role: "employee",
            active: false,
            feature_flags: null,
            person: { id: "p-inactive", display_name: "Former Teammate", email: "former@maigreeks.com" },
          },
        ],
      });
    });
    expect(markup).toContain("admin-member-identity");
    expect(markup).toContain('role="region" aria-label="Workspace members"');
    expect(markup).toContain("Password</th>");
    expect(markup).toContain("Send reset");
    expect(markup).toContain("Send password reset email to");
    expect(markup).toContain("Password reset unavailable for inactive member Former Teammate");
    expect(markup).not.toContain("<dialog");
  });
});
