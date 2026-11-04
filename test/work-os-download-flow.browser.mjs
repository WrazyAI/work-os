// Run against a running Next server: node test/work-os-download-flow.browser.mjs
// Set WORK_OS_SITE_URL for the same read/download-only checks after deployment.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { chromium, webkit } from "playwright";

const base = process.env.WORK_OS_SITE_URL || "http://localhost:1451";
const evidence = process.env.WORK_OS_DOWNLOAD_EVIDENCE || "/tmp/opencode/download-warning-clarity";
mkdirSync(evidence, { recursive: true });
const engine = process.env.WORK_OS_BROWSER === "webkit" ? webkit : chromium;
const browser = await engine.launch();
try {
  const cases = [
    ["windows", "macOS", "Windows NT 10.0; Win64; x64"],
    ["macos", "Windows", "Macintosh; Intel Mac OS X 10_15_7"],
  ].filter(([platform]) => engine !== webkit || platform === "macos");
  for (const [platform, alternate, os] of cases) {
    const label = platform === "windows" ? "Windows" : "macOS";
    const context = await browser.newContext({ acceptDownloads: true,
      userAgent: engine === webkit
        ? `Mozilla/5.0 (${os}) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15`
        : `Mozilla/5.0 (${os}) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36`,
      viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${base}/work-os/downloads`, { waitUntil: "domcontentloaded", timeout: 120000 });
    const logo = page.getByRole("link", { name: /^Work OS/ }).locator("img");
    await logo.waitFor({ timeout: 5000 });
    await logo.evaluate((image) => image.decode());
    assert.equal(await logo.evaluate((image) => image.complete && image.naturalWidth > 0), true);
    const imageResponse = await page.request.get(new URL(await logo.getAttribute("src"), base).href);
    assert.equal(imageResponse.ok(), true);
    assert.deepEqual(await imageResponse.body(), readFileSync(new URL("../desktop/work-os-companion/src/assets/work-os-mark.png", import.meta.url)), "the public logo uses the desktop app's actual artwork");
    await page.getByText(label === "Windows" ? "For your Windows PC." : "For your Mac.", { exact: false }).waitFor();
    const primary = page.getByRole("link", { name: `Download for ${label}`, exact: true });
    await primary.waitFor();
    const toggle = page.getByRole("button", { name: "Other platforms", exact: true });
    await toggle.waitFor({ timeout: 5000 });
    await toggle.focus();
    await page.keyboard.press("Enter");
    const alternative = page.getByRole("link", { name: `Download for ${alternate}`, exact: true });
    await alternative.waitFor();
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    await page.keyboard.press("Escape");
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    assert.equal(await toggle.evaluate((el) => document.activeElement === el), true);
    assert.doesNotMatch(await page.locator("main").innerText(), /Linux|Coming later/i);
    await page.screenshot({ path: `${evidence}/${platform}-downloads-wide.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await toggle.press("ArrowDown");
    await alternative.waitFor();
    assert.equal(await alternative.evaluate((el) => document.activeElement === el), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${evidence}/${platform}-dropdown-narrow.png`, fullPage: true });
    await page.getByRole("heading", { level: 1 }).click();
    assert.equal(await toggle.getAttribute("aria-expanded"), "false", "outside click dismisses the dropdown");
    await toggle.click();
    const [alternateDownload] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), alternative.click()]);
    await page.waitForURL(`**/work-os/downloads/thank-you/${platform === "windows" ? "macos" : "windows"}`);
    assert.match(alternateDownload.suggestedFilename(), platform === "windows" ? /\.dmg$/ : /\.exe$/);
    await page.getByRole("link", { name: "← All downloads", exact: true }).click();
    await primary.waitFor();
    await page.setViewportSize({ width: 1440, height: 900 });

    // Real attachment bytes, not a mocked response. The guide must open at start.
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), primary.click()]);
    await page.waitForURL(`**/work-os/downloads/thank-you/${platform}`);
    assert.match(download.suggestedFilename(), platform === "windows" ? /\.exe$/ : /\.dmg$/);
    assert.equal(await download.failure(), null);
    const downloadResponse = await page.request.get(`${base}/downloads/work-os/${platform}`);
    assert.equal(downloadResponse.status(), 200);
    const checksumResponse = await page.request.get(`${base}/downloads/work-os/${platform}/checksums`);
    assert.equal(checksumResponse.status(), 200);
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(await downloadResponse.body()).digest("hex");
    assert.ok((await checksumResponse.text()).includes(`${hash}  ${download.suggestedFilename()}`), "installer bytes match published checksums");
    const warnings = page.getByRole("region", { name: "Read this before installing" });
    await warnings.waitFor();
    assert.match(await warnings.innerText(), /antivirus/i);
    assert.match(await warnings.innerText(), /admin/i);
    const box = await warnings.boundingBox();
    assert.ok(box && box.y < 420, "warnings lead the page rather than following install steps");
    assert.equal(await page.locator("main ol > li").count(), 3);
    assert.equal(await page.getByText("More help with security prompts", { exact: true }).evaluate((el) => el.parentElement.open), false);
    await page.screenshot({ path: `${evidence}/${platform}-guide-wide.png`, fullPage: true });
    for (const width of [1024, 720, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${label} guide ${width}px overflow`);
      const narrow = await warnings.boundingBox();
      assert.ok(narrow && narrow.y < 420, "warning visible before scrolling on a phone");
      if (width === 390) await page.screenshot({ path: `${evidence}/${platform}-guide-narrow.png`, fullPage: true });
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByText("More help with security prompts", { exact: true }).click();
    await page.getByText("Verify this download (SHA-256)", { exact: true }).click();
    await page.locator("code").waitFor({ state: "visible" });
    assert.deepEqual(errors, []);
    await context.close();
  }
  const fallback = await browser.newContext({ userAgent: "Unknown device" });
  const page = await fallback.newPage();
  await page.goto(`${base}/work-os/downloads`);
  await page.getByText("Windows selected. Choose the arrow for macOS.", { exact: false }).waitFor();
  await page.getByRole("link", { name: "Download for Windows", exact: true }).waitFor();
  assert.doesNotMatch(await page.locator("main").innerText(), /Linux|Coming later/i);
  await fallback.close();
} finally {
  await browser.close();
}
console.log(`${engine.name()}: detected downloads, dropdown keyboard, real downloads, warning-first guides and responsive checks passed.`);
