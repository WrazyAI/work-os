import { invoke, isTauri } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { Client, Stronghold } from "@tauri-apps/plugin-stronghold";
import { loadStrongholdWhenReady } from "./strongholdStartup";
import type { DayData, DesktopSession, OfflineAction } from "./types";
import type { PendingToolReview, ProposedOperation, ToolCallResult } from "./interpretation";

export interface WorkOsSettings {
  apiBase: string;
  /** Launch update check. Absent historically means on. */
  autoCheckUpdates: boolean;
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
}

let context: Promise<{ stronghold: Stronghold; client: Client }> | null = null;
const defaultApiBase = import.meta.env.VITE_WORK_OS_API_URL || "https://app.wrazyos.com";

function httpsOrigin(value: string) {
  const url = new URL(value);
  // Dev-fixture loopback (see browserSession): the dev proxy makes API calls
  // same-origin, so the packaged HTTPS rule does not apply to the dev server.
  const devLoopback = import.meta.env.DEV && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (url.protocol !== "https:" && !devLoopback) throw new Error("Use the HTTPS WrazyOS URL.");
  return url.origin;
}

async function vault() {
  if (!context) {
    const pending = (async () => {
      const path = await join(await appDataDir(), "work-os-vault.hold");
      const password = await invoke<string>("get_vault_password");
      const stronghold = await loadStrongholdWhenReady(() => Stronghold.load(path, password));
      let client: Client;
      try { client = await stronghold.loadClient("work-os"); }
      catch { client = await stronghold.createClient("work-os"); }
      return { stronghold, client };
    })();
    context = pending;
    void pending.catch(() => {
      if (context === pending) context = null;
    });
  }
  return context;
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
  session: async () => {
    if (!isTauri()) return browserSession();
    const session = await get<DesktopSession>("session");
    if (!session) return null;
    try { return { ...session, apiBase: httpsOrigin(session.apiBase) }; }
    catch { await remove("session"); return null; }
  },
  saveSession: (session: DesktopSession) => isTauri() ? set("session", session) : Promise.resolve(),
  clearSession: () => isTauri() ? remove("session") : Promise.resolve(),
  clearAccount: async () => {
    if (!isTauri()) return;
    await remove("session");
    await remove("pending-auth");
    await remove("offline-queue");
    await remove("day-snapshot");
    await remove("query-cache");
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
  conversation: async (scope: string) => isTauri() ? (await get<WorkOsConversationTurn[]>(`conversation:${scope}`)) ?? [] : [],
  saveConversation: (scope: string, turns: WorkOsConversationTurn[]) => isTauri()
    ? set(`conversation:${scope}`, turns.slice(-60))
    : Promise.resolve(),
  clearConversation: (scope: string) => isTauri() ? remove(`conversation:${scope}`) : Promise.resolve(),
  /** Latest pending tool review for the scope, shared by the main window and
   * the avatar so cards raised in either surface appear in both. */
  pendingTools: async (scope: string) => isTauri() ? (await get<PendingToolReview>(`pending-tools:${scope}`)) ?? null : null,
  savePendingTools: (scope: string, review: PendingToolReview) => isTauri()
    ? set(`pending-tools:${scope}`, review)
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
    if (!isTauri()) return { apiBase: httpsOrigin(defaultApiBase), autoCheckUpdates: true };
    const settings = await get<{ apiBase?: string; autoCheckUpdates?: boolean }>("settings");
    const autoCheckUpdates = settings?.autoCheckUpdates !== false;
    try { return { autoCheckUpdates, apiBase: httpsOrigin(settings?.apiBase || defaultApiBase) }; }
    catch {
      const fallback = { apiBase: httpsOrigin(defaultApiBase), autoCheckUpdates };
      await set("settings", fallback);
      return fallback;
    }
  },
  saveSettings: async (settings: { apiBase?: string; autoCheckUpdates?: boolean }) => {
    if (!isTauri()) return;
    const current = await get<{ apiBase?: string; autoCheckUpdates?: boolean }>("settings");
    await set("settings", {
      apiBase: httpsOrigin(settings.apiBase ?? current?.apiBase ?? defaultApiBase),
      autoCheckUpdates: settings.autoCheckUpdates ?? current?.autoCheckUpdates !== false,
    });
  },
};
