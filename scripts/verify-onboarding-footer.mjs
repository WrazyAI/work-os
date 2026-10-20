/** Offline rendered regression. Start the companion's Vite server first.
 * BASE_URL=http://127.0.0.1:1420 node scripts/verify-onboarding-footer.mjs
 * BROWSER=webkit selects Safari's engine (install Playwright WebKit first).
 * --prove-legacy reinstates the old row template and must reproduce clipping.
 */
import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";

const engine = process.env.BROWSER ?? "chromium";
assert.ok(["chromium", "webkit"].includes(engine), "BROWSER must be chromium or webkit");
const base = process.env.BASE_URL ?? "http://127.0.0.1:1420";
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname), "Use a local fixture server, never a live account");
const legacy = process.argv.includes("--prove-legacy");
const browser = await ({ chromium, webkit })[engine].launch(
  engine === "webkit" && process.env.WEBKIT_EXECUTABLE_PATH
    ? { executablePath: process.env.WEBKIT_EXECUTABLE_PATH } : {},
);
let checks = 0;
try {
  for (const [width, height] of legacy ? [[1000, 760]] : [[1000, 500], [1000, 540], [1440, 900], [1024, 768], [1000, 600], [900, 640], [720, 900], [390, 844]]) {
    for (const simulated of legacy ? [false] : [false, true]) {
      const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
      try {
        await page.goto(`${base}/?preview-onboarding&simulated=${simulated ? "1" : "0"}`);
        await page.getByRole("button", { name: "Start setup" }).click();
        if (legacy) {
          await page.getByRole("button", { name: "Continue", exact: true }).click();
          await page.addStyleTag({ content: ".onboarding-workspace { display: grid; grid-template-rows: 68px auto minmax(0, 1fr) auto; }" });
          const top = await page.locator(".phase-actions").evaluate((el) => el.getBoundingClientRect().top);
          assert.ok(top >= height, "The old production template must put the footer below the viewport");
          console.log(`${engine}: reproduced legacy clipping at ${width}×${height}, footer top=${top}`);
          continue;
        }
        for (let step = 0; step < 5; step++) {
          const forward = page.locator(".phase-actions .primary");
          // Stacked layouts scroll the page; desktop keeps the step body as
          // its only scroller. Do not auto-scroll desktop and mask the bug.
          if (width <= 720) await page.locator(".phase-actions").scrollIntoViewIfNeeded();
          const geometry = await page.locator(".phase-actions").evaluate((footer) => {
            const r = footer.getBoundingClientRect();
            const buttons = [...footer.querySelectorAll("button")];
            return {
              top: r.top, bottom: r.bottom, height: r.height,
              hit: buttons.every((button) => {
                const b = button.getBoundingClientRect();
                return button.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2));
              }),
              overflowX: document.documentElement.scrollWidth > innerWidth,
            };
          });
          assert.ok(geometry.top >= 0 && geometry.bottom <= height + 1 && geometry.height > 0 && geometry.hit, JSON.stringify({ engine, width, height, simulated, step, geometry }));
          assert.equal(geometry.overflowX, false, "No horizontal overflow");
          if (width > 720) assert.ok(Math.abs(geometry.bottom - height) <= 1, "Desktop footer stays pinned");
          if (step === 1) {
            assert.equal(await page.locator(".archetype-grid > button").count(), 9, "Exercise the real dense catalog");
            if (width > 720 && height <= 768) {
              assert.ok(await page.locator(".phase-content").evaluate((el) => el.scrollHeight > el.clientHeight), "The dense scope step must overflow internally");
            }
            await page.getByRole("button", { name: "Backend", exact: true }).click();
          }
          if (step === 4) {
            // Validation must not lose the footer; keyboard can still reach
            // and operate Continue once the consent has been read.
            await forward.click();
            await page.getByRole("alert").waitFor();
            await page.getByRole("checkbox").first().check();
            if (width <= 720) await forward.scrollIntoViewIfNeeded();
          }
          await forward.focus();
          await page.keyboard.press("Enter");
          checks++;
        }
        await page.getByRole("button", { name: "Enter My Day" }).waitFor();
        console.log(`${engine}: ${width}×${height}, scenario=${simulated}: all five footers clickable; completed setup`);
      } finally { await page.close(); }
    }
  }
  console.log(`${engine}: ${checks} footer checks passed${legacy ? "; legacy defect reproduced" : ""}`);
} finally { await browser.close(); }
