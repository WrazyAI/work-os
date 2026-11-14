import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Model only the native IPC boundary, using the installed plugin's actual JS
// bindings and production secureState. Native Stronghold rejects a second
// load_client with ClientAlreadyLoaded; create_client replaces that client.
const host = vi.hoisted(() => ({
  disk: new Map<string, number[]>(),
  loaded: null as Map<string, number[]> | null,
  snapshot: new Map<string, number[]>(),
  loadError: null as string | null,
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: async (command: string, args: Record<string, unknown> = {}) => {
    switch (command) {
      case "get_vault_password": return "fixture-password";
      case "plugin:stronghold|initialize":
        host.snapshot = new Map(host.disk);
        host.loaded = null;
        return;
      case "plugin:stronghold|load_client":
        if (host.loadError) throw host.loadError;
        if (host.loaded) throw "client with id fixture has already been loaded before, can not be loaded twice";
        if (!host.snapshot.size) throw "error loading client data; no data present";
        host.loaded = new Map(host.snapshot);
        return;
      case "plugin:stronghold|create_client":
        host.loaded = new Map();
        return;
      case "plugin:stronghold|get_store_record":
        if (!host.loaded) throw "error loading client data; no data present";
        return host.loaded.get(String(args.key)) ?? null;
      case "plugin:stronghold|save_store_record":
        if (!host.loaded) throw "error loading client data; no data present";
        host.loaded.set(String(args.key), args.value as number[]);
        return;
      case "plugin:stronghold|save":
        host.disk = new Map(host.loaded);
        return;
      default: throw new Error(`Unexpected IPC: ${command}`);
    }
  },
}));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: async () => "/fixture/app-data",
  join: async (...parts: string[]) => parts.join("/"),
}));
vi.mock("./diagnostics", () => ({ diagnostics: { info() {}, warn() {}, error() {} } }));

const session = {
  token: "fixture-session-not-a-real-token",
  expiresAt: "2099-01-01T00:00:00.000Z",
  organizationId: "fixture-org",
  apiBase: "https://app.wrazyos.com",
};

async function windowState() {
  // Each WebView has a separate module-level cached vault context.
  vi.resetModules();
  return (await import("./vault")).secureState;
}

describe("session persistence through real Stronghold JS bindings", () => {
  beforeEach(async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.stubGlobal("window", { __TAURI_INTERNALS__: { invoke }, setTimeout });
    host.disk = new Map();
    host.loaded = null;
    host.snapshot = new Map();
    host.loadError = null;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("restores a saved session after a single-window process restart", async () => {
    const first = await windowState();
    await first.saveSession(session);
    host.loaded = null;
    const restarted = await windowState();
    expect(await restarted.session()).toEqual(session);
  });

  it("keeps a saved session when main and avatar open the vault together", async () => {
    host.disk.set("session", [...new TextEncoder().encode(JSON.stringify(session))]);
    const main = await windowState();
    const avatar = await windowState();
    const restored = await Promise.all([main.session(), avatar.session()]);
    expect(restored).toEqual([session, session]);
    await main.saveSettings({ autoCheckUpdates: false });
    const restarted = await windowState();
    expect(await restarted.session()).toEqual(session);
  });

  it("does not replace saved data when loading the client fails unexpectedly", async () => {
    host.disk.set("session", [...new TextEncoder().encode(JSON.stringify(session))]);
    host.loadError = "fixture client read denied";
    const main = await windowState();
    await expect(main.session()).rejects.toBe("fixture client read denied");
    host.loadError = null;
    const restarted = await windowState();
    expect(await restarted.session()).toEqual(session);
  });

  it("reopens the vault when another window replaced it before a read", async () => {
    host.disk.set("session", [...new TextEncoder().encode(JSON.stringify(session))]);
    const main = await windowState();
    expect(await main.session()).toEqual(session);
    // The other window's Stronghold.load replaced the host collection, which
    // drops this window's loaded client until it reopens.
    host.loaded = null;
    host.snapshot = new Map(host.disk);
    expect(await main.session()).toEqual(session);
  });

  it("treats an empty vault replaced during startup as signed out, not a failure", async () => {
    const main = await windowState();
    expect(await main.session()).toBeNull();
    host.loaded = null;
    host.snapshot = new Map(host.disk);
    expect(await main.session()).toBeNull();
  });
});
