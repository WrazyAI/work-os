// Start the companion Vite dev server on 127.0.0.1:5173.
// Run with Playwright available on NODE_PATH; no live credentials required.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  context.setDefaultTimeout(12000);
  const errors = []; const writes = []; let checks = 0;
  await context.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.hostname !== '127.0.0.1' && !u.protocol.startsWith('data')) return route.abort();
    if (u.pathname.startsWith('/api/') && route.request().method() !== 'GET') writes.push(u.pathname);
    return route.continue();
  });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const main = await context.newPage(); const debug = await context.newPage();
  const avatar = await context.newPage(); const readiness = await context.newPage();
  const orb = await context.newPage(); const progress = await context.newPage();
  async function attr(page, selector, name, expected) {
    try { await page.waitForFunction(({ selector, name, expected }) => document.querySelector(selector)?.getAttribute(name) === expected, { selector, name, expected }, { timeout: 12000 }); }
    catch (e) { console.log('ATTR_FAILED', selector, name, expected, await page.locator(selector).first().evaluate(el => el.outerHTML.slice(0,900)).catch(() => 'missing')); throw e; }
    checks++;
  }
  const pet = '.dashboard-shell .mascot-pet';
  try {
    await orb.goto('http://127.0.0.1:5173/?preview-chat&isolate=orb&prompt');
    await orb.locator('.avatar-pet .studio-otto').waitFor();
    const orbFigure = await orb.locator('.avatar-pet .studio-otto').boundingBox();
    assert(orbFigure.width >= 116 && orbFigure.height >= 130, JSON.stringify(orbFigure)); checks++;
    assert.equal((await orb.locator('.avatar-day-time').innerText()).trim(), '3h 12m left'); checks++;
    const orbMotion = await orb.locator('.studio-rig').evaluate(el => {
      const style = getComputedStyle(el);
      return { name: style.animationName, timing: style.animationTimingFunction };
    });
    assert(orbMotion.name.includes('studio-attention-rig'), JSON.stringify(orbMotion)); checks++;
    assert(orbMotion.timing.includes('steps(5'), JSON.stringify(orbMotion)); checks++;
    // Exercise the deterministic token-free fixture that uses the live shift badge.
    await progress.goto('http://127.0.0.1:5173/?window=avatar&avatar-fixture=shift-progress');
    await progress.locator('.avatar-badge.avatar-badge-progress').waitFor();
    const shiftProgress = await progress.locator('.avatar-badge-progress').evaluate(el => ({
      value: getComputedStyle(el).getPropertyValue('--shift-progress').trim(),
      image: getComputedStyle(el).backgroundImage,
    }));
    assert(Math.abs(Number.parseFloat(shiftProgress.value) - 50) < 0.1, JSON.stringify(shiftProgress)); checks++;
    assert(shiftProgress.image.includes('conic-gradient'), JSON.stringify(shiftProgress)); checks++;
    assert.equal((await progress.locator('.avatar-day-time').innerText()).trim(), '1h 30m elapsed'); checks++;
    // Existing deterministic fixture renders the real OffShiftDashboard without
    // pretending the offline playground's Worktivity observation is off shift.
    await readiness.goto('http://127.0.0.1:5173/?preview-today&preview-state=pre-shift');
    await readiness.locator('.dashboard-otto .studio-otto').waitFor();
    assert.equal(await readiness.locator('.dashboard-readiness-art .otto').count(), 0); checks++;
    const size = await readiness.locator('.dashboard-otto .studio-otto').boundingBox();
    assert(size.width >= 108 && size.height >= 108); checks++;
    await main.goto('http://127.0.0.1:5173/?offline&day=optional');
    await main.locator('.dashboard-otto-active .studio-otto').waitFor();
    await debug.goto('http://127.0.0.1:5173/debug.html');
    await debug.getByLabel('Mascot activity', { exact: true }).waitFor();
    await debug.waitForFunction(() => document.querySelector('.debug-mascot-controls')?.disabled === false, null, { timeout: 12000 });
    await avatar.goto('http://127.0.0.1:5173/?window=avatar&avatar-fixture=recorded-completion');
    await avatar.getByRole('button', { name: 'Collapse companion', exact: true }).click();
    await avatar.locator('.avatar-pet .studio-otto').waitFor();
    for (const [activity, pose] of [['idle','focus'],['working','think'],['needs-input','alert'],['ready','celebrate'],['blocked','recover']]) {
      await debug.getByLabel('Mascot activity', { exact: true }).selectOption(activity);
      await attr(main, pet, 'data-activity', activity);
      await attr(avatar, '.avatar-pet', 'data-activity', activity);
      await attr(main, pet + ' .studio-otto', 'data-pose', pose);
      const color = await main.locator(pet + ' .studio-otto').evaluate(el => getComputedStyle(el).getPropertyValue('--studio-phosphor'));
      assert(color.trim()); checks++;
    }
    await debug.getByLabel('Mascot activity', { exact: true }).selectOption('');
    for (const [day, workday] of [['clocked_in','check-in-due'],['paused','paused'],['catch_up','check-in-due'],['optional','active'],['eod_due','eod-due'],['clocked_out','off-shift']]) {
      await debug.getByLabel('Shift state', { exact: true }).selectOption(day);
      await attr(main, pet, 'data-workday', workday);
      await attr(avatar, '.avatar-pet', 'data-workday', workday);
    }
    await debug.getByLabel('Shift state', { exact: true }).selectOption('optional');
    for (const workday of ['disconnected','off-shift','active','paused','late','check-in-due','eod-due']) {
      await debug.getByLabel('Mascot workday', { exact: true }).selectOption(workday);
      for (const activity of ['idle','working','needs-input','ready','blocked']) {
        await debug.getByLabel('Mascot activity', { exact: true }).selectOption(activity);
        await attr(main, pet, 'data-activity', activity);
        await attr(main, pet, 'data-workday', workday);
        await attr(avatar, '.avatar-pet', 'data-activity', activity);
      }
    }
    await debug.getByLabel('Mascot motion', { exact: true }).selectOption('reduced');
    await attr(main, pet, 'data-reduced-motion', 'true');
    await debug.getByLabel('Mascot activity', { exact: true }).selectOption('working');
    assert.equal(await main.locator(pet).evaluate(el => el.getAnimations({ subtree: true }).filter(a => a.playState === 'running').length), 0); checks++;
    await debug.getByRole('button', { name: 'All 35 combinations', exact: true }).click();
    assert.equal(await debug.locator('.mascot-lab-state-grid .mascot-pet').count(), 35); checks++;
    await debug.getByRole('button', { name: 'All 35 combinations', exact: true }).click();
    await debug.getByRole('button', { name: 'Stop and restore Auto', exact: true }).click();
    await debug.getByRole('button', { name: 'Interrupt work', exact: true }).click();
    await attr(main, pet, 'data-activity', 'working');
    await attr(main, pet, 'data-activity', 'needs-input');
    await debug.getByRole('button', { name: 'Failure and recovery', exact: true }).click();
    for (const activity of ['working','blocked','working','ready','idle']) await attr(main, pet, 'data-activity', activity);
    await debug.getByRole('button', { name: 'Work to completion', exact: true }).click();
    await debug.getByRole('button', { name: 'Stop and restore Auto', exact: true }).click();
    await main.waitForTimeout(3500);
    await attr(main, pet, 'data-activity', 'idle');
    await debug.getByRole('button', { name: 'Work to completion', exact: true }).click();
    await debug.getByRole('button', { name: /Mascot: Failed/ }).click();
    await main.waitForTimeout(3500);
    await attr(main, pet, 'data-activity', 'blocked');
    await debug.getByRole('button', { name: 'Work to completion', exact: true }).click();
    await debug.getByRole('switch', { name: 'Enable debug scenario', exact: true }).click();
    await main.waitForTimeout(3500);
    assert(await debug.getByLabel('Mascot activity', { exact: true }).isDisabled()); checks++;
    await debug.getByRole('button', { name: /Offline playground \(no backend\)/ }).click();
    await debug.getByLabel('Shift state', { exact: true }).selectOption('optional');
    await main.locator('.dashboard-otto-active').waitFor();
    for (const page of [main, readiness]) {
      for (const width of [1440, 1024, 720, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(100);
        const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
        assert(dimensions.scroll <= dimensions.width + 1, JSON.stringify(dimensions)); checks++;
      }
    }
    await orb.setViewportSize({ width: 360, height: 360 });
    await orb.screenshot({ path: '/tmp/otto-orb.png' });
    await readiness.setViewportSize({ width: 1000, height: 800 });
    await readiness.screenshot({ path: '/tmp/otto-dashboard.png' });
    await main.setViewportSize({ width: 1000, height: 800 });
    await main.screenshot({ path: '/tmp/otto-active.png' });
    await debug.setViewportSize({ width: 900, height: 1000 });
    await debug.locator('#mascot-debug-heading').scrollIntoViewIfNeeded();
    await debug.screenshot({ path: '/tmp/otto-debugger.png' });
    assert.equal(writes.length, 0, `Unexpected API writes: ${writes}`); checks++;
    assert.equal(errors.length, 0, `Runtime errors: ${errors}`); checks++;
    console.log('BROWSER_PASS ' + JSON.stringify({ checks, matrix: 35, widths: [1440,1024,720,390], apiWrites: writes.length, runtimeErrors: errors }));
  } catch (error) {
    console.log('BROWSER_FAILURE', error.stack);
    console.log('RUNTIME_ERRORS', JSON.stringify(errors));
    console.log('MAIN_BODY', (await main.locator('body').innerText()).slice(0, 1800));
    console.log('AVATAR_BODY', (await avatar.locator('body').innerText()).slice(0, 1800));
    console.log('DEBUG_BODY', (await debug.locator('body').innerText()).slice(-3000));
    process.exitCode = 1;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
