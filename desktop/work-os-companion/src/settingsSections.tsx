import type { ReactNode } from "react";
import { Activity, BookOpen, Bot, Bug, CalendarDays, ChevronRight, Info, KeyRound, Palette, RotateCcw, SlidersHorizontal, UserRound } from "lucide-react";
import { SessionSettings } from "./SessionSettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { MemorySummary } from "./MemorySettings";
import { Setting } from "./Setting";
import { SettingsChoice } from "./SettingsChoice";
import { VoicePicker } from "./VoicePicker";
import { SettingsSwitch } from "./SettingsSwitch";
import { SuggestionReview } from "./SuggestionReview";
import { UPDATE_CHECK_CADENCE_COPY, type UpdateChannel } from "./updater";
import type { PersonalSettingsProps } from "./PersonalSettings";

/** One page in the settings workspace. `blocks` are the existing settings
 * groups rendered inside that page, in order. */
export type SettingsPageId = "profile" | "workday" | "session" | "general" | "appearance" | "voice" | "otto" | "guides" | "diagnostics" | "reset" | "about";
export type SettingsBlockId = SettingsPageId | "recap" | "memory";

export type SettingsNavPage<T extends string = string> = {
  id: T;
  label: string;
  group: string;
  icon: typeof UserRound;
  description: string;
  keywords: string[];
  requiresPersonalRecord?: boolean;
  /** The page title already names the first group; hide its duplicate head. */
  hideFirstGroupHead?: boolean;
};

export type SettingsPageMeta = SettingsNavPage<SettingsPageId> & {
  blocks: SettingsBlockId[];
};

export const SETTINGS_PAGES: SettingsPageMeta[] = [
  {
    id: "profile", label: "Profile", group: "Account", icon: UserRound,
    description: "Identity, schedule, privacy, notifications, and your work profile.",
    keywords: ["name", "photo", "email", "timezone", "schedule", "privacy", "notifications", "work profile"],
    requiresPersonalRecord: true, hideFirstGroupHead: true, blocks: ["profile"],
  },
  {
    id: "workday", label: "Workday", group: "Account", icon: CalendarDays,
    description: "What Work OS records about your workday.",
    keywords: ["check-ins", "check ins", "evidence", "attendance", "workday"],
    requiresPersonalRecord: true, hideFirstGroupHead: true, blocks: ["workday"],
  },
  {
    id: "session", label: "Session", group: "Account", icon: KeyRound,
    description: "Your signed-in account and queued updates.",
    keywords: ["sign out", "account", "offline", "queue", "sync", "session"],
    blocks: ["session"],
  },
  {
    id: "general", label: "General", group: "App", icon: SlidersHorizontal,
    description: "Startup, voice input, and updates on this device.",
    keywords: ["start with windows", "startup", "hold to talk", "shortcut", "updates", "automatic", "version", "channel", "nightly", "stable"],
    blocks: ["general"],
  },
  {
    id: "appearance", label: "Appearance", group: "App", icon: Palette,
    description: "Theme, text size, and mascot size on this device.",
    keywords: ["theme", "dark", "light", "system", "text size", "mascot", "appearance"],
    hideFirstGroupHead: true, blocks: ["appearance"],
  },
  {
    id: "voice", label: "Voice", group: "App", icon: Bot,
    description: "How recaps are read to you on this device.",
    keywords: ["voice", "recap", "audio", "read", "warm", "calm", "bright", "deep"],
    blocks: ["voice"],
  },
  {
    id: "otto", label: "Otto memory", group: "App", icon: Bot,
    description: "What Otto remembers and the suggestions waiting for review.",
    keywords: ["memory", "remember", "suggestions", "review", "forget", "otto"],
    requiresPersonalRecord: true, blocks: ["memory"],
  },
  {
    id: "guides", label: "Page guides", group: "App", icon: BookOpen,
    description: "Page guides and the full workspace tour.",
    keywords: ["guides", "tour", "walkthrough", "onboarding"],
    hideFirstGroupHead: true, blocks: ["guides"],
  },
  {
    id: "diagnostics", label: "Diagnostics", group: "Data & privacy", icon: Activity,
    description: "Open the scenario debugger or export a redacted diagnostics archive.",
    keywords: ["debugger", "diagnostics", "export", "logs"],
    hideFirstGroupHead: true, blocks: ["diagnostics"],
  },
  {
    id: "reset", label: "Reset", group: "Data & privacy", icon: RotateCcw,
    description: "Clear your personal setup and return to onboarding.",
    keywords: ["reset", "onboarding", "restart", "clear"],
    requiresPersonalRecord: true, hideFirstGroupHead: true, blocks: ["reset"],
  },
  {
    id: "about", label: "About", group: "", icon: Info,
    description: "The installed build, updates, and what's new.",
    keywords: ["about", "version", "what's new", "release"],
    blocks: ["about"],
  },
];

/** The flat order retained by the embedded administration settings page. */
export const FLAT_SETTINGS_BLOCKS: SettingsBlockId[] = [
  "profile", "general", "recap", "voice", "guides", "appearance", "workday", "session", "memory", "diagnostics", "reset",
];

export function SettingsBlock({ block, ...props }: { block: SettingsBlockId } & PersonalSettingsProps): ReactNode {
  switch (block) {
    case "profile":
      if (!props.hasPersonalRecord) return null;
      if (props.profileSettings) return props.profileSettings;
      return <section className="settings-group" aria-labelledby="settings-profile-title">
        <header className="settings-group-head"><h3 id="settings-profile-title">Profile settings</h3></header>
        <section className="settings-panel">
          <Setting title="Workspace settings" detail="Name, photo, workday preferences, notifications, privacy, and work profile.">
            <button type="button" className="quiet-action" onClick={props.onOpenProfile}>Open profile settings <ChevronRight size={14} /></button>
          </Setting>
        </section>
      </section>;

    case "general":
      return <section className="settings-group" aria-labelledby="settings-device-title">
        <header className="settings-group-head"><h3 id="settings-device-title">This device</h3></header>
        <section className="settings-panel">
          <Setting title="Start with Windows" detail="Open quietly in the tray after sign-in">
            <SettingsSwitch label="Start with Windows" checked={props.autoStart} onChange={props.onAutoStart} />
          </Setting>
          <Setting title="Hold-to-talk (Ctrl + M)" detail={props.voiceHotkeyError ?? "Hold Ctrl + M anywhere to record a voice update. Release to transcribe it."}>
            <SettingsSwitch label="Hold-to-talk (Ctrl + M)" checked={props.voiceHotkeyEnabled} onChange={props.onVoiceHotkey} />
          </Setting>
          <Setting title="Automatic update checks" detail={`Check on launch and ${UPDATE_CHECK_CADENCE_COPY}. We'll let you know when a new build is ready.`}>
            <SettingsSwitch label="Automatic update checks" checked={props.autoCheckUpdates} onChange={props.onAutoCheckUpdates} />
          </Setting>
          <Setting
            title="Release channel"
            detail={(props.updateChannel ?? "stable") === "nightly"
              ? "Nightly receives frequent developer builds (Windows-first) before weekly Friday Stable promotion."
              : "Stable receives weekly tested builds for Windows and macOS."}
          >
            <SettingsChoice<UpdateChannel>
              label="Release channel"
              value={props.updateChannel ?? "stable"}
              disabled={props.updateStatus === "downloading" || props.updateStatus === "installing"}
              onChange={(value) => props.onUpdateChannel?.(value)}
              options={[
                { value: "stable", label: "Stable", accessibleLabel: "Stable weekly builds" },
                { value: "nightly", label: "Nightly", accessibleLabel: "Nightly developer builds" },
              ]}
            />
          </Setting>
          <Setting title="Desktop updates" detail={props.updateDetail}>
            <span className="setting-controls">
              {props.updateStatus === "idle" && <button type="button" className="quiet-action" onClick={props.onCheckForUpdates}>Check</button>}
              {(props.updateStatus === "available" || props.updateStatus === "failed") && <button type="button" className="quiet-action" onClick={props.onDownloadUpdate}>{props.updateStatus === "failed" ? "Retry" : "Download"}</button>}
              {props.updateStatus === "downloaded" && <button type="button" className="quiet-action" onClick={props.onInstallUpdate}>Install</button>}
              {props.updateStatus === "checking" && <span className="status-chip">Checking</span>}
              {props.updateStatus === "downloading" && <span className="status-chip">Downloading</span>}
              {props.updateStatus === "installing" && <span className="status-chip">Installing</span>}
              {props.installedVersion && <button type="button" className="quiet-action" onClick={() => props.onOpenWhatsNew(props.installedVersion!)}>What's new</button>}
            </span>
          </Setting>
        </section>
      </section>;

    case "recap":
      return props.adminOttoSettings ?? null;

    case "voice":
      return <section className="settings-group" aria-labelledby="settings-voice-title">
        <header className="settings-group-head"><h3 id="settings-voice-title">Otto's voice</h3></header>
        <div className="settings-voice">
          <p className="settings-group-note">How recaps are read to you, on this device.</p>
          <VoicePicker value={props.recapVoice} onChange={props.onRecapVoice} />
        </div>
      </section>;

    case "guides":
      return <section className="settings-group" aria-labelledby="settings-guides-title">
        <header className="settings-group-head"><h3 id="settings-guides-title">Page guides</h3></header>
        <section className="settings-panel">
          <Setting title="Show page guides automatically" detail="Each page's guide opens once the first time you visit it. Open any page's guide again from the ? in the header.">
            <SettingsSwitch label="Show page guides automatically" checked={props.pageGuideAutoOpen} onChange={props.onPageGuideAutoOpen} />
          </Setting>
          <Setting title="Walk through the workspace again" detail={props.tourScope === "admin"
            ? "Plays every section's film in order — the same pass the administration guides offer. It moves the workspace to each section as it goes, and leaves you on the last one."
            : "Plays every page's film in order — the same pass a new workspace starts with. It moves the app to each page as it goes, and leaves you on the last one."}>
            <button type="button" className="quiet-action" onClick={props.onReplayTour}>Replay the full tour</button>
          </Setting>
        </section>
      </section>;

    case "appearance":
      return <AppearanceSettings
        theme={props.theme}
        textSize={props.textSize}
        mascotSize={props.mascotSize}
        onTheme={props.onTheme}
        onTextSize={props.onTextSize}
        onMascotSize={props.onMascotSize}
      />;

    case "workday":
      if (!props.hasPersonalRecord) return null;
      return <section className="settings-group" aria-labelledby="settings-workday-title">
        <header className="settings-group-head"><h3 id="settings-workday-title">Workday</h3></header>
        <section className="settings-panel">
          <Setting title="Scheduled check-ins" detail="Check-ins appear with Otto when they're due. Snooze them from the floating companion."><span className="status-chip">Avatar</span></Setting>
          <Setting title="Evidence" detail="Output evidence is temporarily hidden while the surface is being prepared."><span className="status-chip">Hidden</span></Setting>
        </section>
      </section>;

    case "session":
      return <SessionSettings
        queueCount={props.queueCount}
        queueAttentionCount={props.queueAttentionCount}
        sessionApiBase={props.sessionApiBase}
        busy={props.busy}
        onSignOut={props.onSignOut}
        agentAccessSurface={props.agentAccessSurface}
        adminAgentApiEnabled={props.adminAgentApiEnabled}
        onManageAgentAccess={props.onManageAgentAccess ?? (() => undefined)}
      />;

    case "memory":
      if (!props.hasPersonalRecord) return null;
      return <>
        <MemorySummary
          facts={props.memory.facts}
          factTotals={props.memory.factTotals}
          loading={props.memory.loading}
          error={props.memory.error}
          onOpen={props.onOpenMemory}
          onRetry={props.onRetryMemory}
        />
        <SuggestionReview />
      </>;

    case "diagnostics":
      return <section className="settings-group" aria-labelledby="settings-diagnostics-title">
        <header className="settings-group-head"><h3 id="settings-diagnostics-title">Diagnostics</h3></header>
        <section className="settings-panel">
          <Setting title="Scenario debugger" detail="Open the diagnostics window. Ctrl+Shift+D"><button type="button" className="quiet-action" onClick={props.onOpenDebugger}><Bug size={15} /> Open</button></Setting>
          <Setting title="Export diagnostics" detail="Create a redacted ZIP of recent events. Tokens and queue bodies stay out."><button type="button" className="quiet-action" onClick={props.onExportDiagnostics}>Export</button></Setting>
        </section>
      </section>;

    case "reset":
      if (!props.hasPersonalRecord) return null;
      return <section className="settings-group danger" aria-labelledby="settings-danger-title">
        <header className="settings-group-head"><h3 id="settings-danger-title">Reset</h3></header>
        <section className="settings-panel">
          <Setting title="Restart onboarding" detail="Clear your personal setup answers and return to onboarding."><button type="button" className="quiet-action danger" disabled={props.busy} onClick={props.onResetOnboarding}><RotateCcw size={15} /> Reset</button></Setting>
        </section>
      </section>;

    case "about":
      return <section className="settings-group" aria-labelledby="settings-about-title">
        <header className="settings-group-head"><h3 id="settings-about-title">About Work OS</h3></header>
        <section className="settings-panel">
          <Setting title="Installed version" detail="The build running on this device."><span className="status-chip">{props.installedVersion ?? "Unavailable"}</span></Setting>
          <Setting title="What's new" detail="Read the release notes for the installed build."><button type="button" className="quiet-action" disabled={!props.installedVersion} onClick={() => { if (props.installedVersion) props.onOpenWhatsNew(props.installedVersion); }}>Open</button></Setting>
        </section>
      </section>;
  }
}

