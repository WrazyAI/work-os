import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import AdminWorkspace, { type AdminNotifications } from "./AdminWorkspace";
import { NotificationProvider } from "../NotificationFlyouts";
import type { AdminSection, SessionResponse } from "./types";

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
        createElement(Component, { session, notifications, section: "overview", focus: {}, onNavigate: noop, onSwitchToEmployee: noop, onSignOut: noop, ...overrides }))),
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

describe("administration masthead refresh control", () => {
  const REFRESH_SECTIONS: AdminSection[] = ["overview", "people", "tasks", "review", "insights", "evidence"];

  it("renders the shared page refresh control on every section but settings", () => {
    for (const section of REFRESH_SECTIONS) {
      const markup = render({ section });
      expect(markup, section).toContain('title="Refresh this page"');
      expect(markup, section).toContain('aria-label="Refresh this page"');
      expect(markup, section).toContain('class="icon"');
    }
    expect(render({ section: "settings" })).not.toContain("Refresh this page");
  });

  it("sits between the notifications bell and the profile avatar", () => {
    const markup = render({ profile: { name: "Ada Lovelace", avatarUrl: null, onOpen: noop } });
    const bell = markup.indexOf("notifications-bell");
    const refresh = markup.indexOf('aria-label="Refresh this page"');
    const avatar = markup.indexOf('aria-label="Profile for Ada Lovelace"');
    expect(bell).toBeGreaterThan(-1);
    expect(refresh).toBeGreaterThan(bell);
    expect(avatar).toBeGreaterThan(refresh);
  });

  it("stays hidden from sessions that are not administrators", () => {
    const markup = render({ session: { ...session, role: "employee" } });
    expect(markup).not.toContain("Refresh this page");
  });

  it("starts enabled: nothing in the section is fetching on first paint", () => {
    const markup = render();
    const button = markup.slice(markup.indexOf('aria-label="Refresh this page"'));
    expect(button.slice(0, 200)).not.toContain("disabled");
    expect(markup).toContain("lucide-refresh-cw");
  });
});
