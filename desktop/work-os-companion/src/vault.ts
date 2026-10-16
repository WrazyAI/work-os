import { invoke, isTauri } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { Client, Stronghold } from "@tauri-apps/plugin-stronghold";
import { loadStrongholdWhenReady } from "./strongholdStartup";
import { openVaultWhenReady, reportVaultRetry } from "./vaultStartup";
import { diagnostics } from "./diagnostics";
import type { DayData, DesktopSession, OfflineAction } from "./types";
import type { PendingToolReview, ProposedOperation, ToolCallResult } from "./interpretation";
import type { RecapNextStepsMoment } from "./RecapNextStepsCard";
import { mergeConversationTurns } from "./avatarLogic";
import { sessionStateFrom, type SessionState } from "./sessionState";
import { APPEARANCE_DEFAULTS, appearanceFromChange, normalizeAppearance, type MascotSize, type TextSize } from "./appearance";
import type { CachedGuideState, GuideState } from "./guideState";

export interface WorkOsSettings {
  apiBase: string;
  /** The voice recaps are read in; absent means the first shipped voice. */
  recapVoice?: string;
  /** Launch update check. Absent historically means on. */
  autoCheckUpdates: boolean;
  /** Hold-to-talk shortcut (`Ctrl + M`). Absent historically means on. */
  voiceHotkey: boolean;
  /** Accessibility appearance, per device; see `appearance.ts`. */
  textSize: TextSize;
  mascotSize: MascotSize;
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

let context: Promise<{ stronghold: Stronghold; client: Client }> | null = null;

/** Chat scopes are dynamic keys; remember every scope this device wrote so a
 * sign-out can clear another employee's conversations and pending reviews. */
const CHAT_SCOPE_KEYS = "chat-scope-keys";
async function rememberChatScope(scope: string) {
  try {
    const keys = new Set((await get<string[]>(CHAT_SCOPE_KEYS)) ?? []);
    const before = keys.size;
    keys.add(`conversation:${scope}`);
    keys.add(`pending-tools:${scope}`);
    if (keys.size !== before) await set(CHAT_SCOPE_KEYS, [...keys]);
  } catch { /* best effort: clearing falls back to session-scoped keys */ }
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

/** One vault open: the saved key from the host, then the Stronghold file. */
async function openVault() {
  const path = await join(await appDataDir(), "work-os-vault.hold");
  const password = await invoke<string>("get_vault_password");
  const stronghold = await loadStrongholdWhenReady(() => Stronghold.load(path, password));
  let client: Client;
  try { client = await stronghold.loadClient("work-os"); }
  catch { client = await stronghold.createClient("work-os"); }
  return { stronghold, client };
}

async function vault() {
  if (!context) {
    const pending = (async () => {
      const startedAt = Date.now();
      diagnostics.info("vault.open.started", "Opening the local vault");
      // The host registers the password worker and the Stronghold plugin while
      // it starts; a first launch that loses that race must not cost the
      // employee a refresh, so the open retries inside this one attempt.
      const opened = await openVaultWhenReady(openVault, { onRetry: reportVaultRetry });
      // The gate above this is the only thing the employee sees while this
      // runs, so a slow open has to leave a trail to diagnose.
      diagnostics.info("vault.open.ready", `Opened the local vault in ${Date.now() - startedAt}ms`);
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

async function get<T>(key: string): Promise<T | null> {
  const { client } = await vault();
  const value = await client.getStore().get(key);
  if (!value) return null;
  return JSON.parse(new TextDecoder().decode(new Uint8Array(value))) as T;
}

async function set(key: string, value: unknown) {
  const { stronghold, client } = await vault();
  await client.getStore().insert(key, [...new TextEncoder().encode(JSON.stringify(value))]);
  await stronghold.save();
}

async function remove(key: string) {
  const { stronghold, client } = await vault();
  await client.getStore().remove(key);
  await stronghold.save();
}

/** Dev-fixture only (mirrors the ?preview-* bootstrap): a dev server URL with
 * ?token=<desktop session token> boots the browser build signed in, so E2E
 * suites can exercise the real planner against the real API. Never active in
 * the packaged app, and the token is never persisted. The organization id is
 * resolved from the API because every request carries it. */
let browserSessionCache: DesktopSession | null = null;
async function browserSession(): Promise<DesktopSession | null> {
  if (!import.meta.env.DEV) return null;
  if (browserSessionCache) return browserSessionCache;
  const token = new URLSearchParams(window.location.search).get("token");
  if (!token) return null;
  const apiBase = defaultApiBase;
  const response = await fetch(`${apiBase.replace(/\/$/, "")}/api/work-os/me/day?compact=true`, {
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!response || !response.ok) return null;
  const access = (await response.json().catch(() => null)) as { access?: { organizationId?: string } } | null;
  browserSessionCache = { token, expiresAt: new Date(Date.now() + 24 * 3_600_000).toISOString(), organizationId: access?.access?.organizationId ?? "browser-test", apiBase };
  return browserSessionCache;
}

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
  clearAccount: async () => {
    if (!isTauri()) return;
    await remove("session");
    await remove("pending-auth");
    await remove("offline-queue");
    await remove("day-snapshot");
    await remove("query-cache");
    await remove("guide-state");
    // Conversations and pending approval cards are per-shift keys; remove each
    // scope this device wrote so a sign-out leaves no employee data behind.
    const scopes = (await get<string[]>(CHAT_SCOPE_KEYS)) ?? [];
    for (const key of scopes) await remove(key);
    await remove(CHAT_SCOPE_KEYS);
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
    const session = await secureState.session();
    if (session) await set("day-snapshot", { savedAt: new Date().toISOString(), organizationId: session.organizationId, token: session.token, day });
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
    const session = await secureState.session();
    if (session) await set("query-cache", { savedAt: new Date().toISOString(), organizationId: session.organizationId, token: session.token, state });
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
    return (async () => {
      await rememberChatScope(scope);
      const stored = (await get<WorkOsConversationTurn[]>(`conversation:${scope}`)) ?? [];
      await set(`conversation:${scope}`, mergeConversationTurns(stored, turns));
    })();
  },
  clearConversation: (scope: string) => isTauri() ? remove(`conversation:${scope}`) : Promise.resolve(),
  /** Latest pending tool review for the scope, shared by the main window and
   * the avatar so cards raised in either surface appear in both. */
  pendingTools: async (scope: string) => isTauri() ? (await get<PendingToolReview>(`pending-tools:${scope}`)) ?? null : null,
  savePendingTools: (scope: string, review: PendingToolReview) => isTauri()
    ? rememberChatScope(scope).then(() => set(`pending-tools:${scope}`, review))
    : Promise.resolve(),
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
    if (!isTauri()) return { apiBase: httpsOrigin(defaultApiBase), autoCheckUpdates: true, voiceHotkey: true, ...APPEARANCE_DEFAULTS };
    const settings = await get<{ apiBase?: string; autoCheckUpdates?: boolean; voiceHotkey?: boolean; textSize?: unknown; mascotSize?: unknown; recapVoice?: unknown }>("settings");
    const autoCheckUpdates = settings?.autoCheckUpdates !== false;
    const voiceHotkey = settings?.voiceHotkey !== false;
    const appearance = normalizeAppearance(settings);
    const recapVoice = typeof settings?.recapVoice === "string" ? settings.recapVoice : undefined;
    try { return { autoCheckUpdates, voiceHotkey, recapVoice, apiBase: httpsOrigin(settings?.apiBase || defaultApiBase), ...appearance }; }
    catch {
      const fallback = { apiBase: httpsOrigin(defaultApiBase), autoCheckUpdates, voiceHotkey, ...appearance };
      await set("settings", fallback);
      return fallback;
    }
  },
  saveSettings: async (settings: { apiBase?: string; autoCheckUpdates?: boolean; voiceHotkey?: boolean; textSize?: TextSize; mascotSize?: MascotSize }) => {
    if (!isTauri()) return;
    const current = await get<{ apiBase?: string; autoCheckUpdates?: boolean; voiceHotkey?: boolean; textSize?: unknown; mascotSize?: unknown }>("settings");
    await set("settings", {
      apiBase: httpsOrigin(settings.apiBase ?? current?.apiBase ?? defaultApiBase),
      autoCheckUpdates: settings.autoCheckUpdates ?? current?.autoCheckUpdates !== false,
      voiceHotkey: settings.voiceHotkey ?? current?.voiceHotkey !== false,
      ...appearanceFromChange(normalizeAppearance(current), settings),
    });
  },
};
