import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { AdminSettingsContent, adminSettingsPages } from "./AdminSettingsWorkspace";
import { selectSettingsCardError, SettingsErrorNotices, type AdminSettingsCardId } from "./admin/SettingsPage";
import type { PersonalSettingsProps } from "./PersonalSettings";
import { NotificationProvider } from "./NotificationFlyouts";

const noop = () => undefined;

function props(overrides: Partial<PersonalSettingsProps> = {}): PersonalSettingsProps {
  return {
    hasPersonalRecord: true,
    tourScope: "admin",
    onReplayTour: noop,
    onOpenProfile: noop,
    autoStart: false,
    onAutoStart: noop,
    voiceHotkeyEnabled: true,
    voiceHotkeyError: null,
    onVoiceHotkey: noop,
    recapVoice: "warm",
    onRecapVoice: noop,
    autoCheckUpdates: true,
    onAutoCheckUpdates: noop,
    updateDetail: "You're on the latest version.",
    updateStatus: "idle",
    installedVersion: "0.5.34",
    onCheckForUpdates: noop,
    onDownloadUpdate: noop,
    onInstallUpdate: noop,
    onOpenWhatsNew: noop,
    pageGuideAutoOpen: true,
    onPageGuideAutoOpen: noop,
    theme: "system",
    textSize: "small",
    mascotSize: "large",
    onTheme: noop,
    onTextSize: noop,
    onMascotSize: noop,
    queueCount: 0,
    queueAttentionCount: 0,
    sessionApiBase: "https://app.wrazyos.com",
    agentAccessSurface: "admin",
    adminAgentApiEnabled: true,
    onSignOut: noop,
    memory: { facts: [], loading: false, error: null },
    onOpenMemory: noop,
    onRetryMemory: noop,
    onOpenDebugger: noop,
    onExportDiagnostics: noop,
    onResetOnboarding: noop,
    busy: false,
    ...overrides,
  };
}

function render(active: "workspace-status" | "general" | "session", overrides: Partial<PersonalSettingsProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(NotificationProvider, null, createElement(AdminSettingsContent, {
      active,
      visiblePages: adminSettingsPages(true, true),
      query: "",
      onSelect: noop,
      onQuery: noop,
      personalSettingsProps: props(overrides),
    }))),
  );
}

describe("administration settings takeover", () => {
  it("lists the shared personal pages, workspace settings, and recap follows", () => {
    const ids = adminSettingsPages(true, true).map((page) => page.id);
    expect(ids).toContain("profile");
    expect(ids).toContain("general");
    expect(ids).toContain("workspace-status");
    expect(ids).toContain("features");
    expect(ids).toContain("connections");
    expect(ids).toContain("recap-follows");
    expect(ids).toContain("about");
  });

  it("renders the workspace cards on Workspace settings", () => {
    const markup = render("workspace-status");
    expect(markup).toContain("Workspace status");
    expect(markup).toContain('data-active-card="status"');
    expect(markup).toContain("Workspace status");
    expect(markup).toContain("Features");
  });

  it("renders the shared personal page on General", () => {
    const markup = render("general");
    expect(markup).toContain("This device");
    expect(markup).not.toContain("Workspace status");
  });

  it("puts the administrator token surface and its guide on Session", () => {
    const markup = render("session");
    expect(markup).toContain("Agent access");
    expect(markup).toContain("Admin tokens");
    expect(markup).toContain("Admin API guide");
    expect(markup).toContain("https://app.wrazyos.com/docs/agent-api/admin");
    expect(markup).not.toContain("User API guide");
  });

  it("states that admin tokens are off when the workspace has not enabled the API", () => {
    const markup = render("session", { adminAgentApiEnabled: false });
    expect(markup).toContain("Admin agent access is off");
    expect(markup).toContain("Admin API guide");
    expect(markup).toContain("https://app.wrazyos.com/docs/agent-api/admin");
    expect(markup).not.toContain("Manage tokens");
  });

  it("does not offer the retired Field mappings destination", () => {
    const ids = adminSettingsPages(true, true).map((page) => page.id);
    expect(ids).not.toContain("mappings");
    expect(render("workspace-status")).not.toContain("Field mappings");
  });

  it("shows only the failures owned by the settings card on screen", () => {
    const membersError = new Error("members failed");
    const connectionsError = new Error("connections failed");
    const errors = {
      status: [],
      features: [],
      members: [membersError],
      teams: [],
      connections: [connectionsError],
      blueprints: [],
    };
    expect(selectSettingsCardError("members", errors)).toBe(membersError);
    expect(selectSettingsCardError("connections", errors)).toBe(connectionsError);
    expect(selectSettingsCardError("teams", errors)).toBeUndefined();
    expect(selectSettingsCardError(undefined, errors)).toBe(membersError);
    expect(selectSettingsCardError("mappings" as AdminSettingsCardId, errors)).toBe(membersError);
  });

  it("keeps consecutive Members mutation failures visible together", () => {
    const markup = renderToStaticMarkup(createElement(SettingsErrorNotices, {
      errors: [new Error("Role change failed"), new Error("Add member failed")],
    }));
    expect(markup).toContain("Role change failed");
    expect(markup).toContain("Add member failed");
  });
});
