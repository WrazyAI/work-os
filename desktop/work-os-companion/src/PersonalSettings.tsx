import type { ReactNode } from "react";
import { SettingsBlock, FLAT_SETTINGS_BLOCKS } from "./settingsSections";
import type { MascotSize, TextSize, ThemePreference } from "./appearance";
import type { MemoryFact } from "./types";
import type { UpdateChannel } from "./updater";

/** The account's own settings — the groups the employee Settings page carries.
 * One component renders them on every surface that shows them, so the
 * employee workspace and the administration shell can never drift apart. The
 * administration shell also supplies its recap-follow group through the
 * `adminOttoSettings` slot; unlike the workday groups it always renders. */
export type PersonalSettingsProps = {
  /** Whether the account has its own workday record. The record-dependent
   * groups (profile, workday status, memory, suggestions, onboarding reset)
   * render only when it does. */
  hasPersonalRecord: boolean;
  /** The administration shell's own recap-follow group. It is deliberately
   * outside `hasPersonalRecord`: an administrator with no mapped employee day
   * still chooses which reviewed recaps alert them. */
  adminOttoSettings?: ReactNode;
  /** The employee Settings workspace renders the profile form inline on its
   * Profile page. The admin flat page omits this and keeps the row that opens
   * the profile modal. */
  profileSettings?: ReactNode;
  /** Which workspace's tour the Page guides group replays. */
  tourScope: "employee" | "admin";
  onReplayTour: () => void;
  onOpenProfile: () => void;
  autoStart: boolean;
  onAutoStart: (value: boolean) => void;
  voiceHotkeyEnabled: boolean;
  voiceHotkeyError?: string | null;
  onVoiceHotkey: (value: boolean) => void;
  /** The recap voice saved on this device. */
  recapVoice: string;
  onRecapVoice: (value: string) => void;
  autoCheckUpdates: boolean;
  onAutoCheckUpdates: (value: boolean) => void;
  updateChannel?: UpdateChannel;
  onUpdateChannel?: (value: UpdateChannel) => void;
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
  theme: ThemePreference;
  textSize: TextSize;
  mascotSize: MascotSize;
  onTheme: (value: ThemePreference) => void;
  onTextSize: (value: TextSize) => void;
  onMascotSize: (value: MascotSize) => void;
  queueCount: number;
  queueAttentionCount: number;
  sessionApiBase: string;
  /** Which agent-token surface the Session page manages: the employee's own
   * tokens or the administrator's organization-wide tokens. */
  agentAccessSurface: "employee" | "admin";
  /** Admin tokens are available only after the workspace enables the admin
   * agent API feature; the employee surface is always available. */
  adminAgentApiEnabled?: boolean;
  /** SettingsContent supplies this when it renders the Session page; the
   * inline Agent access view owns the rest. */
  onManageAgentAccess?: () => void;
  onSignOut: () => void;
  memory: { facts: MemoryFact[]; factTotals?: { confirmed: number; candidate: number }; loading: boolean; error: string | null };
  onOpenMemory: () => void;
  onRetryMemory: () => void;
  onOpenDebugger: () => void;
  onExportDiagnostics: () => void;
  onResetOnboarding: () => void;
  busy: boolean;
};

export function PersonalSettings(props: PersonalSettingsProps) {
  return <>{FLAT_SETTINGS_BLOCKS.map((block) => <SettingsBlock key={block} block={block} {...props} />)}</>;
}
