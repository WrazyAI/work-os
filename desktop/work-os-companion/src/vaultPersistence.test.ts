import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Native IPC is the external boundary; production secureState encoding,
// settings merges, session validation and cache scoping remain real.
// The native worker itself is exercised by the Rust lifecycle/native tests.
const host = vi.hoisted(() => ({
  disk: new Map<string, number[]>(), generation: 1, ready: false,
  error: null as unknown, saveError: false, failRemoveKey: null as string | null, onRemoveFailure: null as (() => void) | null, failReadKey: null as string | null, writes: 0,
}));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: async (command: string, args: Record<string, unknown> = {}) => {
    if (command === "open_local_vault") {
      if (host.error) throw host.error;
      const reused = host.ready; host.ready = true;
      return { generation: host.generation, reused };
    }
    if (command === "reset_local_vault") {
      host.generation++; host.ready = false; host.disk.clear(); return;
    }
    if (!["read_local_vault", "write_local_vault", "remove_local_vault"].includes(command)) throw new Error(`Unexpected IPC: ${command}`);
    if (args.generation !== host.generation || !host.ready) throw { code: "stale_generation", message: "Local data changed. Try again.", requiresReset: false };
    const key = String(args.key);
    if (command === "read_local_vault") {
      if (host.failReadKey === key) {
        host.failReadKey = null; host.generation++; host.ready = false;
        throw { code: "storage_failed", message: "Local data could not be read.", requiresReset: false };
      }
      return host.disk.get(key) ?? null;
    }
    if (command === "remove_local_vault" && host.failRemoveKey === key) {
      host.failRemoveKey = null; host.generation++; host.ready = false;
      host.onRemoveFailure?.();
      throw { code: "storage_failed", message: "Local data could not be saved.", requiresReset: false };
    }
    if (host.saveError) {
      // Model the native owner: a durable failure retires the live instance, so
      // the old lease must not keep reading a now-uncertain in-memory record.
      host.generation++; host.ready = false;
      throw { code: "storage_failed", message: "Local data could not be saved.", requiresReset: false };
    }
    host.writes++;
    if (command === "write_local_vault") host.disk.set(key, args.value as number[]);
    else host.disk.delete(key);
  },
}));
vi.mock("./diagnostics", () => ({ diagnostics: { info() {}, warn() {}, error() {} } }));
vi.mock("@tauri-apps/api/path", () => ({ appDataDir: async () => "/fixture", join: async (...parts: string[]) => parts.join("/") }));
const otherSession = { token: "other-fixture-token", expiresAt: "2099-01-01T00:00:00.000Z", organizationId: "other-org", apiBase: "https://app.wrazyos.com" };
const session = { token: "fixture-not-a-real-token", expiresAt: "2099-01-01T00:00:00.000Z", organizationId: "fixture-org", apiBase: "https://app.wrazyos.com" };
const encode = (value: unknown) => [...new TextEncoder().encode(JSON.stringify(value))];
async function windowState() {
  vi.resetModules();
  return await import("./vault");
}
describe("session persistence through the shared native vault transport", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { setTimeout, location: { search: "" } });
    host.disk = new Map(); host.generation = 1; host.ready = false; host.error = null; host.saveError = false; host.failRemoveKey = null; host.onRemoveFailure = null; host.failReadKey = null; host.writes = 0;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps session/theme/prompt and unrelated settings across both windows and restart", async () => {
    const main = (await windowState()).secureState;
    await main.saveSession(session);
    await main.saveSettings({ theme: "dark", themePromptSeen: true });
    const avatar = (await windowState()).secureState;
    expect(await avatar.session()).toEqual(session);
    await avatar.saveSettings({ autoCheckUpdates: false });
    expect(await main.settings()).toMatchObject({ theme: "dark", themePromptSeen: true, autoCheckUpdates: false });
    host.ready = false; host.generation++;
    const restarted = (await windowState()).secureState;
    expect(await restarted.session()).toEqual(session);
    expect(await restarted.settings()).toMatchObject({ theme: "dark", themePromptSeen: true, autoCheckUpdates: false });
  });
  it("reattaches after an abandoned frontend attempt without replacing saved records", async () => {
    host.disk.set("session", encode(session));
    const main = await windowState();
    expect(await main.secureState.session()).toEqual(session);
    main.abandonVaultOpen();
    expect(await main.secureState.session()).toEqual(session);
    expect(host.writes).toBe(0);
  });
  it("preserves structured keychain errors and retries without overwriting the vault", async () => {
    host.disk.set("session", encode(session));
    const main = (await windowState()).secureState;
    const denied = { code: "confirmation_required", message: "Confirm key access", requiresReset: false };
    host.error = denied;
    await expect(main.session()).rejects.toBe(denied);
    host.error = null;
    expect(await main.session()).toEqual(session);
    expect(host.writes).toBe(0);
  });
  it("rejects a stale mutation without replaying its data after reset", async () => {
    const main = await windowState();
    await main.secureState.saveSession(session);
    const other = await windowState();
    await other.resetLocalVault();
    await expect(main.secureState.saveSession(session)).rejects.toMatchObject({ code: "stale_generation" });
    expect(await main.secureState.session()).toBeNull();
    expect(await other.secureState.session()).toBeNull();
  });
  it("does not report a failed durable save as success and reattaches afterwards", async () => {
    const main = (await windowState()).secureState;
    host.saveError = true;
    await expect(main.saveSession(session)).rejects.toMatchObject({ code: "storage_failed" });
    host.saveError = false;
    expect(await main.session()).toBeNull();
    // The rejected record is gone, but the next save must not be stranded on the
    // retired lease.
    await expect(main.saveSession(session)).resolves.toBeUndefined();
    expect(await main.session()).toEqual(session);
  });
  it("serializes settings saves and keeps the confirmed appearance", async () => {
    const main = (await windowState()).secureState;
    await Promise.all([main.saveSettings({ theme: "dark" }), main.saveSettings({ textSize: "medium", themePromptSeen: true })]);
    expect(await main.settings()).toMatchObject({ theme: "dark", textSize: "medium", themePromptSeen: true });
  });
  it("gives a queued settings save a fresh lease after another window resets the vault", async () => {
    const main = (await windowState()).secureState;
    await main.settings();
    host.generation = 2;
    host.ready = false;
    const first = main.saveSettings({ theme: "dark" });
    const queued = main.saveSettings({ textSize: "medium" });
    // The first save reports the stale lease and retires it. The second task has
    // not read anything yet, so it attaches to the replacement vault instead of
    // replaying the retired lease or losing its pending setting.
    await expect(first).rejects.toMatchObject({ code: "stale_generation" });
    await expect(queued).resolves.toBeUndefined();
    expect(await main.settings()).toMatchObject({ textSize: "medium" });
  });
  it("resumes sign-out cleanup after a durable failure retires the lease", async () => {
    const main = (await windowState()).secureState;
    await main.saveSession(session);
    await main.savePendingAuth({ verifier: "fixture", state: "fixture", apiBase: "https://app.wrazyos.com" });
    await main.saveConversation("shift", [{ id: "one", role: "user", text: "fixture", createdAt: "2026-11-16T00:00:00Z" }]);
    host.failRemoveKey = "pending-auth";
    await expect(main.clearAccount()).resolves.toBeUndefined();
    expect(await main.session()).toBeNull();
    expect(await main.pendingAuth()).toBeNull();
    expect(await main.conversation("shift")).toEqual([]);
  });
  it("still clears account data when the first session read fails", async () => {
    const main = (await windowState()).secureState;
    await main.saveSession(session);
    await main.savePendingAuth({ verifier: "fixture", state: "fixture", apiBase: "https://app.wrazyos.com" });
    host.failReadKey = "session";
    await expect(main.clearAccount()).resolves.toBeUndefined();
    expect(await main.session()).toBeNull();
    expect(await main.pendingAuth()).toBeNull();
  });
  it("does not delete a newer account's session when cleanup resumes", async () => {
    const main = (await windowState()).secureState;
    await main.saveSession(session);
    await main.savePendingAuth({ verifier: "fixture", state: "fixture", apiBase: "https://app.wrazyos.com" });
    host.failRemoveKey = "pending-auth";
    host.onRemoveFailure = () => { host.disk.set("session", [...new TextEncoder().encode(JSON.stringify(otherSession))]); };
    await main.clearAccount();
    expect(await main.session()).toEqual(otherSession);
  });
  it("retries a conversation save after a durable registry failure, without replaying a reset", async () => {
    const main = (await windowState()).secureState;
    host.saveError = true;
    await expect(main.saveConversation("scope", [{ id: "one", role: "user", text: "first", createdAt: "2026-11-18T00:00:00Z" }])).rejects.toMatchObject({ code: "storage_failed" });
    host.saveError = false;
    await expect(main.saveConversation("scope", [{ id: "two", role: "user", text: "second", createdAt: "2026-11-18T00:01:00Z" }])).resolves.toBeUndefined();
    expect((await main.conversation("scope")).map((turn) => turn.text)).toEqual(["second"]);
  });
  it("round-trips queue and pending auth and clears account data without deleting device appearance", async () => {
    const main = (await windowState()).secureState;
    await main.saveSession(session);
    await main.saveSettings({ theme: "dark", themePromptSeen: true });
    const auth = { verifier: "fixture", state: "fixture", apiBase: "https://app.wrazyos.com" };
    await main.savePendingAuth(auth);
    expect(await main.pendingAuth()).toEqual(auth);
    await main.saveConversation("shift", [{ id: "one", role: "user", text: "fixture", createdAt: "2026-11-16T00:00:00Z" }]);
    expect((await main.conversation("shift"))[0].text).toBe("fixture");
    const queued = { id: "fixture-action", method: "POST" as const, path: "/api/work-os/me/updates", body: { text: "fixture" }, createdAt: "2026-11-16T00:00:00Z", attempts: 1 };
    await main.saveQueue([queued]);
    expect(await main.queue()).toEqual([queued]);
    await main.clearAccount();
    expect(await main.session()).toBeNull();
    expect(await main.pendingAuth()).toBeNull();
    expect(await main.queue()).toEqual([]);
    expect(await main.conversation("shift")).toEqual([]);
    expect(await main.settings()).toMatchObject({ theme: "dark", themePromptSeen: true });
  });
});
