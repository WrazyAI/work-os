/** Local-only recovery UI check. The preview's reset callback is a no-op.
 * Start companion Vite, then BASE_URL=http://127.0.0.1:1442 node scripts/verify-vault-recovery.mjs
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://127.0.0.1:1442";
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname), "Use a local fixture, never an employee account");
const browser = await chromium.launch();
try {
  for (const [width, height] of [[1440, 900], [1024, 768], [720, 900], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${base}/?preview-loading&state=vault-decrypt`);
    await page.getByText(/couldn't decrypt/).waitFor();
    assert.equal(await page.getByRole("button", { name: "Continue offline" }).count(), 0);
    const start = page.getByRole("button", { name: "Start fresh on this device", exact: true });
    await start.focus();
    assert.equal(await start.evaluate((element) => document.activeElement === element), true);
    await start.click();
    const confirm = page.getByRole("button", { name: "Delete local data and start fresh", exact: true });
    await confirm.waitFor();
    await page.getByText(/This deletes this device's saved session and queued updates/).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Horizontal overflow");
    for (const button of await page.getByRole("button").all()) {
      const box = await button.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0 && box.y + box.height <= height, JSON.stringify(box));
    }
    // Exercise the real confirmation control, but not the host's destructive reset.
    await confirm.click();
    await start.waitFor();
    await start.click();
    await page.waitForTimeout(8_200);
    await start.waitFor();
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await page.goto(`${base}/?preview-loading&state=vault-confirm`);
    await page.getByText(/macOS is waiting/).waitFor();
    assert.equal(await page.getByRole("button", { name: "Start fresh on this device", exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    console.log(`${width}x${height}: decryption explanation, focus, confirmation, timeout, and non-resettable permission state passed`);
    await page.close();
  }
} finally {
  await browser.close();
}
