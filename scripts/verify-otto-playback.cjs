// Token-free rendered checks. Run with the companion Vite server available.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const base = process.env.OTTO_PREVIEW_URL || 'http://127.0.0.1:5173';

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    context.setDefaultNavigationTimeout(60000);
    const page = await context.newPage();
    await page.clock.install({ time: new Date('2026-10-15T10:00:00Z') });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
    await page.goto(base + '/?preview-mascot');
    const pet = page.locator('.mascot-lab-live .mascot-pet');
    const sprite = pet.locator('.otto-sprite[data-loaded="true"]');
    await sprite.waitFor();
    await page.clock.pauseAt(new Date('2026-10-15T10:01:00Z'));
    // Independent artwork anchor: neutral face center is cell pixel (96,100).
    const box = await sprite.locator('.otto-sprite-frame').boundingBox();
    const face = { x: box.x + box.width / 2, y: box.y + box.height * 100 / 208 };
    await page.mouse.move(face.x, face.y);
    await page.clock.runFor(32);
    assert.equal(await pet.getAttribute('data-look'), null, 'Pointer over the actual face should rest the gaze');
    const images = new Set();
    for (let direction = 0; direction < 16; direction++) {
      const angle = direction * Math.PI / 8;
      await page.mouse.move(face.x + Math.sin(angle) * 210, face.y - Math.cos(angle) * 210);
      await page.clock.runFor(32);
      assert.equal(await pet.getAttribute('data-look'), String(direction));
      assert.equal(await sprite.getAttribute('data-row'), String(9 + Math.floor(direction / 8)));
      assert.equal(await sprite.getAttribute('data-frame'), String(direction % 8));
      images.add((await sprite.screenshot()).toString('base64'));
    }
    assert.equal(images.size, 16, 'All sixteen directions must produce different rendered pixels');
    const select = page.getByLabel('Animation clip', { exact: true });
    for (const clip of ['idle', 'running-right', 'running-left', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review']) {
      await select.selectOption(clip);
      const frames = new Set(); const pixels = new Set();
      // Idle holds for 2.6s before blinking; every other loop changes sooner.
      if (clip === 'idle') await page.clock.runFor(2600);
      for (let sample = 0; sample < 6; sample++) {
        frames.add(await sprite.getAttribute('data-frame'));
        pixels.add((await sprite.screenshot()).toString('base64'));
        await page.clock.runFor(95);
      }
      assert(frames.size > 1 && pixels.size > 1, `${clip}: expected real frame and pixel changes`);
    }
    await select.selectOption('jumping');
    await page.clock.runFor(900);
    assert.equal(await sprite.getAttribute('data-frame'), '4');
    await page.clock.runFor(700);
    assert.equal(await sprite.getAttribute('data-frame'), '4', 'One success must not loop');
    await page.getByRole('button', { name: 'Replay animation', exact: true }).click();
    assert.notEqual(await sprite.getAttribute('data-frame'), '4');
    await page.clock.runFor(150);
    const beforeHidden = await sprite.getAttribute('data-frame');
    await page.locator('.mascot-lab-live').evaluate(el => { el.style.display = 'none'; });
    await page.waitForTimeout(100);
    assert.equal(await pet.getAttribute('data-visible'), 'false');
    await page.clock.runFor(1000);
    assert.equal(await sprite.getAttribute('data-frame'), beforeHidden, 'Offscreen sampling must stop');
    await page.locator('.mascot-lab-live').evaluate(el => { el.style.display = ''; });
    await page.waitForTimeout(100);
    assert.equal(await sprite.getAttribute('data-frame'), '4', 'Returning must hold an expired landing, never replay it');
    await page.getByRole('button', { name: 'Reduced motion', exact: true }).click();
    assert.equal(await pet.getAttribute('data-reduced-motion'), 'true');
    assert.equal(await sprite.getAttribute('data-frame'), '4');
    const reducedPixels = await sprite.screenshot();
    await page.clock.runFor(500);
    assert(reducedPixels.equals(await sprite.screenshot()), 'Reduced motion must freeze actual pixels');

    // Validate actual decoded shipped bytes, rather than trusting a manifest.
    const atlas = await page.evaluate(async () => {
      const src = document.querySelector('.otto-atlas-loader').src;
      const image = new Image(); image.src = src; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      const counts = [6, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8]; const failures = [];
      for (let row = 0; row < 11; row++) for (let col = 0; col < 8; col++) {
        const pixels = ctx.getImageData(col * 192, row * 208, 192, 208).data;
        let used = 0; let edge = 0; let red = 0;
        for (let y = 0; y < 208; y++) for (let x = 0; x < 192; x++) {
          const i = (y * 192 + x) * 4;
          if (!pixels[i + 3]) continue;
          used++;
          if (x < 2 || x > 189 || y < 2 || y > 205) edge++;
          if (pixels[i] > 180 && pixels[i + 1] < 150 && pixels[i + 2] < 150) red++;
        }
        if (col >= counts[row] ? used !== 0 : used < 500 || edge !== 0) failures.push({ row, col, used, edge });
        if (row === 5 && col < counts[row] && red < 15) failures.push({ row, col, error: 'Failure lost its persistent red expression' });
      }
      return { width: image.width, height: image.height, failures };
    });
    assert.deepEqual(atlas, { width: 1536, height: 2288, failures: [] });
    await page.screenshot({ path: join(tmpdir(), 'otto-playback-lab.png'), fullPage: true });

    // A missing atlas must leave a real configured SVG visible.
    const fallback = await context.newPage();
    await fallback.route('**/otto-v2.webp', route => route.abort());
    await fallback.goto(base + '/?preview-mascot');
    await fallback.waitForFunction(() => !document.querySelector('.mascot-lab-live .otto-sprite'));
    await fallback.locator('.mascot-lab-live svg.studio-otto').waitFor();
    assert.equal(await fallback.locator('.mascot-lab-live .otto-sprite-frame').count(), 0);
    assert.equal(errors.length, 0, JSON.stringify(errors));
    console.log('OTTO_PLAYBACK_PASS ' + JSON.stringify({ directions: 16, movingClips: 9, oneShot: true, offscreen: true, reducedMotion: true, fallback: true, atlas, runtimeErrors: errors }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
