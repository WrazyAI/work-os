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
    await page.goto(`${base}/work-os`, { waitUntil: "domcontentloaded", timeout: 120000 });
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
    if (width === 1366 && height === 768) {
      const skip = page.getByRole("link", { name: "Skip to content" });
      await skip.focus();
      const contrast = await skip.evaluate((node) => {
        const style = getComputedStyle(node);
        const luminance = (color) => color.match(/\d+/g).slice(0, 3).map(Number).map((value) => {
          const channel = value / 255;
          return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
        }).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
        const a = luminance(style.color), b = luminance(style.backgroundColor);
        return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      });
      assert.ok(contrast >= 4.5, `skip-link text contrast: ${contrast}`);
      await skip.blur();
      const footer = page.locator("[data-landing] footer");
      const footerBox = await footer.boundingBox();
      assert.ok(Math.abs(footerBox.x - box.x) < 1, "dark footer aligns with the landing content axis");
      assert.equal(await footer.evaluate((node) => getComputedStyle(node).borderTopWidth), "0px", "closing owns the one separator");
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
      assert.equal(await page.locator('[data-state="celebrate"] .studio-rig').evaluate((node) => getComputedStyle(node).animationName), "none");
      await page.getByRole("button", { name: "Resume motion", exact: true }).click();
      await page.emulateMedia({ reducedMotion: "reduce" });
      await mascot.press("Space");
      await page.locator('[data-state="celebrate"] .site-ready-face').waitFor();
      assert.equal(await page.locator('[data-state="celebrate"]').getAttribute("data-reduced"), "true");
      assert.equal(await page.locator('[data-state="celebrate"] .studio-rig').evaluate((node) => getComputedStyle(node).animationName), "none");
      await page.screenshot({ path: `${evidence}/success-reduced.png` });
      await page.getByRole("button", { name: "Insights", exact: true }).click();
      assert.match(await page.locator("[data-product-capture]").getAttribute("src"), /workspace-insights/);
      await page.getByRole("button", { name: "Tasks", exact: true }).click();
      await page.getByRole("button", { name: "My Day", exact: true }).click();
      assert.match(await page.locator("[data-product-capture]").getAttribute("src"), /workspace-today/);
      await page.waitForFunction(() => document.querySelector("[data-product-capture]").complete);
      await page.emulateMedia({ reducedMotion: "no-preference" });
      // Exercise decode cancellation while transitions are enabled, not only the
      // reduced-motion branch above.
      await page.getByRole("button", { name: "Tasks", exact: true }).click();
      await page.getByRole("button", { name: "Insights", exact: true }).click();
      await page.getByRole("button", { name: "My Day", exact: true }).click();
      await page.waitForFunction(() => {
        const image = document.querySelector("[data-product-capture]");
        return image.complete && image.src.includes("workspace-today") && getComputedStyle(image).opacity === "1";
      });
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
  if (motion && process.env.WORK_OS_LANDING_FAILURE_PROBES !== "0") {
    const delayed = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    let releaseMotion;
    let markRequested;
    const motionRequested = new Promise((resolve) => { markRequested = resolve; });
    const motionGate = new Promise((resolve) => { releaseMotion = resolve; });
    await delayed.route("**/*landing-motion*", async (route) => {
      markRequested();
      await motionGate;
      await route.continue();
    });
    await delayed.goto(`${base}/work-os`, { waitUntil: "domcontentloaded" });
    await motionRequested;
    await delayed.getByRole("button", { name: "Pause motion", exact: true }).click();
    const lateChunk = delayed.waitForResponse((response) => response.url().includes("landing-motion"));
    releaseMotion();
    await lateChunk;
    await delayed.locator('[data-landing][data-motion-paused="true"][data-motion-entered="true"]').waitFor();
    assert.equal(await delayed.locator("[data-hero-stage]").evaluate((node) => node.style.opacity), "");
    assert.equal(await delayed.locator("[data-hero-line]").first().evaluate((node) => node.style.transform), "");
    // Unmount while a capture transition can still be pending.
    await delayed.getByRole("button", { name: "Resume motion", exact: true }).click();
    await delayed.getByRole("button", { name: "Insights", exact: true }).click();
    await delayed.getByRole("link", { name: /Get Work OS/ }).first().click();
    await delayed.waitForURL("**/work-os/downloads");
    assert.equal(await delayed.locator("[data-landing]").count(), 0);
    await delayed.close();
    const delayedArt = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion: "reduce" });
    let resumeArt;
    let markArt;
    const artRequested = new Promise((resolve) => { markArt = resolve; });
    const artGate = new Promise((resolve) => { resumeArt = resolve; });
    await delayedArt.route("**/studio-otto.svg", async (route) => {
      if (route.request().resourceType() === "fetch") { markArt(); await artGate; }
      await route.continue();
    });
    await delayedArt.goto(`${base}/work-os`, { waitUntil: "domcontentloaded" });
    await artRequested;
    await delayedArt.getByRole("button", { name: "Play companion celebration" }).click();
    resumeArt();
    await delayedArt.locator('[data-ready="true"][data-state="celebrate"] .site-ready-face').waitFor();
    await delayedArt.close();
    // Failure modes leave actual server content and the static mascot available.
    const fallback = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    let blockedMotion = 0;
    await fallback.route("**/*landing-motion*", (route) => { blockedMotion++; return route.abort(); });
    await fallback.route("**/studio-otto.svg", (route) => route.request().resourceType() === "fetch"
      ? route.fulfill({ status: 503, body: "unavailable" }) : route.continue());
    await fallback.goto(`${base}/work-os`);
    await fallback.locator('[data-landing][data-motion-entered="true"]').waitFor();
    await fallback.getByRole("heading", { level: 1, name: /Good work/ }).waitFor();
    await fallback.getByRole("link", { name: /Get Work OS/ }).first().waitFor();
    assert.equal(await fallback.locator('button[aria-label="Play companion celebration"] img').evaluate((image) => image.complete && image.naturalWidth > 0), true);
    assert.equal(await fallback.locator("h1").evaluate((node) => getComputedStyle(node).opacity), "1");
    assert.ok(blockedMotion > 0, "the failure probe actually blocked the motion chunk");
    await fallback.screenshot({ path: `${evidence}/failed-motion-art-static.png` });
    await fallback.close();
  }
  console.log("PASS: approved landing, short-screen hero, success face, motion, light sibling pages, responsive and no-JS contracts.");
} finally {
  await browser.close();
}
