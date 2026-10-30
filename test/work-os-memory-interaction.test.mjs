// Run against the companion Vite dev server: MEMORY_PREVIEW_URL=http://127.0.0.1:5179 node --test test/work-os-memory-interaction.test.mjs
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const base = process.env.MEMORY_PREVIEW_URL || "http://127.0.0.1:5179";
const browser = await chromium.launch({ headless: true });
after(() => browser.close());
test("memory modal keeps its dimensions when switching tabs", async () => {
  for (const viewport of [{ width: 1024, height: 768 }, { width: 390, height: 600 }]) {
    const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
    try {
      await page.goto(`${base}/?preview-memory`);
      const modal = page.getByRole("dialog", { name: "What Otto remembers" });
      const before = await modal.boundingBox();
      await page.getByRole("tab", { name: /Remembered/ }).click();
      const after = await modal.boundingBox();
      assert.ok(before && after);
      assert.equal(after.width, before.width);
      assert.equal(after.height, before.height);
      assert.ok(after.y >= 0 && after.y + after.height <= viewport.height);
    } finally { await page.close(); }
  }
});
async function screenshot(page, name) {
  if (!process.env.MEMORY_SCREENSHOT_DIR) return;
  await mkdir(process.env.MEMORY_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(process.env.MEMORY_SCREENSHOT_DIR, name) });
}

test("Keep waits for confirmation, exits, and moves remaining proposals", async () => {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  try {
    await page.goto(`${base}/?preview-memory&memory-delay=1000`);
    const cards = page.locator(".memory-card");
    const first = cards.first();
    const content = await first.locator("strong").textContent();
    await page.evaluate(() => {
      window.memoryEvents = [];
      const section = document.querySelector(".memory-section.review");
      new MutationObserver(() => {
        const status = section.querySelector(".memory-review-status")?.textContent;
        if (status) window.memoryEvents.push(status);
        const exiting = section.querySelector(".memory-card-exiting");
        if (exiting) window.memoryEvents.push(`exit:${getComputedStyle(exiting).animationName}`);
      }).observe(section, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class"] });
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args) {
        if (this.matches(".memory-card")) window.memoryEvents.push(`move:${this.dataset.memoryId}`);
        return animate.apply(this, args);
      };
    });
    await first.getByRole("button", { name: "Keep" }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Saving…" }).waitFor();
    await screenshot(page, "saving.png");
    assert.equal(await cards.count(), 3);
    assert.equal(await page.getByText("Fact kept.").count(), 0);
    assert.equal(await first.locator(".memory-spinner").count(), 1);
    assert.equal(await first.locator(".memory-keep").evaluate((node) => getComputedStyle(node).opacity), "1");
    await page.waitForFunction(() => document.querySelectorAll(".memory-card").length === 2);
    const events = await page.evaluate(() => window.memoryEvents);
    assert.ok(events.includes("Fact kept."));
    assert.ok(events.includes("exit:memory-card-exit"));
    assert.ok(events.some((event) => event.startsWith("move:")));
    assert.equal(await page.locator(".memory-card").filter({ hasText: content }).count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement?.id), "memory-tab-review");
    await page.getByRole("tab", { name: /Remembered/ }).click();
    assert.equal(await page.getByText(content, { exact: true }).count(), 1);
  } finally { await page.close(); }
});

test("failed Keep preserves the proposal and offers a retry", async () => {
  const page = await browser.newPage();
  try {
    await page.goto(`${base}/?preview-memory&memory-delay=200&memory-fail`);
    await page.locator(".memory-card").first().getByRole("button", { name: "Keep" }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("alert").waitFor();
    await screenshot(page, "error.png");
    assert.equal(await page.locator(".memory-card").count(), 3);
    assert.equal(await page.getByText("Fact kept.").count(), 0);
    assert.equal(await page.locator(".memory-card").first().getByRole("button", { name: "Keep" }).isEnabled(), true);
    assert.equal(await page.evaluate(() => document.activeElement?.className), "memory-keep");
  } finally { await page.close(); }
});

test("Discard removes a proposal without adding it to remembered facts", async () => {
  const page = await browser.newPage();
  try {
    await page.goto(`${base}/?preview-memory&memory-delay=250`);
    const first = page.locator(".memory-card").first();
    const content = await first.locator("strong").textContent();
    await first.getByRole("button", { name: "Discard" }).click();
    await page.getByRole("button", { name: "Discarding…" }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll(".memory-card").length === 2);
    assert.equal(await page.locator(".memory-card").filter({ hasText: content }).count(), 0);
    await page.getByRole("tab", { name: /Remembered/ }).click();
    assert.equal(await page.getByText(content, { exact: true }).count(), 0);
  } finally { await page.close(); }
});

test("new proposals enter with a short animation", async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto(`${base}/?preview-memory&memory-delay=300&memory-arrival`);
    await page.evaluate(() => {
      window.memoryAnimated = [];
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args) {
        if (this.matches(".memory-card")) window.memoryAnimated.push(this.dataset.memoryId);
        return animate.apply(this, args);
      };
    });
    await page.locator(".memory-card").first().getByRole("button", { name: "Keep" }).click();
    await page.getByText("New proposed fact.").waitFor();
    assert.ok((await page.evaluate(() => window.memoryAnimated)).includes("new-proposal"));
    await page.locator(".memory-card-exiting").waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => {
      const list = document.querySelector(".memory-cards").getBoundingClientRect();
      return [...document.querySelectorAll(".memory-card")].every((node) => {
        const row = node.getBoundingClientRect();
        return row.left >= list.left - 1 && row.right <= list.right + 1;
      });
    }), true);
    await page.locator(".memory-cards").evaluate(async (node) => {
      await Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)));
    });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await screenshot(page, "wide.png");
  } finally { await page.close(); }
});

test("reduced motion removes row and spinner animation and preserves focus", async () => {
  const page = await browser.newPage({ reducedMotion: "reduce", viewport: { width: 390, height: 844 } });
  try {
    await page.goto(`${base}/?preview-memory&memory-delay=400`);
    const exitAnimation = await page.locator(".memory-card").first().evaluate((node) => {
      node.classList.add("memory-card-exiting");
      const animation = getComputedStyle(node).animationName;
      node.classList.remove("memory-card-exiting");
      return animation;
    });
    assert.equal(exitAnimation, "none");
    await page.evaluate(() => {
      window.memoryAnimated = [];
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args) {
        if (this.matches(".memory-card")) window.memoryAnimated.push(this.dataset.memoryId);
        return animate.apply(this, args);
      };
    });
    await page.locator(".memory-card").first().getByRole("button", { name: "Keep" }).focus();
    await page.keyboard.press("Enter");
    await page.locator(".memory-spinner").waitFor();
    assert.equal(await page.locator(".memory-spinner").evaluate((node) => getComputedStyle(node).animationName), "none");
    await page.waitForFunction(() => document.querySelectorAll(".memory-card").length === 2);
    assert.deepEqual(await page.evaluate(() => window.memoryAnimated), []);
    assert.equal(await page.evaluate(() => document.activeElement?.id), "memory-tab-review");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await screenshot(page, "narrow.png");
  } finally { await page.close(); }
});
