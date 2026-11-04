// Public Work OS landing and the protected workspace are separate surfaces.
//
// These tests pin the route boundary: `/work-os` is the standalone marketing
// landing for every visitor, the tutorial and download pages live beneath it,
// and the signed-in workspace keeps its own explicitly named dispatcher. The
// public site must never open an adjacent account route, and compatibility links
// from the former `/work-os/welcome` routes must keep working.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server.js";
import { proxy } from "../src/proxy.ts";
import {
  isWorkOsSitePath,
  WORK_OS_SITE,
} from "../src/modules/work-os/marketing/site.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");
const exists = (relative: string) => existsSync(path.join(root, relative));

const CANONICAL_SITE_ROUTES = [
  "/work-os",
  "/work-os/downloads",
  "/work-os/downloads/thank-you/windows",
  "/work-os/downloads/thank-you/macos",
  "/work-os/tutorials",
  "/work-os/tutorials/eod-draft",
] as const;

const LEGACY_SITE_ROUTES = [
  "/work-os/welcome",
  "/work-os/welcome/downloads",
  "/work-os/welcome/tutorials",
  "/work-os/welcome/tutorials/eod-draft",
] as const;

test("the canonical public site lives at /work-os and keeps its subroutes public", async () => {
  assert.equal(WORK_OS_SITE.home, "/work-os");
  assert.equal(WORK_OS_SITE.downloads, "/work-os/downloads");
  assert.equal(WORK_OS_SITE.tutorials, "/work-os/tutorials");
  assert.deepEqual(
    WORK_OS_SITE.nav.map((item) => item.href),
    ["/work-os", "/work-os/tutorials", "/work-os/downloads"],
  );

  for (const route of CANONICAL_SITE_ROUTES) {
    assert.equal(isWorkOsSitePath(route), true, `${route} must be a public site path`);
    const response = await proxy(new NextRequest(`https://app.wrazyos.com${route}`));
    assert.equal(response.status, 200, `${route} must be public`);
    assert.equal(response.headers.get("location"), null, `${route} must not redirect`);
  }
});

test("the former /welcome links stay compatible without becoming the canonical URLs", async () => {
  for (const route of LEGACY_SITE_ROUTES) {
    assert.equal(isWorkOsSitePath(route), true, `${route} must remain reachable for old links`);
    const response = await proxy(new NextRequest(`https://app.wrazyos.com${route}`));
    assert.equal(response.status, 200, `${route} must remain public`);
  }
});

test("canonical site routes also survive a trailing slash normalization", async () => {
  for (const route of ["/work-os/", "/work-os/downloads/", "/work-os/downloads/thank-you/windows/", "/work-os/tutorials/", "/work-os/tutorials/eod-draft/", "/work-os/welcome/"]) {
    assert.equal(isWorkOsSitePath(route), true, `${route} must reach the canonical redirect`);
    const response = await proxy(new NextRequest(`https://app.wrazyos.com${route}`));
    assert.equal(response.status, 200, `${route} must not be sent to /login`);
  }
});

test("the public landing never opens the protected workspace or an adjacent path", async () => {
  for (const route of [
    "/work-os/workspace",
    "/work-os/today",
    "/work-os/review",
    "/work-os/admin",
    "/work-os/downloads/internal",
    "/work-os/downloads/thank-you/linux",
    "/work-os/downloads/thank-you/windows/private",
    "/work-os/tutorials/eod-draft/private",
    "/work-os/welcome/internal",
    "/api/work-os/me/day",
  ]) {
    assert.equal(isWorkOsSitePath(route), false, `${route} must not be public site surface`);
    const response = await proxy(new NextRequest(`https://app.wrazyos.com${route}`));
    assert.equal(response.status, 307, `${route} must still require sign-in`);
    assert.equal(new URL(response.headers.get("location")!).pathname, "/login");
  }
});

test("the landing, downloads and tutorials are real standalone site routes", () => {
  for (const relative of [
    "src/app/work-os/(site)/page.tsx",
    "src/app/work-os/(site)/downloads/page.tsx",
    "src/app/work-os/(site)/downloads/thank-you/[platform]/page.tsx",
    "src/app/work-os/(site)/tutorials/page.tsx",
    "src/app/work-os/(site)/tutorials/[slug]/page.tsx",
    "src/app/work-os/(site)/layout.tsx",
  ]) {
    assert.equal(exists(relative), true, `${relative} must exist`);
  }
  assert.match(read("src/app/work-os/(site)/page.tsx"), /<LandingPage\s*\/>/);
  assert.doesNotMatch(read("src/app/work-os/(site)/page.tsx"), /resolveWorkOsPageAccess/);
});

test("the protected workspace keeps the old dispatcher behind an explicit route", () => {
  assert.equal(exists("src/app/work-os/workspace/page.tsx"), true);
  const dispatcher = read("src/app/work-os/workspace/page.tsx");
  assert.match(dispatcher, /resolveWorkOsPageAccess/);
  assert.match(dispatcher, /role === "employee"\) redirect\(employeeDestinationForLegacyTab\(tab\)\)/);
  assert.match(dispatcher, /redirect\(tab \? LEGACY_ADMIN_TAB_ROUTES\[tab\] \?\? "\/work-os\/admin" : "\/work-os\/admin"\)/);
  assert.equal(exists("src/app/work-os/page.tsx"), false, "the landing owns /work-os; the dispatcher needs its own URL");
});

test("former welcome pages redirect to the canonical landing, downloads and tutorials", () => {
  const redirects = [
    ["src/app/work-os/welcome/page.tsx", "/work-os"],
    ["src/app/work-os/welcome/downloads/page.tsx", "/work-os/downloads"],
    ["src/app/work-os/welcome/tutorials/page.tsx", "/work-os/tutorials"],
  ] as const;
  for (const [relative, destination] of redirects) {
    assert.match(read(relative), /redirect\(/, `${relative} must redirect`);
    assert.match(read(relative), new RegExp(`redirect\\(\\s*["']${destination.replace(/\//g, "\\/")}["']`), `${relative} must redirect to ${destination}`);
  }
  const lesson = read("src/app/work-os/welcome/tutorials/[slug]/page.tsx");
  assert.match(lesson, /redirect\(`\/work-os\/tutorials\/\$\{/);
  assert.equal(exists("src/app/work-os/welcome/layout.tsx"), false, "the old marketing shell must not wrap redirects");
});

test("the site never links back to its former /welcome paths", () => {
  const files = [
    "src/modules/work-os/marketing/SiteChrome.tsx",
    "src/modules/work-os/marketing/LandingPage.tsx",
    "src/modules/work-os/marketing/TutorialLibrary.tsx",
    "src/modules/work-os/marketing/DownloadChooser.tsx",
    "src/app/work-os/(site)/downloads/page.tsx",
    "src/app/work-os/(site)/tutorials/page.tsx",
    "src/app/work-os/(site)/tutorials/[slug]/page.tsx",
  ];
  for (const relative of files) {
    assert.doesNotMatch(read(relative), /\/work-os\/welcome/, `${relative} must use the canonical site links`);
  }
  const site = read("src/modules/work-os/marketing/site.ts");
  assert.match(site, /WORK_OS_LEGACY_SITE/, "legacy paths stay centralized for redirects only");
});

test("the workspace CTA opens the protected workspace, not the marketing page", () => {
  const chooser = read("src/modules/work-os/marketing/DownloadChooser.tsx");
  assert.match(chooser, /href="\/work-os\/workspace"/);
  assert.doesNotMatch(chooser, /href="https:\/\/app\.wrazyos\.com\/work-os"/);

  const chrome = read("src/modules/work-os/marketing/SiteChrome.tsx");
  assert.match(chrome, /href="\/work-os\/workspace"/);

  const workspace = read("src/modules/work-os/workspace.ts");
  assert.match(workspace, /WORK_OS_WORKSPACE_HOME = "\/work-os\/workspace"/);
  assert.equal(WORK_OS_SITE.wrazyos.href, "/", "the site returns to the same origin's homepage");
});
