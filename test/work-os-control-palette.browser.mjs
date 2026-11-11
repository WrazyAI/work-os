import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.WORK_OS_SITE_URL || "http://localhost:1453";
const evidence = process.env.WORK_OS_PALETTE_EVIDENCE || "/tmp/opencode/green-controls";
mkdirSync(evidence, { recursive: true });
const browser = await chromium.launch();
async function colors(locator) {
  return locator.evaluate((node) => {
    const style = getComputedStyle(node);
    const luminance = (color) => color.match(/\d+/g).slice(0, 3).map(Number).map((value) => {
      const channel = value / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    }).reduce((sum, channel, i) => sum + channel * [.2126, .7152, .0722][i], 0);
    const a = luminance(style.color), b = luminance(style.backgroundColor);
    return { foreground: style.color, background: style.backgroundColor, contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
  });
}
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    page.setDefaultNavigationTimeout(120000);
    await page.goto(`${base}/work-os/downloads`, { waitUntil: "domcontentloaded", timeout: 120000 });
    const download = page.getByRole("link", { name: /^Download for (Windows|macOS)$/ }).first();
    await download.waitFor();
    const normal = await colors(download);
    assert.equal(normal.background, "rgb(212, 232, 190)", "download button uses the landing's pale green, not purple");
    assert.ok(normal.contrast >= 4.5, "button text remains readable on pale green");
    const iconColor = await download.locator("svg").evaluate((node) => getComputedStyle(node).color);
    assert.equal(iconColor, "rgb(34, 44, 38)", "download icon uses dark green on the pale green button");
    await download.hover();
    const hover = await colors(download);
    assert.equal(hover.background, "rgb(225, 243, 207)");
    assert.ok(hover.contrast >= 4.5);
    await download.focus();
    assert.equal(await download.evaluate((node) => getComputedStyle(node).outlineColor), "rgb(74, 125, 34)");
    await page.screenshot({ path: `${evidence}/downloads-${width}.png`, fullPage: true });
    await page.goto(`${base}/work-os/tutorials`);
    const plays = page.locator('main a[href^="/work-os/tutorials/"] span[aria-hidden="true"]').filter({ hasText: "▶" });
    assert.equal(await plays.count(), 11, "every published lesson has a play icon");
    for (const play of await plays.all()) {
      const tutorial = await colors(play);
      assert.equal(tutorial.background, "rgb(212, 232, 190)", "every tutorial play icon uses the same pale green");
      assert.equal(tutorial.foreground, "rgb(34, 44, 38)");
      assert.ok(tutorial.contrast >= 4.5);
    }
    const lesson = page.locator('main a[href="/work-os/tutorials/eod-draft"]');
    await lesson.focus();
    assert.equal(await lesson.evaluate((node) => getComputedStyle(node).outlineColor), "rgb(74, 125, 34)");
    assert.equal(await page.locator('nav a[aria-current="page"]').evaluate((node) => getComputedStyle(node).color), "rgb(74, 125, 34)", "selected nav uses readable green rather than purple");
    await page.screenshot({ path: `${evidence}/tutorials-${width}.png`, fullPage: true });
    await lesson.press("Enter");
    await page.waitForURL("**/work-os/tutorials/eod-draft");
    assert.equal(await page.locator("video").count(), 1, "green tutorial links still open the existing film player");
    assert.equal(await page.locator("video").getAttribute("autoplay"), null);
    await page.goto(`${base}/work-os/downloads/thank-you/windows`);
    const warning = page.getByRole("region", { name: "Read this before installing" });
    assert.equal(await warning.evaluate((node) => getComputedStyle(node).backgroundColor), "rgb(255, 241, 239)", "security warnings stay red");
    await page.goto(`${base}/work-os`);
    assert.equal(await page.locator("[data-landing]").evaluate((node) => getComputedStyle(node).backgroundColor), "rgb(39, 35, 49)", "the purple landing background is preserved");
    await page.getByRole("button", { name: "Play companion celebration" }).focus();
    assert.equal(await page.getByRole("button", { name: "Play companion celebration" }).evaluate((node) => getComputedStyle(node).outlineColor), "rgb(74, 125, 34)", "mascot focus is green rather than purple");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.close();
  }
  console.log("PASS: pale-green buttons/icons, readable hover/focus/selected colors, unchanged purple landing and red warnings, desktop/mobile.");
} finally { await browser.close(); }
