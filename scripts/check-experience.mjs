// Optional visual verification: npm install --no-save --package-lock=false playwright-core
// Start npm run dev first. Screenshots are saved in the root chatGPT folder.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const snapshot = JSON.parse(await readFile(new URL('../public/timetable-snapshot.json', import.meta.url), 'utf8'));
const selection = [...new Set(snapshot.timetable.filter((row) => row.Section === '3A').map((row) => `${row.Course} - ${row.Section}`))];
if (!selection.length) selection.push(...[...new Set(snapshot.timetable.map((row) => `${row.Course} - ${row.Section}`))].slice(0, 5));
const output = new URL('../../../chatGPT/screenshots/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
try {
  for (const [name, width, height, theme] of [['desktop', 1440, 1000, 'light'], ['mobile', 390, 844, 'light'], ['mobile-dark', 390, 844, 'dark'], ['small-mobile', 320, 740, 'light']]) {
    const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', reducedMotion: 'reduce' });
    await context.addInitScript(({ snapshot, selection, theme }) => {
      if (!localStorage.getItem('experienceTestSeeded')) {
        localStorage.setItem('cachedTimetableData', JSON.stringify({ data: snapshot, at: Date.now() }));
        localStorage.setItem('selectedClasses_main', JSON.stringify(selection));
        localStorage.setItem('theme', theme);
        localStorage.setItem('experienceTestSeeded', 'yes');
      }
    }, { snapshot, selection, theme });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    // Deterministic local snapshot test: live network and account services are separate concerns.
    await page.route('**/api/data', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Offline test"}' }));
    await page.route('**/api/auth-session', (route) => route.fulfill({ contentType: 'application/json', body: '{"user":null}' }));
    await page.goto('http://127.0.0.1:5173');
    await page.getByRole('heading', { name: 'My timetable', exact: true }).waitFor();
    assert.equal(await page.locator('#class-management').isVisible(), false);
    assert.equal(await page.locator('.schedule-overview').isVisible(), false);
    assert.equal(await page.getByRole('button', { name: width <= 640 ? 'Agenda' : 'Full Week', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: page overflows horizontally`);
    const scheduleTop = await page.locator(width <= 640 ? '.agenda-session' : '.tt-scroll').first().boundingBox();
    const warningTop = await page.locator('.schedule-warning').boundingBox();
    assert.ok(scheduleTop && warningTop && warningTop.y < scheduleTop.y, `${name}: warning precedes timetable`);
    await page.screenshot({ path: new URL(`${name}.png`, output).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true });
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    assert.equal(await page.locator('#class-management').isVisible(), true);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    assert.equal(await page.locator('#class-management').isVisible(), false);
    await page.getByRole('button', { name: 'Agenda', exact: true }).click();
    await page.locator('.agenda-session').first().waitFor();
    await page.locator('.agenda-search-panel > summary').click();
    const search = page.getByRole('searchbox');
    await search.fill('no-match-xyz');
    await page.getByText('No matching sessions', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Clear search', exact: true }).click();
    assert.ok(await page.locator('.agenda-session').count() > 0);
    await page.getByLabel('Filter agenda by day').selectOption('Monday');
    assert.ok(await page.locator('.agenda-group').count() <= 1);
    await page.getByLabel('Filter agenda by day').selectOption('all');
    await page.reload();
    await page.locator('.agenda-view').waitFor();
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('.agenda-view').isVisible(), false);
    assert.equal(await page.locator('[data-capture]').isVisible(), true);
    await page.emulateMedia({ media: 'screen' });
    if (name === 'desktop') {
      await page.getByTitle('Print your timetable as an image', { exact: true }).click();
      const downloadPromise = page.waitForEvent('download', { timeout: 45000 });
      await page.getByRole('menuitem', { name: /Download PNG/ }).click();
      const download = await downloadPromise;
      const file = new URL('agenda-export.png', output).pathname.replace(/^\/(\w:)/, '$1');
      await download.saveAs(file);
      const png = await readFile(file);
      assert.ok(png.readUInt32BE(16) >= 2960 && png.readUInt32BE(20) > 100, 'Export has a full-size grid');
      await page.getByRole('button', { name: 'Insights', exact: true }).click();
      await page.getByText('Average active day', { exact: true }).waitFor();
      await page.locator('.week-rhythm button').first().click();
      assert.equal(await page.getByRole('button', { name: 'Today', exact: true }).getAttribute('aria-pressed'), 'true');
    }
    await page.getByRole('button', { name: 'View other timetables', exact: true }).click();
    await page.getByRole('dialog', { name: 'Other timetables' }).waitFor();
    await page.getByRole('button', { name: 'My timetable', exact: true }).click();
    assert.equal(await page.locator('#class-management').isVisible(), false, 'Returning to own timetable restores compact layout');
    console.log(`${name}: layout, search, filters, saved view, and print passed`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log('Browser checks passed with no uncaught page errors.');
} finally { await browser.close(); }
