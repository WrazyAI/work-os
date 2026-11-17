import { useEffect, useMemo, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { ProfileSettings } from "./ProfileSettings";
import { profilePreviewData } from "./ProfilePreview";
import { SettingsContent } from "./SettingsContent";
import { SettingsSidebar } from "./SettingsSidebar";
import { useSettingsNavigation } from "./settingsNavigation";
import { applyAppearance, type ThemePreference } from "./appearance";

/** DEV-only review surface for the Settings sidebar takeover. The Work OS
 * sidebar is replaced by the Settings rail; the selected page renders in the
 * stage. Nothing here is shipped. */
export default function SettingsWorkspacePreview() {
  const [theme, setTheme] = useState<ThemePreference>("dark");
  const [busy, setBusy] = useState(false);
  const nav = useSettingsNavigation(true);
  const profileData = useMemo(() => profilePreviewData(), []);

  useEffect(() => {
    applyAppearance({ textSize: "small", mascotSize: "large", theme });
  }, [theme]);

  return <div className="workspace preview-workspace">
    <SettingsSidebar
      active={nav.active}
      visiblePages={nav.visiblePages}
      query={nav.query}
      onQuery={nav.setQuery}
      onSelect={nav.selectPage}
      onBack={() => { window.location.href = "/?offline&guides=seen"; }}
      hasPersonalRecord
      displayName={profileData.profile.displayName}
      avatarUrl={profileData.profile.avatarUrl ?? null}
    />
    <div className="stage">
      <header className="masthead">
        <div><p>November 17</p><h1>Settings</h1></div>
        <div className="mast-actions">
          <span className="status-chip">Layout preview</span>
          <button type="button" className="icon" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <span className="avatar">DY</span>
        </div>
      </header>
      <main className="page settings-page settings-workspace-page">
        <SettingsContent
          active={nav.active}
          visiblePages={nav.visiblePages}
          query={nav.query}
          onSelect={nav.selectPage}
          onQuery={nav.setQuery}
          hasPersonalRecord
          adminOttoSettings={undefined}
          profileSettings={<ProfileSettings data={profileData} mode="page" busy={false} onSave={async () => undefined} onNotify={() => undefined} />}
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
          updateDetail="Installed version 0.5.34 · up to date"
          updateStatus="idle"
          installedVersion="0.5.34"
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
