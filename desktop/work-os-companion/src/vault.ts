import { invoke, isTauri } from "@tauri-apps/api/core";
import { openVaultWhenReady, reportVaultRetry } from "./vaultStartup";
import { diagnostics } from "./diagnostics";
import { markStartupTiming, startupWindowLabel } from "./bootTrace";
import type { DayData, DesktopSession, OfflineAction } from "./types";
import type { PendingToolReview, ProposedOperation, ToolCallResult } from "./interpretation";
import type { RecapNextStepsMoment } from "./RecapNextStepsCard";
import { mergeConversationTurns } from "./avatarLogic";
import { sessionStateFrom, type SessionState } from "./sessionState";
import { APPEARANCE_DEFAULTS, normalizeAppearance, type MascotSize, type TextSize, type ThemePreference } from "./appearance";
import { normalizeUpdateChannel, type UpdateChannel } from "./updater";
import type { CachedGuideState, GuideState } from "./guideState";

export interface WorkOsSettings {
  apiBase: string;
  /** The voice recaps are read in; absent means the first shipped voice. */
  recapVoice?: string;
  /** Launch update check. Absent historically means on. */
  autoCheckUpdates: boolean;
  /** Desktop release channel: Stable (weekly) or Nightly (developer testing). */
  updateChannel: UpdateChannel;
  /** Hold-to-talk shortcut (`Ctrl + M`). Absent historically means on. */
  voiceHotkey: boolean;
  /** Accessibility appearance, per device; see `appearance.ts`. */
  textSize: TextSize;
  mascotSize: MascotSize;
  /** Light, Dark, or follow the device. Per device, never account state. */
  theme: ThemePreference;
  /** The one-time first-login theme prompt has been answered or dismissed. */
  themePromptSeen: boolean;
}

/** Merge one settings change over the stored record, normalizing appearance
 * and preserving prompt history. The pure seam keeps the one-write contract
 * testable without a vault. */
export function mergeWorkOsSettings(current: WorkOsSettings | null, next: Partial<WorkOsSettings>): WorkOsSettings {
  const base: WorkOsSettings = current ?? {
    apiBase: httpsOrigin(defaultApiBase),
    autoCheckUpdates: true,
    updateChannel: "stable",
    voiceHotkey: true,
    ...APPEARANCE_DEFAULTS,
    themePromptSeen: false,
  };
  const appearance = normalizeAppearance({
    textSize: next.textSize ?? base.textSize,
    mascotSize: next.mascotSize ?? base.mascotSize,
    theme: next.theme ?? base.theme,
  });
  const recapVoice = next.recapVoice ?? base.recapVoice;
  return {
    apiBase: next.apiBase === undefined ? base.apiBase : httpsOrigin(next.apiBase),
    autoCheckUpdates: next.autoCheckUpdates ?? base.autoCheckUpdates,
    updateChannel: normalizeUpdateChannel(next.updateChannel ?? base.updateChannel),
    voiceHotkey: next.voiceHotkey ?? base.voiceHotkey,
    ...appearance,
    ...(recapVoice === undefined ? {} : { recapVoice }),
    themePromptSeen: next.themePromptSeen === undefined ? base.themePromptSeen === true : next.themePromptSeen === true,
  };
}

export interface WorkOsConversationTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  meta?: string;
  createdAt: string;
  /** Pending tool calls awaiting employee approval. Persisted so a reload or
   * cross-window sync never drops an approval card mid-review. */
  operations?: ProposedOperation[];
  /** Filed results stay visible as the receipt for an approved tool call. */
  toolResults?: ToolCallResult[];
  /** The post-approval recap next-steps moment. Persisted for the same reason:
   * a reload or cross-window sync must never drop the card mid-decision. */
  nextSteps?: RecapNextStepsMoment;
}

interface VaultLease { generation: number; reused: boolean }
let context: Promise<VaultLease> | null = null;

/** Chat scopes are dynamic keys; remember every scope this device wrote so a
 * sign-out can clear another employee's conversations and pending reviews. */
const CHAT_SCOPE_KEYS = "chat-scope-keys";
async function rememberChatScope(scope: string, lease = vault()) {
  try {
    const keys = new Set((await get<string[]>(CHAT_SCOPE_KEYS, lease)) ?? []);
    const before = keys.size;
    keys.add(`conversation:${scope}`);
    keys.add(`pending-tools:${scope}`);
    if (keys.size !== before) await set(CHAT_SCOPE_KEYS, [...keys], lease);
  } catch (error) {
    // A durable failure retires the lease; let the caller retry on a fresh one.
    // Other failures stay best-effort so a registry issue never blocks a save.
    if (isStorageRetirement(error)) throw error;
  }
}
const defaultApiBase = import.meta.env.VITE_WORK_OS_API_URL || "https://app.wrazyos.com";

function httpsOrigin(value: string) {
  const url = new URL(value);
  // Dev-fixture loopback (see browserSession): the dev proxy makes API calls
  // same-origin, so the packaged HTTPS rule does not apply to the dev server.
  const devLoopback = import.meta.env.DEV && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (url.protocol !== "https:" && !devLoopback) throw new Error("Use the HTTPS WrazyOS URL.");
  return url.origin;
}

/** Every WebView attaches to the same native owner; no password crosses IPC. */
async function openVault() {
  return invoke<VaultLease>("open_local_vault");
}

// Deliberately not async: callers may compare the returned promise identity when
// retiring only the failed attempt, without wrapping it in a fresh promise.
function vault(): Promise<VaultLease> {
  if (!context) {
    const pending = (async () => {
      const startedAt = performance.now();
      const windowLabel = startupWindowLabel(window.location?.search ?? "");
      diagnostics.info("vault.open.started", "Opening the local vault", { window: windowLabel });
      // The host registers the password worker and the Stronghold plugin while
      // it starts; a first launch that loses that race must not cost the
      // employee a refresh, so the open retries inside this one attempt.
      const opened = await openVaultWhenReady(openVault, { onRetry: reportVaultRetry });
      // The gate above this is the only thing the employee sees while this
      // runs, so a slow open has to leave a trail to diagnose.
      const durationMs = Math.round(performance.now() - startedAt);
      diagnostics.info("vault.open.ready", `Opened the local vault in ${durationMs}ms`, { window: windowLabel, reused: opened.reused }, { durationMs });
      markStartupTiming("vault_wait", startedAt, opened.reused);
      return opened;
    })();
    context = pending;
    void pending.catch((error) => {
      diagnostics.error("vault.open.failed", error instanceof Error ? error.message : String(error));
      if (context === pending) context = null;
    });
  }
  return context;
}

/** Retires the in-flight vault open so the next read starts a fresh attempt.
 *
 * A read waiting on a macOS password dialog keeps running in the host — the
 * answer is cached there, so the next attempt is instant — but its promise must
 * not be reused, or the retry would wait on the same unanswered dialog. */
export function abandonVaultOpen() {
  context = null;
}

/** Starts this device fresh: replaces the local vault and its key. Used only
 * when the stored key cannot be read, so the local data cannot be opened at
 * all. Anything already filed with the server is untouched. */
export async function resetLocalVault(): Promise<void> {
  abandonVaultOpen();
  if (!isTauri()) return;
  await invoke("reset_local_vault");
}

async function get<T>(key: string, lease = vault()): Promise<T | null> {
    const opened = await lease;
    try {
      const value = await invoke<number[] | null>("read_local_vault", { generation: opened.generation, key });
      if (!value) return null;
      return JSON.parse(new TextDecoder().decode(new Uint8Array(value))) as T;
    } catch (error) {
      if (retiresLease(error)) retireLease(lease);
      throw error;
    }
}

async function set(key: string, value: unknown, lease = vault()) {
  const opened = await lease;
  try {
    await invoke("write_local_vault", { generation: opened.generation, key, value: [...new TextEncoder().encode(JSON.stringify(value))] });
  } catch (error) { if (retiresLease(error)) retireLease(lease); throw error; }
}

async function remove(key: string, lease = vault()) {
  const opened = await lease;
  try { await invoke("remove_local_vault", { generation: opened.generation, key }); }
  catch (error) { if (retiresLease(error)) retireLease(lease); throw error; }
}

/** The native owner retires a live instance after any failed durable operation,
 * not only an explicit reset. Keeping its old generation would strand the next
 * read or save, so drop the cached lease without replaying the failed payload. */
function retiresLease(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "stale_generation" || code === "storage_failed" || code === "unavailable";
}

/** Retire only the attempt that failed; a newer lease cached meanwhile is still
 * valid and must not be discarded by a late rejection from an older attempt. */
function retireLease(attempt: Promise<VaultLease>) {
  if (context === attempt) abandonVaultOpen();
}

/** A storage failure retires the native instance without changing accounts, so
 * a chat write that has not committed can safely retry on a fresh lease. A
 * reset/stale generation is never replayed. */
function isStorageRetirement(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "storage_failed" || code === "unavailable";
}

async function withStorageRetry<T>(run: (lease: Promise<VaultLease>) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    const lease = vault();
    try {
      return await run(lease);
    } catch (error) {
      if (attempt >= 1 || !isStorageRetirement(error)) throw error;
      retireLease(lease);
    }
  }
}

/** Dev-fixture only (mirrors the ?preview-* bootstrap): a dev server URL with
 * ?token=<desktop session token> boots the browser build signed in, so E2E
 * suites can exercise the real planner against the real API. Never active in
 * the packaged app, and the token is never persisted. The organization id is
 * resolved from the API because every request carries it. */
let browserSessionCache: DesktopSession | null = null;
async function browserSession(): Promise<DesktopSession | null> {
  if (!import.meta.env.DEV) return null;
  const params = new URLSearchParams(window.location.search);
  if (params.has("offline")) return null;
  if (browserSessionCache) return browserSessionCache;
  const token = params.get("token");
  if (!token) return null;
  const apiBase = defaultApiBase;
  const response = await fetch(`${apiBase.replace(/\/$/, "")}/api/work-os/session`, {
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!response || !response.ok) return null;
  const access = (await response.json().catch(() => null)) as { organizationId?: string } | null;
  if (!access?.organizationId) return null;
  browserSessionCache = { token, expiresAt: new Date(Date.now() + 24 * 3_600_000).toISOString(), organizationId: access.organizationId, apiBase };
  return browserSessionCache;
}

/* Serialize the whole settings read/merge/write. Two appearance controls can
 * save together; merging both from the same stale read would drop one. */
let settingsWriteQueue: Promise<void> = Promise.resolve();

export const secureState = {
  /** The stored session and why it is unusable when it is. The boot path uses
   * the reason so the employee is told to connect the device again, instead of
   * landing in a workspace whose every request the API layer refuses. */
  sessionState: async (): Promise<SessionState> => {
    if (!isTauri()) return { session: await browserSession(), reason: "none" };
    return sessionStateFrom(await get<DesktopSession>("session"), httpsOrigin);
  },
  session: async () => (await secureState.sessionState()).session,
  saveSession: (session: DesktopSession) => isTauri() ? set("session", session) : Promise.resolve(),
  clearSession: () => isTauri() ? remove("session") : Promise.resolve(),
  clearAccount: async (expectedToken?: string | null) => {
    if (!isTauri()) return;
    // Sign-out is idempotent: another window can retire this lease mid-cleanup
    // (a reset or failed durable save), so resume from the start on a fresh one
    // instead of abandoning the remaining employee records.
    let startingToken: string | null = expectedToken ?? null;
    let tokenKnown = expectedToken !== undefined;
    for (let attempt = 0; ; attempt += 1) {
      const lease = vault();
      try {
        const currentToken = sessionStateFrom(await get<DesktopSession>("session", lease), httpsOrigin).session?.token ?? null;
        if (!tokenKnown) {
          // The initiating read failed, so the account token is unknown. Never
          // adopt a session that appeared during the retry: it belongs to
          // whoever signed in afterwards.
          if (attempt > 0 && currentToken !== null) return;
          startingToken = currentToken;
          tokenKnown = true;
        // A different account may have signed in while this cleanup was waiting
        // for a retired lease. Its session is the new authority; never delete it.
        } else if (currentToken !== null && currentToken !== startingToken) return;
        await remove("session", lease);
        await remove("pending-auth", lease);
        await remove("offline-queue", lease);
        await remove("day-snapshot", lease);
        await remove("query-cache", lease);
        await remove("guide-state", lease);
        // Conversations and pending approval cards are per-shift keys; remove each
        // scope this device wrote so a sign-out leaves no employee data behind.
        const scopes = (await get<string[]>(CHAT_SCOPE_KEYS, lease)) ?? [];
        for (const key of scopes) await remove(key, lease);
        await remove(CHAT_SCOPE_KEYS, lease);
        break;
      } catch (error) {
        if (attempt >= 2 || !retiresLease(error)) throw error;
        retireLease(lease);
      }
    }
    // Device-local notification state is not account-scoped by nature, so a
    // sign-out must clear it or the next person on this device inherits a
    // suppressed nudge or a snooze they never set.
    if (typeof localStorage !== "undefined") {
      for (const key of ["work-os.avatar.position.v1", "work-os.avatar.notified.v1", "work-os.avatar.snooze.v1"]) {
        localStorage.removeItem(key);
      }
    }
  },
  queue: async () => isTauri() ? (await get<OfflineAction[]>("offline-queue")) ?? [] : [],
  saveQueue: (queue: OfflineAction[]) => isTauri() ? set("offline-queue", queue) : Promise.resolve(),
  daySnapshot: async () => {
    if (!isTauri()) return null;
    const [session, snapshot] = await Promise.all([
      secureState.session(),
      get<{ savedAt: string; organizationId: string; token: string; day: DayData }>("day-snapshot"),
    ]);
    if (!session || !snapshot || snapshot.organizationId !== session.organizationId || snapshot.token !== session.token || Date.now() - Date.parse(snapshot.savedAt) > 5 * 60_000) return null;
    return snapshot.day;
  },
  saveDaySnapshot: async (day: DayData) => {
    if (!isTauri()) return;
    const lease = vault();
    const session = sessionStateFrom(await get<DesktopSession>("session", lease), httpsOrigin).session;
    if (session) await set("day-snapshot", { savedAt: new Date().toISOString(), organizationId: session.organizationId, token: session.token, day }, lease);
  },
  /** Persisted TanStack Query cache. Renders last-known work instantly on
   * relaunch; background revalidation keeps it truthful. 24h ceiling. */
  queryCache: async () => {
    if (!isTauri()) return null;
    const [session, snapshot] = await Promise.all([
      secureState.session(),
      get<{ savedAt: string; organizationId: string; token: string; state: string }>("query-cache"),
    ]);
    if (!session || !snapshot || snapshot.organizationId !== session.organizationId || snapshot.token !== session.token || Date.now() - Date.parse(snapshot.savedAt) > 24 * 60 * 60_000) return null;
    return snapshot;
  },
  saveQueryCache: async (state: string) => {
    if (!isTauri()) return;
    const lease = vault();
    const session = sessionStateFrom(await get<DesktopSession>("session", lease), httpsOrigin).session;
    if (session) await set("query-cache", { savedAt: new Date().toISOString(), organizationId: session.organizationId, token: session.token, state }, lease);
  },
  clearQueryCache: () => isTauri() ? remove("query-cache") : Promise.resolve(),
  /** Last-known page-guide flags, account-scoped. Reconciled with the server on
   * every load so a mark or opt-out that landed offline is retried, never
   * silently dropped. */
  guideState: async (): Promise<CachedGuideState | null> => {
    if (!isTauri()) return null;
    const [session, cached] = await Promise.all([secureState.session(), get<CachedGuideState>("guide-state")]);
    if (!session || !cached || cached.organizationId !== session.organizationId) return null;
    return cached;
  },
  saveGuideState: async (value: { organizationId: string; state: GuideState; pendingAutoOpen: boolean | null }) => {
    if (!isTauri()) return;
    await set("guide-state", { ...value, savedAt: new Date().toISOString() });
  },
  conversation: async (scope: string) => isTauri() ? (await get<WorkOsConversationTurn[]>(`conversation:${scope}`)) ?? [] : [],
  /** Additive save: merge with what another window already wrote instead of
   * overwriting it, so a shared review turn can never be clobbered. */
  saveConversation: (scope: string, turns: WorkOsConversationTurn[]) => {
    if (!isTauri()) return Promise.resolve();
    return withStorageRetry(async (lease) => {
      await rememberChatScope(scope, lease);
      const stored = (await get<WorkOsConversationTurn[]>(`conversation:${scope}`, lease)) ?? [];
      await set(`conversation:${scope}`, mergeConversationTurns(stored, turns), lease);
    });
  },
  clearConversation: (scope: string) => isTauri() ? remove(`conversation:${scope}`) : Promise.resolve(),
  /** Latest pending tool review for the scope, shared by the main window and
   * the avatar so cards raised in either surface appear in both. */
  pendingTools: async (scope: string) => isTauri() ? (await get<PendingToolReview>(`pending-tools:${scope}`)) ?? null : null,
  savePendingTools: (scope: string, review: PendingToolReview) => {
    if (!isTauri()) return Promise.resolve();
    return withStorageRetry(async (lease) => {
      await rememberChatScope(scope, lease);
      await set(`pending-tools:${scope}`, review, lease);
    });
  },
  clearPendingTools: (scope: string) => isTauri() ? remove(`pending-tools:${scope}`) : Promise.resolve(),
  pendingAuth: async () => {
    if (!isTauri()) return null;
    const pending = await get<{ verifier: string; state: string; apiBase: string }>("pending-auth");
    if (!pending) return null;
    try { return { ...pending, apiBase: httpsOrigin(pending.apiBase) }; }
    catch { await remove("pending-auth"); return null; }
  },
  savePendingAuth: (value: { verifier: string; state: string; apiBase: string }) => isTauri() ? set("pending-auth", value) : Promise.resolve(),
  clearPendingAuth: () => isTauri() ? remove("pending-auth") : Promise.resolve(),
  settings: async (): Promise<WorkOsSettings> => {
    if (!isTauri()) return {
      apiBase: httpsOrigin(defaultApiBase),
      autoCheckUpdates: true,
      updateChannel: "stable",
      voiceHotkey: true,
      ...APPEARANCE_DEFAULTS,
      themePromptSeen: true,
    };
    const lease = vault();
    const settings = await get<{ apiBase?: string; autoCheckUpdates?: boolean; updateChannel?: unknown; voiceHotkey?: boolean; textSize?: unknown; mascotSize?: unknown; theme?: unknown; themePromptSeen?: unknown; recapVoice?: unknown }>("settings", lease);
    const stored = mergeWorkOsSettings(null, {
      autoCheckUpdates: settings?.autoCheckUpdates !== false,
      updateChannel: normalizeUpdateChannel(settings?.updateChannel),
      voiceHotkey: settings?.voiceHotkey !== false,
      ...normalizeAppearance(settings),
      themePromptSeen: settings?.themePromptSeen === true,
      ...(typeof settings?.recapVoice === "string" ? { recapVoice: settings.recapVoice } : {}),
    });
    try {
      return mergeWorkOsSettings(stored, { apiBase: settings?.apiBase || defaultApiBase });
    } catch {
      // A recovery write is still a settings write: queue it and re-read so it
      // cannot overwrite a newer theme or prompt choice saved meanwhile.
      const recovery = settingsWriteQueue.then(async () => {
        // A queued write starts after earlier work may have retired the lease.
        // Acquire when the task runs, then keep its read and write together.
        const queuedLease = vault();
        const latest = await get<{ apiBase?: string; autoCheckUpdates?: boolean; updateChannel?: unknown; voiceHotkey?: boolean; textSize?: unknown; mascotSize?: unknown; theme?: unknown; themePromptSeen?: unknown; recapVoice?: unknown }>("settings", queuedLease);
        const currentRecord = mergeWorkOsSettings(null, {
          autoCheckUpdates: latest?.autoCheckUpdates !== false,
          updateChannel: normalizeUpdateChannel(latest?.updateChannel),
          voiceHotkey: latest?.voiceHotkey !== false,
          ...normalizeAppearance(latest),
          themePromptSeen: latest?.themePromptSeen === true,
          ...(typeof latest?.recapVoice === "string" ? { recapVoice: latest.recapVoice } : {}),
        });
        // A concurrent save may already have written a valid replacement;
        // keep it. Fall back to the default only when the reread origin is
        // still unusable.
        let apiBase = defaultApiBase;
        if (typeof latest?.apiBase === "string") {
          try { apiBase = httpsOrigin(latest.apiBase); } catch { apiBase = defaultApiBase; }
        }
        const fallback = mergeWorkOsSettings(currentRecord, { apiBase });
        await set("settings", fallback, queuedLease);
        return fallback;
      });
      settingsWriteQueue = recovery.then(() => undefined).catch(() => undefined);
      return recovery;
    }
  },
  saveSettings: (settings: { apiBase?: string; autoCheckUpdates?: boolean; updateChannel?: UpdateChannel; voiceHotkey?: boolean; textSize?: TextSize; mascotSize?: MascotSize; theme?: ThemePreference; themePromptSeen?: boolean; recapVoice?: string }) => {
    if (!isTauri()) return Promise.resolve();
    const write = settingsWriteQueue.then(async () => {
      // Acquire only when this queued save begins. A preceding failure or reset
      // may have retired the lease while this save was waiting; the save has not
      // read anything yet, so it can safely attach to the current vault.
      const lease = vault();
      const current = await get<{ apiBase?: string; autoCheckUpdates?: boolean; updateChannel?: unknown; voiceHotkey?: boolean; textSize?: unknown; mascotSize?: unknown; theme?: unknown; themePromptSeen?: unknown; recapVoice?: unknown }>("settings", lease);
      const stored = mergeWorkOsSettings(null, {
        apiBase: settings.apiBase === undefined && typeof current?.apiBase === "string" ? current.apiBase : undefined,
        autoCheckUpdates: current?.autoCheckUpdates !== false,
        updateChannel: normalizeUpdateChannel(current?.updateChannel),
        voiceHotkey: current?.voiceHotkey !== false,
        ...normalizeAppearance(current),
        themePromptSeen: current?.themePromptSeen === true,
        ...(typeof current?.recapVoice === "string" ? { recapVoice: current.recapVoice } : {}),
      });
      await set("settings", mergeWorkOsSettings(stored, settings), lease);
    });
    settingsWriteQueue = write.catch(() => undefined);
    return write;
  },
};
