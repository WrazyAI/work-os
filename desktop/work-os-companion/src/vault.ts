import { invoke, isTauri } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { Client, Stronghold } from "@tauri-apps/plugin-stronghold";
import { loadStrongholdWhenReady } from "./strongholdStartup";
import type { DesktopSession, OfflineAction } from "./types";

export interface WorkOsConversationTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  meta?: string;
  createdAt: string;
}

let context: Promise<{ stronghold: Stronghold; client: Client }> | null = null;
const defaultApiBase = import.meta.env.VITE_WORK_OS_API_URL || "https://app.wrazyos.com";

function httpsOrigin(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Use the HTTPS WrazyOS URL.");
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

export const secureState = {
  session: async () => {
    if (!isTauri()) return null;
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
  },
  queue: async () => isTauri() ? (await get<OfflineAction[]>("offline-queue")) ?? [] : [],
  saveQueue: (queue: OfflineAction[]) => isTauri() ? set("offline-queue", queue) : Promise.resolve(),
  conversation: async (scope: string) => isTauri() ? (await get<WorkOsConversationTurn[]>(`conversation:${scope}`)) ?? [] : [],
  saveConversation: (scope: string, turns: WorkOsConversationTurn[]) => isTauri()
    ? set(`conversation:${scope}`, turns.slice(-60))
    : Promise.resolve(),
  clearConversation: (scope: string) => isTauri() ? remove(`conversation:${scope}`) : Promise.resolve(),
  pendingAuth: async () => {
    if (!isTauri()) return null;
    const pending = await get<{ verifier: string; state: string; apiBase: string }>("pending-auth");
    if (!pending) return null;
    try { return { ...pending, apiBase: httpsOrigin(pending.apiBase) }; }
    catch { await remove("pending-auth"); return null; }
  },
  savePendingAuth: (value: { verifier: string; state: string; apiBase: string }) => isTauri() ? set("pending-auth", value) : Promise.resolve(),
  clearPendingAuth: () => isTauri() ? remove("pending-auth") : Promise.resolve(),
  settings: async () => {
    if (!isTauri()) return { apiBase: httpsOrigin(defaultApiBase) };
    const settings = await get<{ apiBase: string }>("settings");
    try { return { apiBase: httpsOrigin(settings?.apiBase || defaultApiBase) }; }
    catch {
      const fallback = { apiBase: httpsOrigin(defaultApiBase) };
      await set("settings", fallback);
      return fallback;
    }
  },
  saveSettings: (settings: { apiBase: string }) => isTauri() ? set("settings", { apiBase: httpsOrigin(settings.apiBase) }) : Promise.resolve(),
};
