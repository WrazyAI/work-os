import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.WORK_OS_SITE_URL || "http://localhost:1451";
const evidence = process.env.WORK_OS_LANDING_EVIDENCE || "/tmp/opencode/good-company-browser";
const motion = process.env.WORK_OS_LANDING_MOTION !== "0";
mkdirSync(evidence, { recursive: true });
const browser = await chromium.launch();
try {
  for (const [width, height] of [[1366, 768], [1366, 650], [1440, 900], [1920, 1080], [1024, 768], [720, 900], [390, 844], [320, 740]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${base}/work-os`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { level: 1, name: /Good work\.\s*Good company\./ }).waitFor({ timeout: 10000 });
    if (motion) await page.locator('[data-landing][data-motion-entered="true"]').waitFor();
    const stage = page.locator("[data-hero-stage]");
    await stage.waitFor();
    await page.waitForFunction(() => {
      const node = document.querySelector("[data-hero-stage]");
      return getComputedStyle(node).opacity === "1" && getComputedStyle(node).transform === "none";
    });
    const box = await stage.boundingBox();
    if (width >= 900) {
      assert.ok(box.height >= (height <= 700 ? 220 : 240));
      assert.ok(box.y + box.height <= height, `whole product stage fits ${width}×${height}, got ${JSON.stringify(box)}`);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await page.locator("h1").count(), 1);
    await page.screenshot({ path: `${evidence}/${width}x${height}.png` });
    if (width === 1366 && height === 768 && motion) {
      const mascot = page.getByRole("button", { name: "Play companion celebration" });
      await page.locator('[data-ready="true"]').waitFor();
      await mascot.click();
      await page.locator('[data-state="celebrate"] .site-ready-face').waitFor();
      assert.equal(await page.locator('[data-state="celebrate"] .studio-terminal-idle').isVisible(), false);
      await mascot.click();
      await page.getByRole("button", { name: "Pause motion", exact: true }).click();
      await mascot.focus();
      await mascot.press("Enter");
      await page.locator('[data-state="celebrate"] .site-ready-face').waitFor();
      await page.getByRole("button", { name: "Resume motion", exact: true }).click();
      await page.emulateMedia({ reducedMotion: "reduce" });
      await mascot.press("Space");
      await page.locator('[data-state="celebrate"] .site-ready-face').waitFor();
      assert.equal(await page.locator('[data-state="celebrate"]').getAttribute("data-reduced"), "true");
      await page.screenshot({ path: `${evidence}/success-reduced.png` });
      await page.getByRole("button", { name: "Insights", exact: true }).click();
      assert.match(await page.locator("[data-product-capture]").getAttribute("src"), /workspace-insights/);
      await page.getByRole("button", { name: "Tasks", exact: true }).click();
      await page.getByRole("button", { name: "My Day", exact: true }).click();
      assert.match(await page.locator("[data-product-capture]").getAttribute("src"), /workspace-today/);
      await page.emulateMedia({ reducedMotion: "no-preference" });
      for (const selector of ["[data-workday-story]", "[data-workday-steps]", "[data-tutorial-feature]", "[data-landing-closing]"]) {
        await page.locator(selector).scrollIntoViewIfNeeded();
      }
      await page.getByRole("button", { name: "Pause motion", exact: true }).click();
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: `${evidence}/full-page.png`, fullPage: true });
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion: "reduce" });
  for (const path of ["/work-os/downloads", "/work-os/tutorials", "/work-os/tutorials/eod-draft", "/work-os/downloads/thank-you/windows"]) {
    await page.goto(`${base}${path}`);
    const background = await page.locator("[data-work-os-site]").evaluate((node) => getComputedStyle(node).backgroundColor);
    assert.match(background, /rgb\((25[0-5]|24\d), (25[0-5]|24\d), (25[0-5]|24\d)\)/, `${path} stays light, got ${background}`);
    await page.screenshot({ path: `${evidence}/${path.split("/").at(-1)}-light.png`, fullPage: true });
  }
  await page.getByRole("region", { name: "Read this before installing" }).waitFor();
  await page.goto(`${base}/work-os/tutorials/eod-draft`);
  assert.ok(await page.getByRole("link", { name: /Next tutorial/ }).count());
  assert.equal(await page.locator("video").getAttribute("autoplay"), null);
  await page.close();
  const staticContext = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1366, height: 768 } });
  const staticPage = await staticContext.newPage();
  await staticPage.goto(`${base}/work-os`);
  await staticPage.getByRole("heading", { level: 1, name: /Good work/ }).waitFor();
  await staticPage.getByRole("link", { name: /Get Work OS/ }).first().waitFor();
  const stageBox = await staticPage.locator("[data-hero-stage]").boundingBox();
  assert.ok(stageBox.y + stageBox.height <= 768);
  await staticContext.close();
  console.log("PASS: approved landing, short-screen hero, success face, motion, light sibling pages, responsive and no-JS contracts.");
} finally {
  await browser.close();
}
