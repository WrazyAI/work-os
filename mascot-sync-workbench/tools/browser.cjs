const { chromium } = require('/tmp/otto-browser/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const errors = []; const writes = []; let checks = 0;
  await context.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.hostname !== '127.0.0.1' && !u.protocol.startsWith('data')) return route.abort();
    if (u.pathname.startsWith('/api/') && route.request().method() !== 'GET') writes.push(u.pathname);
    return route.continue();
  });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const main = await context.newPage();
  const debug = await context.newPage();
  const avatar = await context.newPage();
  async function attr(page, selector, name, expected) {
    await page.waitForFunction(({ selector, name, expected }) => document.querySelector(selector)?.getAttribute(name) === expected, { selector, name, expected });
    checks++;
  }
  try {
    await main.goto('http://127.0.0.1:5173/?offline&day=scheduled');
    await main.locator('.dashboard-otto .studio-otto').waitFor();
    assert.equal(await main.locator('.dashboard-readiness-art .otto').count(), 0); checks++;
    const size = await main.locator('.dashboard-otto .studio-otto').boundingBox();
    assert(size.width >= 108 && size.height >= 108); checks++;
    await debug.goto('http://127.0.0.1:5173/debug.html');
    await debug.getByLabel('Mascot activity', { exact: true }).waitFor();
    await debug.waitForFunction(() => !document.querySelector('.debug-mascot-controls')?.disabled);
    await avatar.goto('http://127.0.0.1:5173/?window=avatar&avatar-fixture=recorded-completion');
    const minimize = avatar.getByRole('button', { name: 'Minimize to orb', exact: true });
    if (await minimize.count()) await minimize.click();
    await avatar.locator('.avatar-pet .studio-otto').waitFor();
    for (const [activity, pose, palette] of [['idle','sleep','neutral'],['working','think','working'],['needs-input','alert','working'],['ready','celebrate','success'],['blocked','recover','danger']]) {
      await debug.getByLabel('Mascot activity', { exact: true }).selectOption(activity);
      await attr(main, '.dashboard-otto', 'data-activity', activity);
      await attr(avatar, '.avatar-pet', 'data-activity', activity);
      await attr(main, '.dashboard-otto .studio-otto', 'data-pose', pose);
      // Palette names are checked by renderer tests; browser checks verify color differs.
      const color = await main.locator('.dashboard-otto .studio-otto').evaluate(el => getComputedStyle(el).getPropertyValue('--studio-phosphor'));
      assert(color.trim()); checks++;
    }
    await debug.getByLabel('Mascot activity', { exact: true }).selectOption('');
    for (const [day, workday] of [['clocked_in','active'],['paused','paused'],['catch_up','check-in-due'],['optional','active'],['eod_due','eod-due'],['clocked_out','off-shift']]) {
      await debug.getByLabel('Shift state', { exact: true }).selectOption(day);
      await attr(main, '.dashboard-shell .mascot-pet', 'data-workday', workday);
      await attr(avatar, '.avatar-pet', 'data-workday', workday);
    }
    await debug.getByLabel('Shift state', { exact: true }).selectOption('clocked_in');
    await main.locator('.dashboard-otto-active .studio-otto').waitFor(); checks++;
    for (const workday of ['disconnected','off-shift','active','paused','late','check-in-due','eod-due']) {
      await debug.getByLabel('Mascot workday', { exact: true }).selectOption(workday);
      for (const activity of ['idle','working','needs-input','ready','blocked']) {
        await debug.getByLabel('Mascot activity', { exact: true }).selectOption(activity);
        await attr(main, '.dashboard-otto-active', 'data-activity', activity);
        await attr(main, '.dashboard-otto-active', 'data-workday', workday);
        await attr(avatar, '.avatar-pet', 'data-activity', activity);
      }
    }
    await debug.getByLabel('Mascot motion', { exact: true }).selectOption('reduced');
    await attr(main, '.dashboard-otto-active', 'data-reduced-motion', 'true');
    await debug.getByLabel('Mascot activity', { exact: true }).selectOption('working');
    assert.equal(await main.locator('.dashboard-otto-active').evaluate(el => el.getAnimations({ subtree: true }).filter(a => a.playState === 'running').length), 0); checks++;
    await debug.getByRole('button', { name: 'All 35 combinations', exact: true }).click();
    assert.equal(await debug.locator('.mascot-lab-state-grid .mascot-pet').count(), 35); checks++;
    await debug.getByRole('button', { name: 'All 35 combinations', exact: true }).click();
    await debug.getByRole('button', { name: 'Stop and restore Auto', exact: true }).click();
    await debug.getByRole('button', { name: 'Interrupt work', exact: true }).click();
    await attr(main, '.dashboard-otto-active', 'data-activity', 'working');
    await attr(main, '.dashboard-otto-active', 'data-activity', 'needs-input');
    await debug.getByRole('button', { name: 'Failure and recovery', exact: true }).click();
    for (const activity of ['working','blocked','working','ready','idle']) await attr(main, '.dashboard-otto-active', 'data-activity', activity);
    await debug.getByRole('button', { name: 'Work to completion', exact: true }).click();
    await debug.getByRole('button', { name: 'Stop and restore Auto', exact: true }).click();
    await main.waitForTimeout(3600);
    await attr(main, '.dashboard-otto-active', 'data-activity', 'idle');
    await debug.getByRole('button', { name: 'Work to completion', exact: true }).click();
    await debug.getByRole('switch', { name: 'Enable debug scenario', exact: true }).click();
    await main.waitForTimeout(3500);
    assert(await debug.locator('.debug-mascot-controls').isDisabled()); checks++;
    // Restart an offline fixture, not live sign-in, before layout checks.
    await debug.getByRole('button', { name: /Offline playground \(no backend\)/ }).click();
    await main.locator('.dashboard-otto-active').waitFor();
    for (const width of [1440, 1024, 720, 390]) {
      await main.setViewportSize({ width, height: 900 });
      await main.waitForTimeout(100);
      assert(await main.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); checks++;
    }
    await main.setViewportSize({ width: 1000, height: 800 });
    await debug.getByLabel('Shift state', { exact: true }).selectOption('scheduled');
    await main.locator('.dashboard-otto').waitFor();
    await main.screenshot({ path: '/tmp/otto-dashboard.png' });
    await debug.setViewportSize({ width: 900, height: 1000 });
    await debug.locator('#mascot-debug-heading').scrollIntoViewIfNeeded();
    await debug.screenshot({ path: '/tmp/otto-debugger.png' });
    assert.equal(writes.length, 0, `Unexpected API writes: ${writes}`); checks++;
    assert.equal(errors.length, 0, `Runtime errors: ${errors}`); checks++;
    console.log('BROWSER_PASS ' + JSON.stringify({ checks, matrix: 35, widths: [1440,1024,720,390], apiWrites: writes.length, runtimeErrors: errors }));
  } catch (error) {
    console.log('BROWSER_FAILURE', error.stack);
    console.log('RUNTIME_ERRORS', JSON.stringify(errors));
    console.log('MAIN_BODY', (await main.locator('body').innerText()).slice(0, 2000));
    console.log('DEBUG_BODY', (await debug.locator('body').innerText()).slice(-3000));
    process.exitCode = 1;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
