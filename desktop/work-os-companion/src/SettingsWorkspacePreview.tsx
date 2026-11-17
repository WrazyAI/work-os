import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import SidebarNav from "./SidebarNav";
import { SettingsWorkspace } from "./SettingsWorkspace";
import { applyAppearance, type ThemePreference } from "./appearance";

/** DEV-only visual review surface for the category Settings workspace. The
 * real controls are wired to fixture state; nothing here is shipped. */
export default function SettingsWorkspacePreview() {
  const [theme, setTheme] = useState<ThemePreference>("dark");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    applyAppearance({ textSize: "small", mascotSize: "large", theme });
  }, [theme]);

  return <div className="workspace preview-workspace">
    <SidebarNav activeView="settings" onNavigate={() => undefined} onNewChat={() => undefined} initiallyCollapsed />
    <div className="stage">
      <header className="masthead">
        <div><p>November 16</p><h1>Settings</h1></div>
        <div className="mast-actions">
          <span className="status-chip">Layout preview</span>
          <button type="button" className="icon" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <span className="avatar">DZ</span>
        </div>
      </header>
      <main className="page settings-page settings-workspace-page">
        <SettingsWorkspace
          hasPersonalRecord
          adminOttoSettings={undefined}
          tourScope="employee"
          onReplayTour={() => undefined}
          onOpenProfile={() => undefined}
          autoStart
          onAutoStart={() => undefined}
          voiceHotkeyEnabled
          voiceHotkeyError={null}
          onVoiceHotkey={() => undefined}
          recapVoice="warm"
          onRecapVoice={() => undefined}
          autoCheckUpdates
          onAutoCheckUpdates={() => undefined}
          updateDetail="Installed version 0.5.33 · up to date"
          updateStatus="idle"
          installedVersion="0.5.33"
          onCheckForUpdates={() => undefined}
          onDownloadUpdate={() => undefined}
          onInstallUpdate={() => undefined}
          onOpenWhatsNew={() => undefined}
          pageGuideAutoOpen
          onPageGuideAutoOpen={() => undefined}
          theme={theme}
          textSize="small"
          mascotSize="large"
          onTheme={(next) => setTheme(next)}
          onTextSize={() => undefined}
          onMascotSize={() => undefined}
          queueCount={0}
          queueAttentionCount={0}
          sessionApiBase="app.wrazyos.com"
          onSignOut={() => undefined}
          memory={{ facts: [], factTotals: { confirmed: 3, candidate: 1 }, loading: false, error: null }}
          onOpenMemory={() => undefined}
          onRetryMemory={() => undefined}
          onOpenDebugger={() => undefined}
          onExportDiagnostics={() => undefined}
          onResetOnboarding={() => setBusy((value) => !value)}
          busy={busy}
        />
      </main>
    </div>
  </div>;
}
