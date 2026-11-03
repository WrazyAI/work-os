import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server.js";
import { proxy } from "../src/proxy.ts";
import { detectPlatform, publicInstallerAsset, publicInstallerPlatform } from "../src/lib/work-os-installers.ts";
import { GET } from "../src/app/downloads/work-os/[platform]/route.ts";

test("only Windows and macOS have public installers", () => {
  assert.equal(publicInstallerPlatform("windows"), "windows-x86_64");
  assert.equal(publicInstallerPlatform("macos"), "darwin-universal");
  assert.equal(publicInstallerPlatform("linux"), null);
  assert.equal(publicInstallerPlatform("android"), null);
  assert.match(publicInstallerAsset("windows-x86_64"), /Setup-UNSIGNED\.exe$/);
  assert.match(publicInstallerAsset("darwin-universal"), /Universal-UNSIGNED\.dmg$/);
});

test("platform detection is explicit about Linux and unknown devices", () => {
  assert.equal(detectPlatform({ platform: "Linux x86_64" }), "linux");
  assert.equal(detectPlatform({ platform: "MacIntel" }), "macos");
  assert.equal(detectPlatform({ platform: "Win32" }), "windows");
  assert.equal(detectPlatform({ platform: "", userAgent: "Mozilla/5.0 (X11; Linux x86_64)" }), "linux");
  assert.equal(detectPlatform({ platform: "", userAgent: "SomethingElse" }), "unknown");
});

test("an unsupported platform fails closed instead of redirecting to login", async () => {
  const response = await GET(new Request("https://app.wrazyos.com/downloads/work-os/linux"), {
    params: Promise.resolve({ platform: "linux" }),
  });
  assert.equal(response.status, 404);
  assert.match(await response.text(), /not available/i);
});

test("public download routes are reachable without a session", async () => {
  for (const route of ["/downloads/work-os/windows", "/downloads/work-os/macos", "/downloads/work-os/windows/checksums", "/downloads/work-os/linux"]) {
    const response = await proxy(new NextRequest(`https://app.wrazyos.com${route}`));
    assert.equal(response.status, 200, `${route} must not require sign-in`);
  }
  const privateRoute = await proxy(new NextRequest("https://app.wrazyos.com/api/work-os/desktop/updates/windows/x86_64/1.0.0"));
  assert.equal(privateRoute.status, 307, "updater grants stay private");
});
