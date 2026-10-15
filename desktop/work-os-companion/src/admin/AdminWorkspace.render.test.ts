import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import AdminWorkspace, { type AdminNotifications } from "./AdminWorkspace";
import { NotificationProvider } from "../NotificationFlyouts";
import type { SessionResponse } from "./types";

const noop = () => undefined;

const session: SessionResponse = {
  organizationId: "org-test",
  role: "admin",
  personId: "p-admin",
  userId: "u-admin",
  featureFlags: {},
};

const notifications: AdminNotifications = {
  memoryCandidates: 0,
  recap: null,
  overdueTasks: 0,
  days: [],
  loading: false,
  error: null,
  open: false,
  onToggle: noop,
  onClose: noop,
  onSelect: noop,
  onOpenMemory: noop,
  onOpenRecap: noop,
  onOpenOverdue: noop,
  onRetry: noop,
};

function render(overrides: Partial<Parameters<typeof AdminWorkspace>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Component = AdminWorkspace as (props: Parameters<typeof AdminWorkspace>[0]) => ReactNode;
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client },
      createElement(NotificationProvider, null,
        createElement(Component, { session, notifications, onSwitchToEmployee: noop, onSignOut: noop, ...overrides }))),
  );
}

describe("administration masthead profile entry", () => {
  it("opens the account's profile through the same avatar contract as the employee masthead", () => {
    const markup = render({ profile: { name: "Ada Lovelace", avatarUrl: null, onOpen: noop } });
    expect(markup).toContain('aria-label="Profile for Ada Lovelace"');
    expect(markup).toContain('title="Open profile settings"');
    expect(markup).toContain('class="avatar"');
    expect(markup).toContain("AL");
  });

  it("renders no avatar while the shell supplies no profile record", () => {
    const markup = render();
    expect(markup).not.toContain("Profile for ");
    expect(markup).toContain("Switch to employee view");
  });
});
