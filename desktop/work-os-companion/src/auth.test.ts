import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertDesktopConnectUrl, buildDesktopConnectUrl, DESKTOP_REDIRECT_URI, errorMessage } from "./auth";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("desktop connect URL", () => {
  it("keeps PKCE query parameters intact for Windows browser launch", () => {
    const url = buildDesktopConnectUrl(
      "https://app.wrazyos.com/",
      "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
      "state-value-123456",
    );
    expect(url.origin).toBe("https://app.wrazyos.com");
    expect(url.pathname).toBe("/work-os/desktop/connect");
    expect(url.searchParams.get("challenge")).toHaveLength(43);
    expect(url.searchParams.get("state")).toBe("state-value-123456");
    expect(url.searchParams.get("redirect_uri")).toBe(DESKTOP_REDIRECT_URI);
    expect(url.toString()).toContain("&");
    expect(() => assertDesktopConnectUrl(url.toString())).not.toThrow();
  });

  it("rejects an unconfigured host", () => {
    expect(() => assertDesktopConnectUrl("https://example.com/work-os/desktop/connect?challenge=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG&state=state-value-123456&redirect_uri=wrazy-workos://auth")).toThrow(/Only an HTTPS Work OS/);
  });

  it("accepts the explicitly configured HTTPS workspace host", () => {
    const url = buildDesktopConnectUrl(
      "https://srv1726015.tailbf7608.ts.net/",
      "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
      "state-value-123456",
    );
    expect(url.origin).toBe("https://srv1726015.tailbf7608.ts.net");
    expect(() => assertDesktopConnectUrl(url.toString(), url.origin)).not.toThrow();
  });

  it("still rejects a URL that does not match the configured workspace host", () => {
    expect(() => assertDesktopConnectUrl(
      "https://example.com/work-os/desktop/connect?challenge=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG&state=state-value-123456&redirect_uri=wrazy-workos://auth",
      "https://srv1726015.tailbf7608.ts.net",
    )).toThrow(/Only an HTTPS Work OS/);
  });
});

describe("connect error surfacing", () => {
  it("reads Tauri invoke payloads that are not Error instances", () => {
    expect(errorMessage({ message: "Command open_work_os_auth not allowed" })).toBe("Command open_work_os_auth not allowed");
    expect(errorMessage("browser launch failed")).toBe("browser launch failed");
    expect(errorMessage({})).toBe("Something went wrong.");
  });

  it("shows Connect failures instead of swallowing .message on strings", () => {
    const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");
    expect(app).toContain("errorMessage");
    expect(app).not.toContain("beginAuthentication().catch((value) => setError(value.message))");
    expect(app).toContain("Opening browser");
  });

  it("allows the main window to invoke open_work_os_auth", () => {
    const capability = readFileSync(resolve(root, "src-tauri/capabilities/default.json"), "utf8");
    const allow = readFileSync(resolve(root, "src-tauri/permissions/allow-app-commands.toml"), "utf8");
    const rust = readFileSync(resolve(root, "src-tauri/src/lib.rs"), "utf8");
    expect(capability).toContain("allow-app-commands");
    expect(allow).toContain("open_work_os_auth");
    expect(allow).toContain("get_vault_password");
    const debug = readFileSync(resolve(root, "src-tauri/capabilities/debug.json"), "utf8");
    expect(debug).not.toContain("deny-get-vault-password");
    expect(debug).not.toContain("deny-open-work-os-auth");
    expect(debug).not.toContain("allow-app-commands");
    expect(rust).toContain("WORK_OS_AUTH_URL");
    expect(rust).toContain("Start-Process -FilePath $env:WORK_OS_AUTH_URL");
  });
});
