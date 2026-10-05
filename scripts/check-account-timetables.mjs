import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const snapshot = JSON.parse(await readFile(new URL('../public/timetable-snapshot.json', import.meta.url), 'utf8'));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const emptyProfile = { selectedClasses: [], overrides: [], extraClasses: [], activities: [], linkedSync: null };
let accountData = {
  profiles: Object.fromEntries(['main', ...Array.from({ length: 10 }, (_, i) => i + 1)].map((id) => [id, emptyProfile])),
  activeProfile: 'main', theme: 'light', customActivityTypes: [], notificationsEnabled: true, calendarFeedId: null,
}; // A real account created before profile names were synced.

const waitUntil = async (predicate, description) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${description}`);
};

const newDevice = async (initialNames) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await context.addInitScript(({ snapshot, initialNames }) => {
    localStorage.setItem('cachedTimetableData', JSON.stringify({ data: snapshot, at: Date.now() }));
    if (initialNames) localStorage.setItem('timetableProfileNames', JSON.stringify(initialNames));
  }, { snapshot, initialNames });
  await context.route('**/api/data', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await context.route('**/api/auth-session', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ user: { email: 'student@example.com', name: 'Student' }, data: accountData }),
  }));
  await context.route('**/api/sync', (route) => {
    accountData = route.request().postDataJSON().data;
    return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5173/');
  await page.getByRole('heading', { name: 'My timetable', exact: true }).waitFor();
  return { context, page };
};

try {
  const mobile = await newDevice({ 2: 'Ali' });
  await waitUntil(() => accountData.profileNames?.[2] === 'Ali', 'legacy mobile name migration');
  const pc = await newDevice(null);
  await pc.page.getByRole('button', { name: 'View other timetables' }).click();
  await pc.page.getByRole('button', { name: 'Ali', exact: true }).waitFor();
  await pc.page.keyboard.press('Escape');

  await mobile.page.getByRole('button', { name: 'View other timetables' }).click();
  await mobile.page.getByRole('button', { name: 'Rename Ali' }).click();
  await mobile.page.getByRole('textbox', { name: 'Timetable name' }).fill('Ali updated');
  await mobile.page.getByRole('button', { name: 'Save name' }).click();
  await waitUntil(() => accountData.profileNames?.[2] === 'Ali updated', 'mobile rename sync');
  await pc.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await pc.page.getByRole('button', { name: 'View other timetables' }).click();
  await pc.page.getByRole('button', { name: 'Ali updated', exact: true }).waitFor();
  await pc.page.keyboard.press('Escape');

  await mobile.page.getByRole('button', { name: 'Delete Ali updated' }).click();
  await mobile.page.getByRole('button', { name: 'Confirm delete timetable' }).click();
  await waitUntil(() => !accountData.profileNames?.[2], 'mobile deletion sync');
  await pc.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await pc.page.getByRole('button', { name: 'View other timetables' }).click();
  await pc.page.getByRole('button', { name: 'Ali updated', exact: true }).waitFor({ state: 'detached' });
  assert.equal(await pc.page.locator('.other-profile').count(), 1);

  await mobile.page.getByRole('button', { name: 'Add another timetable' }).click();
  await mobile.page.getByRole('textbox', { name: 'Timetable name' }).fill('Zara');
  await mobile.page.getByRole('button', { name: 'Create timetable' }).click();
  await waitUntil(() => Object.values(accountData.profileNames || {}).includes('Zara'), 'new mobile timetable sync');
  const zaraId = Number(Object.entries(accountData.profileNames).find(([, name]) => name === 'Zara')[0]);
  const instructor = snapshot.timetable[0].Instructor;
  await mobile.page.getByRole('tab', { name: 'Teacher', exact: true }).click();
  await mobile.page.getByRole('combobox', { name: 'Search instructors' }).fill(instructor);
  await mobile.page.locator('.option-row-sync').filter({ hasText: instructor }).first().click();
  await waitUntil(() => accountData.profiles[zaraId]?.selectedClasses.length > 0, 'mobile classes sync');
  await pc.page.keyboard.press('Escape');
  await pc.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await pc.page.waitForFunction(() => Object.values(JSON.parse(localStorage.getItem('timetableProfileNames') || '{}')).includes('Zara'));
  await pc.page.waitForFunction((id) => {
    const key = id === 1 ? 'selectedClasses' : `selectedClasses_${id}`;
    return JSON.parse(localStorage.getItem(key) || '[]').length > 0;
  }, zaraId);
  await pc.page.getByRole('button', { name: 'View other timetables' }).click();
  await pc.page.getByRole('button', { name: 'Zara', exact: true }).waitFor();
  await mobile.context.close();
  await pc.context.close();
  console.log('Passed: old account migrates names; rename, delete, and new timetable with classes sync from mobile to PC on focus.');
} finally {
  await browser.close();
}
