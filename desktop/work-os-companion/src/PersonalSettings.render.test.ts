import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { PersonalSettings, type PersonalSettingsProps } from "./PersonalSettings";
import { MASCOT } from "./mascot";

const noop = () => undefined;

/** The full personal-settings surface as the app supplies it for a mapped
 * account: every group present, nothing busy. */
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
    autoCheckUpdates: true,
    onAutoCheckUpdates: noop,
    updateDetail: "You're on the latest version.",
    updateStatus: "idle",
    installedVersion: "0.4.60",
    onCheckForUpdates: noop,
    onDownloadUpdate: noop,
    onInstallUpdate: noop,
    onOpenWhatsNew: noop,
    pageGuideAutoOpen: true,
    onPageGuideAutoOpen: noop,
    textSize: "small",
    mascotSize: "large",
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
    createElement(QueryClientProvider, { client }, createElement(PersonalSettings, props(overrides))),
  );
}

describe("personal settings", () => {
  it("carries every personal group in the employee order", () => {
    const markup = render();
    // The groups read in one order on every surface that renders them.
    const order = [
      "Profile settings",
      "This device",
      "Page guides",
      "Reading &amp; display",
      "Workday",
      "Sync &amp; session",
      `What ${MASCOT.name} remembers`,
      "Suggestions waiting for review",
      "Diagnostics",
      "Reset",
    ];
    let previous = -1;
    for (const heading of order) {
      const at = markup.indexOf(heading);
      expect(at, heading).toBeGreaterThan(previous);
      previous = at;
    }
    // The rows the groups own.
    expect(markup).toContain("Open profile settings");
    expect(markup).toContain("Start with Windows");
    expect(markup).toContain("Hold-to-talk (Ctrl + M)");
    expect(markup).toContain("Automatic update checks");
    expect(markup).toContain("Desktop updates");
    expect(markup).toContain("Show page guides automatically");
    expect(markup).toContain("Replay the full tour");
    expect(markup).toContain("Offline queue");
    expect(markup).toContain("Account session");
    expect(markup).toContain("Sign out");
    expect(markup).toContain("Scenario debugger");
    expect(markup).toContain("Export diagnostics");
    expect(markup).toContain("Restart onboarding");
  });

  it("keeps the record-dependent groups for accounts with a personal workday, and drops them without one", () => {
    const withRecord = render({ hasPersonalRecord: true });
    for (const heading of ["Profile settings", "Workday", `What ${MASCOT.name} remembers`, "Suggestions waiting for review", "Reset"]) {
      expect(withRecord, heading).toContain(heading);
    }
    const withoutRecord = render({ hasPersonalRecord: false });
    for (const heading of ["Profile settings", "Workday", `What ${MASCOT.name} remembers`, "Suggestions waiting for review", "Reset"]) {
      expect(withoutRecord, heading).not.toContain(heading);
    }
    // The device-level half never depends on the record.
    for (const heading of ["This device", "Page guides", "Reading &amp; display", "Sync &amp; session", "Diagnostics"]) {
      expect(withoutRecord, heading).toContain(heading);
    }
  });

  it("names the tour the surface will actually replay", () => {
    expect(render({ tourScope: "employee" })).toContain("the same pass a new workspace starts with");
    expect(render({ tourScope: "admin" })).toContain("the same pass the administration guides offer");
  });

  it("renders the update row's real controls per state", () => {
    const idle = render({ updateStatus: "idle" });
    expect(idle).toContain(">Check</button>");
    const available = render({ updateStatus: "available" });
    expect(available).toContain(">Download</button>");
    const failed = render({ updateStatus: "failed" });
    expect(failed).toContain(">Retry</button>");
    const downloaded = render({ updateStatus: "downloaded" });
    expect(downloaded).toContain(">Install</button>");
    expect(downloaded).toContain("What&#x27;s new");
    const downloading = render({ updateStatus: "downloading" });
    expect(downloading).toContain("Downloading");
    expect(downloading).not.toContain(">Download</button>");
  });
});
