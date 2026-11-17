import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { SettingsContent } from "./SettingsContent";
import { SettingsSidebar } from "./SettingsSidebar";
import { SETTINGS_PAGES, type SettingsPageId } from "./settingsSections";
import { filterSettingsPages } from "./settingsNavigation";
import type { PersonalSettingsProps } from "./PersonalSettings";

const noop = () => undefined;

function props(overrides: Partial<PersonalSettingsProps> = {}): PersonalSettingsProps {
  return {
    hasPersonalRecord: true,
    tourScope: "employee",
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
    ...overrides,
  };
}

function pages(hasPersonalRecord = true, query = "") {
  return filterSettingsPages(
    SETTINGS_PAGES.filter((page) => !page.requiresPersonalRecord || hasPersonalRecord),
    query,
  );
}

function renderSidebar({ active = "general" as SettingsPageId, hasPersonalRecord = true, query = "" } = {}) {
  return renderToStaticMarkup(createElement(SettingsSidebar, {
    active,
    visiblePages: pages(hasPersonalRecord, query),
    query,
    onQuery: noop,
    onSelect: noop,
    onBack: noop,
    hasPersonalRecord,
    displayName: "David Yeeboah",
    avatarUrl: null,
  }));
}

function renderContent({ active = "general" as SettingsPageId, query = "", overrides = {} as Partial<PersonalSettingsProps> } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(SettingsContent, {
    ...props(overrides),
    active,
    visiblePages: pages(true, query),
    query,
    onSelect: noop,
    onQuery: noop,
  })));
}

describe("settings sidebar takeover", () => {
  it("renders the settings rail with Back to app, search, profile, and every category", () => {
    const markup = renderSidebar();
    expect(markup).toContain("Back to app");
    expect(markup).toContain('aria-label="Search settings"');
    expect(markup).toContain("David Yeeboah");
    for (const label of ["Profile", "Workday", "Session", "General", "Appearance", "Voice", "Otto memory", "Page guides", "Diagnostics", "Reset", "About"]) {
      expect(markup).toContain(`>${label}<`);
    }
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('aria-label="Settings sections"');
  });

  it("hides record-dependent pages when the account has no personal workday", () => {
    const markup = renderSidebar({ hasPersonalRecord: false });
    expect(markup).not.toContain('data-settings-nav="profile"');
    expect(markup).not.toContain('data-settings-nav="workday"');
    expect(markup).not.toContain('data-settings-nav="otto"');
    expect(markup).not.toContain('data-settings-nav="reset"');
    for (const id of ["session", "general", "appearance", "voice", "guides", "diagnostics", "about"]) {
      expect(markup).toContain(`data-settings-nav="${id}"`);
    }
  });

  it("renders only the selected settings page in the stage", () => {
    const markup = renderContent();
    expect(markup).toContain("This device");
    expect(markup).toContain("Start with Windows");
    expect(markup).not.toContain("Reading &amp; display");
  });

  it("embeds the profile form on the Profile page instead of opening a modal", () => {
    const content = createElement("p", null, "INLINE-PROFILE-MARKER");
    const markup = renderContent({ active: "profile", overrides: { profileSettings: content } });
    expect(markup).toContain("INLINE-PROFILE-MARKER");
    expect(markup).not.toContain("Open profile settings");
  });

  it("shows matching pages when the search filters the rail", () => {
    const markup = renderContent({ active: "general", query: "dark" });
    expect(markup).toContain("Results for");
    expect(markup).toContain("Appearance");
    expect(markup).not.toContain("Start with Windows");
  });
});
