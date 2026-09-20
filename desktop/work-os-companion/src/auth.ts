import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { diagnostics } from "./diagnostics";
import { secureState } from "./vault";
import type { DesktopSession } from "./types";

export const DESKTOP_REDIRECT_URI = "wrazy-workos://auth";
export const DESKTOP_CONNECT_HOST = "app.wrazyos.com";
export const DESKTOP_CONNECT_PATH = "/work-os/desktop/connect";
let pending: { verifier: string; state: string; apiBase: string } | null = null;

export function errorMessage(value: unknown, fallback = "Something went wrong.") {
  if (typeof value === "string" && value.trim()) return value;
  if (value instanceof Error && value.message.trim()) return value.message;
  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

function randomValue(bytes = 32) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...data)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function challenge(verifier: string) {
  if (!crypto.subtle) throw new Error("This window cannot create a secure sign-in request. Restart Work OS Companion.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function assertDesktopConnectUrl(url: string, allowedOrigin = `https://${DESKTOP_CONNECT_HOST}`) {
  const parsed = new URL(url);
  const expected = new URL(allowedOrigin);
  if (parsed.protocol !== "https:" || expected.protocol !== "https:" || parsed.origin !== expected.origin || parsed.pathname !== DESKTOP_CONNECT_PATH) {
    throw new Error("Only an HTTPS Work OS authorization URL can be opened.");
  }
  if (!parsed.searchParams.get("challenge") || !parsed.searchParams.get("state") || parsed.searchParams.get("redirect_uri") !== DESKTOP_REDIRECT_URI) {
    throw new Error("The desktop authorization URL is missing required parameters.");
  }
  return parsed;
}

export function buildDesktopConnectUrl(apiBase: string, challengeValue: string, state: string) {
  const origin = new URL(apiBase).origin;
  const url = new URL(`${origin}${DESKTOP_CONNECT_PATH}`);
  url.searchParams.set("challenge", challengeValue);
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", DESKTOP_REDIRECT_URI);
  return assertDesktopConnectUrl(url.toString(), origin);
}

async function openDesktopConnectUrl(url: URL) {
  const href = url.toString();
  if (!isTauri()) {
    window.open(href, "_blank", "noopener,noreferrer");
    return;
  }
  try {
    await invoke("open_work_os_auth", { url: href });
    return;
  } catch (error) {
    diagnostics.warn("ipc.open_work_os_auth.fallback", errorMessage(error, "IPC browser open failed"));
  }
  try {
    await openUrl(href);
  } catch (error) {
    throw new Error(`Could not open the browser: ${errorMessage(error, "no handler available")}`);
  }
}

export async function beginAuthentication(apiBaseOverride?: string) {
  return diagnostics.withSpan("auth.begin", async () => {
    if (apiBaseOverride?.trim()) {
      await secureState.saveSettings({ apiBase: apiBaseOverride.trim() });
    }
    const { apiBase } = await secureState.settings();
    const parsedBase = new URL(apiBase);
    if (parsedBase.protocol !== "https:") {
      throw new Error("Use the HTTPS WrazyOS URL.");
    }
    const verifier = randomValue(64);
    const state = randomValue(24);
    pending = { verifier, state, apiBase: parsedBase.origin };
    await secureState.savePendingAuth(pending);
    const url = buildDesktopConnectUrl(pending.apiBase, await challenge(verifier), state);
    await diagnostics.withSpan("ipc.open_work_os_auth", () => openDesktopConnectUrl(url), { host: parsedBase.host }, "ipc");
  }, {}, "frontend");
}

async function acceptCallback(raw: string) {
  pending ??= await secureState.pendingAuth();
  if (!pending) return null;
  const url = new URL(raw);
  if (url.protocol !== "wrazy-workos:" || url.hostname !== "auth" || url.searchParams.get("state") !== pending.state) throw new Error("Desktop authorization state did not match.");
  const code = url.searchParams.get("code");
  if (!code) throw new Error("Desktop authorization did not include a code.");
  const response = await fetch(`${pending.apiBase}/api/work-os/desktop/token`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, verifier: pending.verifier, device_name: "Work OS Companion for Windows" }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Desktop token exchange failed.");
  const session: DesktopSession = { token: result.access_token, expiresAt: result.expires_at, organizationId: result.organization_id, apiBase: pending.apiBase };
  await secureState.saveSession(session);
  await secureState.clearPendingAuth();
  pending = null;
  diagnostics.info("auth.completed", "Desktop session stored", { organizationId: session.organizationId, apiBase: session.apiBase });
  return session;
}

export async function listenForAuthentication(onSession: (session: DesktopSession) => void, onError: (error: Error) => void) {
  if (!isTauri()) return () => undefined;
  const handle = async (urls: string[]) => {
    for (const url of urls) {
      try {
        diagnostics.info("auth.deep_link", "Received desktop auth callback");
        const session = await acceptCallback(url);
        if (session) onSession(session);
      } catch (error) {
        diagnostics.error("auth.deep_link.failed", errorMessage(error, "Auth callback failed"));
        onError(error instanceof Error ? error : new Error(errorMessage(error, "Auth callback failed")));
      }
    }
  };
  const current = await getCurrent();
  if (current) await handle(current);
  return onOpenUrl((urls) => void handle(urls));
}
