import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { SettingsWorkspace } from "./SettingsWorkspace";
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
    installedVersion: "0.5.33",
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

function render(overrides: Partial<PersonalSettingsProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(SettingsWorkspace, props(overrides))),
  );
}

describe("settings category workspace", () => {
  it("renders the category rail and opens General by default", () => {
    const markup = render();
    for (const label of ["Profile", "Workday", "Session", "General", "Appearance", "Voice", "Otto memory", "Page guides", "Diagnostics", "Reset", "About"]) {
      expect(markup).toContain(`>${label}<`);
    }
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain("This device");
    expect(markup).not.toContain("Reading &amp; display");
  });

  it("hides record-dependent pages when the account has no personal workday", () => {
    const markup = render({ hasPersonalRecord: false });
    expect(markup).not.toContain('data-settings-nav="profile"');
    expect(markup).not.toContain('data-settings-nav="workday"');
    expect(markup).not.toContain('data-settings-nav="otto"');
    expect(markup).not.toContain('data-settings-nav="reset"');
    for (const id of ["session", "general", "appearance", "voice", "guides", "diagnostics", "about"]) {
      expect(markup).toContain(`data-settings-nav="${id}"`);
    }
  });

  it("keeps the category rail labelled as one settings navigation", () => {
    const markup = render();
    expect(markup).toContain('aria-label="Settings sections"');
    expect(markup).toContain('aria-label="Search settings"');
    expect(markup).toContain("Account");
    expect(markup).toContain("App");
    expect(markup).toContain("Data &amp; privacy");
  });
});
