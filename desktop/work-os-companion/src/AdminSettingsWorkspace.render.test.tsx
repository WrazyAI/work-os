import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { AdminSettingsContent, adminSettingsPages } from "./AdminSettingsWorkspace";
import type { PersonalSettingsProps } from "./PersonalSettings";
import { NotificationProvider } from "./NotificationFlyouts";

const noop = () => undefined;

function props(): PersonalSettingsProps {
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
    onSignOut: noop,
    memory: { facts: [], loading: false, error: null },
    onOpenMemory: noop,
    onRetryMemory: noop,
    onOpenDebugger: noop,
    onExportDiagnostics: noop,
    onResetOnboarding: noop,
    busy: false,
  };
}

function render(active: "workspace-status" | "general") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(NotificationProvider, null, createElement(AdminSettingsContent, {
      active,
      visiblePages: adminSettingsPages(true, true),
      query: "",
      onSelect: noop,
      onQuery: noop,
      personalSettingsProps: props(),
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
});
