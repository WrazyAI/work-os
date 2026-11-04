import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DOWNLOAD_GUIDES,
  downloadGuide,
  downloadGuidePath,
  downloadHref,
} from "../src/modules/work-os/marketing/download-guides.ts";
import { adjacentTutorials, TUTORIALS } from "../src/modules/work-os/tutorials.ts";

const read = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

test("the Windows and macOS guides name the real files and their own recovery steps", () => {
  assert.equal(DOWNLOAD_GUIDES.length, 2);
  const windows = downloadGuide("windows");
  const macos = downloadGuide("macos");
  assert.ok(windows);
  assert.ok(macos);
  assert.equal(windows.fileName, "Work-OS-Companion-Setup-UNSIGNED.exe");
  assert.equal(macos.fileName, "Work-OS-Companion-macOS-Universal-UNSIGNED.dmg");
  assert.equal(windows.steps.length, 3);
  assert.equal(macos.steps.length, 3);
  assert.match(windows.checksumCommand, /Get-FileHash/);
  assert.match(windows.checksumCommand, /Setup-UNSIGNED\.exe/);
  assert.match(macos.checksumCommand, /shasum -a 256/);
  assert.match(macos.checksumCommand, /Universal-UNSIGNED\.dmg/);

  const windowsPrompts = JSON.stringify(windows);
  const macPrompts = JSON.stringify(macos);
  assert.match(windowsPrompts, /Windows protected your PC/);
  assert.match(windowsPrompts, /More info/);
  assert.match(windowsPrompts, /Run anyway/);
  assert.match(windowsPrompts, /isn’t commonly downloaded/);
  assert.match(windowsPrompts, /Do not turn off antivirus protection/);

  assert.match(macPrompts, /Apple could not verify/);
  assert.match(macPrompts, /Privacy & Security/);
  assert.match(macPrompts, /Open Anyway/);
  assert.match(macPrompts, /Move to Bin/);
  assert.match(macPrompts, /Do not disable Gatekeeper/);
  assert.doesNotMatch(macPrompts, /Run anyway/);

  assert.equal(downloadGuide("linux"), null);
  assert.equal(downloadGuidePath("windows"), "/work-os/downloads/thank-you/windows");
  assert.equal(downloadHref("macos"), "/downloads/work-os/macos");

  const allPrompts = `${windowsPrompts} ${macPrompts}`;
  assert.doesNotMatch(allPrompts, /spctl --master-disable|--master-disable/);
  assert.doesNotMatch(allPrompts, /(?<!not\s)(?:turn off|disable)\s+(?:your\s+)?(?:antivirus|gatekeeper)/i);
});

test("every download button goes through the guided download rather than a bare link", () => {
  const chooser = read("src/modules/work-os/marketing/DownloadChooser.tsx");
  const link = read("src/modules/work-os/marketing/DownloadLink.tsx");
  assert.match(chooser, /<DownloadLink/);
  assert.equal((chooser.match(/<DownloadLink/g) ?? []).length, 2, "primary and alternate platform");
  assert.doesNotMatch(chooser, /<a[^>]+download/);
  assert.match(link, /downloadHref\(platform\)/);
  assert.match(link, /const link = document\.createElement\("a"\)/);
  assert.match(link, /link\.href = downloadHref\(platform\)/);
  assert.match(link, /link\.download = ""/);
  assert.match(link, /link\.click\(\)/);
  assert.match(link, /router\.push\(downloadGuidePath\(platform\)\)/);
  assert.match(link, /event\.preventDefault\(\)/);
  assert.match(link, /event\.metaKey/);
});

test("the install guide is static for the two real platforms and fails closed for anything else", () => {
  const page = read("src/app/work-os/(site)/downloads/thank-you/[platform]/page.tsx");
  assert.match(page, /export const dynamicParams = false/);
  assert.match(page, /generateStaticParams/);
  assert.match(page, /if \(!guide\) notFound\(\)/);
  assert.match(page, /downloadHref\(guide\.platform\)/);
  assert.match(page, /Verify this download \(SHA-256\)/);
  assert.match(page, /Then install in three steps/);
  assert.match(page, /Read this before installing/);
  const routes = read("test/work-os-landing-routes.test.mts");
  assert.match(routes, /\/work-os\/downloads\/thank-you\/windows/);
  assert.match(routes, /\/work-os\/downloads\/thank-you\/macos/);
  assert.match(routes, /\/work-os\/downloads\/thank-you\/linux/);
});

test("previous and next follow the tutorial library order and stop at its edges", () => {
  const first = TUTORIALS[0];
  const second = TUTORIALS[1];
  const last = TUTORIALS.at(-1)!;
  assert.deepEqual(adjacentTutorials(first.slug), { previous: null, next: second });
  assert.deepEqual(adjacentTutorials(second.slug), { previous: first, next: TUTORIALS[2] });
  assert.deepEqual(adjacentTutorials(last.slug), { previous: TUTORIALS.at(-2), next: null });
  assert.deepEqual(adjacentTutorials("not-real"), { previous: null, next: null });

  const page = read("src/app/work-os/(site)/tutorials/[slug]/page.tsx");
  assert.match(page, /adjacentTutorials\(tutorial\.slug\)/);
  assert.match(page, /aria-label="More tutorials"/);
  assert.match(page, /Previous tutorial: \$\{previous\.title\}/);
  assert.match(page, /Next tutorial: \$\{next\.title\}/);
  assert.match(page, /<span>Previous<\/span>/);
  assert.match(page, /<span>Next<\/span>/);
});
