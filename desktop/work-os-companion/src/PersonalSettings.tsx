import { Bug, ChevronRight, LogOut, RotateCcw } from "lucide-react";
import { AppearanceSettings } from "./AppearanceSettings";
import { MemorySummary } from "./MemorySettings";
import { Setting } from "./Setting";
import { SettingsSwitch } from "./SettingsSwitch";
import { SuggestionReview } from "./SuggestionReview";
import { UPDATE_CHECK_CADENCE_COPY } from "./updater";
import type { MascotSize, TextSize } from "./appearance";
import type { MemoryFact } from "./types";

/** The account's own settings — the groups the employee Settings page carries.
 * One component renders them on every surface that shows them, so the
 * employee workspace and the administration shell can never drift apart. */
export type PersonalSettingsProps = {
  /** Whether the account has its own workday record. The record-dependent
   * groups (profile, workday status, memory, suggestions, onboarding reset)
   * render only when it does. */
  hasPersonalRecord: boolean;
  /** Which workspace's tour the Page guides group replays. */
  tourScope: "employee" | "admin";
  onReplayTour: () => void;
  onOpenProfile: () => void;
  autoStart: boolean;
  onAutoStart: (value: boolean) => void;
  voiceHotkeyEnabled: boolean;
  voiceHotkeyError?: string | null;
  onVoiceHotkey: (value: boolean) => void;
  autoCheckUpdates: boolean;
  onAutoCheckUpdates: (value: boolean) => void;
  /** The desktop updates row's plain-language state line. */
  updateDetail: string;
  updateStatus: "idle" | "available" | "downloaded" | "failed" | "checking" | "downloading" | "installing";
  /** The installed build's version, or null when nothing has reported one. */
  installedVersion: string | null;
  onCheckForUpdates: () => void;
  onDownloadUpdate: () => void;
  onInstallUpdate: () => void;
  onOpenWhatsNew: (version: string) => void;
  pageGuideAutoOpen: boolean;
  onPageGuideAutoOpen: (value: boolean) => void;
  textSize: TextSize;
  mascotSize: MascotSize;
  onTextSize: (value: TextSize) => void;
  onMascotSize: (value: MascotSize) => void;
  queueCount: number;
  queueAttentionCount: number;
  sessionApiBase: string;
  onSignOut: () => void;
  memory: { facts: MemoryFact[]; loading: boolean; error: string | null };
  onOpenMemory: () => void;
  onRetryMemory: () => void;
  onOpenDebugger: () => void;
  onExportDiagnostics: () => void;
  onResetOnboarding: () => void;
  busy: boolean;
};

export function PersonalSettings({
  hasPersonalRecord,
  tourScope,
  onReplayTour,
  onOpenProfile,
  autoStart,
  onAutoStart,
  voiceHotkeyEnabled,
  voiceHotkeyError,
  onVoiceHotkey,
  autoCheckUpdates,
  onAutoCheckUpdates,
  updateDetail,
  updateStatus,
  installedVersion,
  onCheckForUpdates,
  onDownloadUpdate,
  onInstallUpdate,
  onOpenWhatsNew,
  pageGuideAutoOpen,
  onPageGuideAutoOpen,
  textSize,
  mascotSize,
  onTextSize,
  onMascotSize,
  queueCount,
  queueAttentionCount,
  sessionApiBase,
  onSignOut,
  memory,
  onOpenMemory,
  onRetryMemory,
  onOpenDebugger,
  onExportDiagnostics,
  onResetOnboarding,
  busy,
}: PersonalSettingsProps) {
  const tourDetail = tourScope === "admin"
    ? "Plays every section's film in order — the same pass the administration guides offer. It moves the workspace to each section as it goes, and leaves you on the last one."
    : "Plays every page's film in order — the same pass a new workspace starts with. It moves the app to each page as it goes, and leaves you on the last one.";
  return (
    <>
      {hasPersonalRecord ? (
        <section className="settings-group" aria-labelledby="settings-profile-title">
          <header className="settings-group-head"><h3 id="settings-profile-title">Profile settings</h3></header>
          <section className="settings-panel">
            <Setting title="Workspace settings" detail="Name, photo, workday preferences, notifications, privacy, and work profile.">
              <button type="button" className="quiet-action" onClick={onOpenProfile}>Open profile settings <ChevronRight size={14} /></button>
            </Setting>
          </section>
        </section>
      ) : null}

      <section className="settings-group" aria-labelledby="settings-device-title">
        <header className="settings-group-head"><h3 id="settings-device-title">This device</h3></header>
        <section className="settings-panel">
          <Setting title="Start with Windows" detail="Open quietly in the tray after sign-in">
            <SettingsSwitch label="Start with Windows" checked={autoStart} onChange={onAutoStart} />
          </Setting>
          <Setting title="Hold-to-talk (Ctrl + M)" detail={voiceHotkeyError ?? "Hold Ctrl + M anywhere to record a voice update. Release to transcribe it."}>
            <SettingsSwitch label="Hold-to-talk (Ctrl + M)" checked={voiceHotkeyEnabled} onChange={onVoiceHotkey} />
          </Setting>
          <Setting title="Automatic update checks" detail={`Check on launch and ${UPDATE_CHECK_CADENCE_COPY}. We'll let you know when a new build is ready.`}>
            <SettingsSwitch label="Automatic update checks" checked={autoCheckUpdates} onChange={onAutoCheckUpdates} />
          </Setting>
          <Setting title="Desktop updates" detail={updateDetail}>
            <span className="setting-controls">
              {updateStatus === "idle" && <button type="button" className="quiet-action" onClick={onCheckForUpdates}>Check</button>}
              {(updateStatus === "available" || updateStatus === "failed") && <button type="button" className="quiet-action" onClick={onDownloadUpdate}>{updateStatus === "failed" ? "Retry" : "Download"}</button>}
              {updateStatus === "downloaded" && <button type="button" className="quiet-action" onClick={onInstallUpdate}>Install</button>}
              {updateStatus === "checking" && <span className="status-chip">Checking</span>}
              {updateStatus === "downloading" && <span className="status-chip">Downloading</span>}
              {updateStatus === "installing" && <span className="status-chip">Installing</span>}
              {installedVersion && <button type="button" className="quiet-action" onClick={() => onOpenWhatsNew(installedVersion)}>What's new</button>}
            </span>
          </Setting>
        </section>
      </section>

      <section className="settings-group" aria-labelledby="settings-guides-title">
        <header className="settings-group-head"><h3 id="settings-guides-title">Page guides</h3></header>
        <section className="settings-panel">
          <Setting title="Show page guides automatically" detail="Each page's guide opens once the first time you visit it. Open any page's guide again from the ? in the header.">
            <SettingsSwitch label="Show page guides automatically" checked={pageGuideAutoOpen} onChange={onPageGuideAutoOpen} />
          </Setting>
          <Setting title="Walk through the workspace again" detail={tourDetail}>
            <button type="button" className="quiet-action" onClick={onReplayTour}>Replay the full tour</button>
          </Setting>
        </section>
      </section>

      <AppearanceSettings
        textSize={textSize}
        mascotSize={mascotSize}
        onTextSize={onTextSize}
        onMascotSize={onMascotSize}
      />

      {hasPersonalRecord ? (
        <section className="settings-group" aria-labelledby="settings-workday-title">
          <header className="settings-group-head"><h3 id="settings-workday-title">Workday</h3></header>
          <section className="settings-panel">
            <Setting title="Scheduled check-ins" detail="Check-ins appear with Otto when they're due. Snooze them from the floating companion."><span className="status-chip">Avatar</span></Setting>
            <Setting title="Evidence" detail="Output evidence is temporarily hidden while the surface is being prepared."><span className="status-chip">Hidden</span></Setting>
          </section>
        </section>
      ) : null}

      <section className="settings-group" aria-labelledby="settings-sync-title">
        <header className="settings-group-head"><h3 id="settings-sync-title">Sync &amp; session</h3></header>
        <section className="settings-panel">
          <Setting title="Offline queue" detail={queueAttentionCount ? `${queueAttentionCount} update${queueAttentionCount === 1 ? "" : "s"} need attention` : queueCount ? `${queueCount} updates waiting to sync` : "Everything is synced"}><span className={`status-chip${queueAttentionCount ? " attention" : ""}`}>{queueAttentionCount ? "Needs attention" : "Ready"}</span></Setting>
          <Setting title="Account session" detail={`Signed in through ${sessionApiBase}`}><button type="button" className="quiet-action danger" disabled={busy} onClick={onSignOut}><LogOut size={15} /> Sign out</button></Setting>
        </section>
      </section>

      {hasPersonalRecord ? (
        <>
          <MemorySummary
            facts={memory.facts}
            loading={memory.loading}
            error={memory.error}
            onOpen={onOpenMemory}
            onRetry={onRetryMemory}
          />
          <SuggestionReview />
        </>
      ) : null}

      <section className="settings-group" aria-labelledby="settings-diagnostics-title">
        <header className="settings-group-head"><h3 id="settings-diagnostics-title">Diagnostics</h3></header>
        <section className="settings-panel">
          <Setting title="Scenario debugger" detail="Open the diagnostics window. Ctrl+Shift+D"><button type="button" className="quiet-action" onClick={onOpenDebugger}><Bug size={15} /> Open</button></Setting>
          <Setting title="Export diagnostics" detail="Create a redacted ZIP of recent events. Tokens and queue bodies stay out."><button type="button" className="quiet-action" onClick={onExportDiagnostics}>Export</button></Setting>
        </section>
      </section>

      {hasPersonalRecord ? (
        <section className="settings-group danger" aria-labelledby="settings-danger-title">
          <header className="settings-group-head"><h3 id="settings-danger-title">Reset</h3></header>
          <section className="settings-panel">
            <Setting title="Restart onboarding" detail="Clear your personal setup answers and return to onboarding."><button type="button" className="quiet-action danger" disabled={busy} onClick={onResetOnboarding}><RotateCcw size={15} /> Reset</button></Setting>
          </section>
        </section>
      ) : null}
    </>
  );
}
