import { test, expect } from '@playwright/test';

const NAV_PAGES = [
  ['/control.htm', 'Control'],
  ['/logging.htm', 'Logging'],
  ['/setup.htm', 'Setup'],
  ['/scale.htm', 'Scale'],
  ['/config.htm', 'Settings'],
  ['/gravity.htm', 'Wireless Hydrometer'],
  ['/pressure.htm', 'Pressure'],
  ['/index.htm', 'Dashboard'],
];

async function resetJournal(request) {
  await request.post('/__requests/reset');
}

async function expectNoHardwareWrites(request) {
  const payload = await (await request.get('/__requests')).json();
  const forbidden = payload.requests.filter((entry) => entry.forbidden);
  expect(forbidden, 'forbidden hardware writes').toEqual([]);
}

async function setTheme(request, theme) {
  await request.post('/theme', {
    data: 'data=' + encodeURIComponent(JSON.stringify({ theme })),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
}

test('header navigation reaches every embedded page', async ({ page, request }) => {
  await resetJournal(request);
  await page.goto('/');

  for (const [href, landmark] of NAV_PAGES) {
    if (href === '/pressure.htm') {
      // The firmware hides this link until pressure is enabled in Settings.
      await page.evaluate(() => setPressureNav(true));
    }
    const link = page.locator(`header a[href="${href}"]`).first();
    await link.click();
    await page.waitForURL(`**${href}`);
    await expect(page.locator('body')).toContainText(landmark, { timeout: 10_000 });
  }

  await page.evaluate(() => setPressureNav(false));
  await expectNoHardwareWrites(request);
});

test('theme swatch persists through GET /theme on reload', async ({ page, request }) => {
  await resetJournal(request);
  await setTheme(request, '');
  await page.goto('/');

  await page.locator('.theme-swatch[data-theme-choice="lab"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'lab');
  await expect(page.locator('.theme-swatch[data-theme-choice="lab"]')).toHaveClass(
    /is-selected/,
  );

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'lab');

  await setTheme(request, '');
  await expectNoHardwareWrites(request);
});

test('control mode tabs and advanced fold open without saving', async ({ page, request }) => {
  await resetJournal(request);
  await page.goto('/control.htm');

  await page.locator('.seg[data-g="method"] button[data-v="ind"]').click();
  await expect(page.locator('#ind-panel')).toBeVisible();
  await expect(page.locator('#pid-panel')).toBeHidden();

  await page.locator('.seg[data-g="method"] button[data-v="pid"]').click();
  await expect(page.locator('#pid-panel')).toBeVisible();
  await expect(page.locator('#ind-panel')).toBeHidden();

  const fold = page.locator('details.ctrl-adv');
  await fold.locator('summary').click();
  await expect(fold).toHaveAttribute('open', '');
  await fold.locator('summary').click();
  await expect(fold).not.toHaveAttribute('open', '');

  await expectNoHardwareWrites(request);
});

test('scale selector switches the visible settings', async ({ page, request }) => {
  await resetJournal(request);
  await page.goto('/scale.htm');

  await expect(page.locator('#scale-select option')).toHaveCount(2);
  await page.locator('#scale-select').selectOption('1');
  await expect(page.locator('#scale-device-name')).toHaveText('Scale 2');
  await page.locator('#scale-select').selectOption('0');
  await expect(page.locator('#scale-device-name')).toHaveText('Keg scale 1');

  await expectNoHardwareWrites(request);
});

test('setup add-device picker opens and closes locally', async ({ page, request }) => {
  await resetJournal(request);
  await page.goto('/setup.htm');

  const picker = page.locator('#add-picker');
  await expect(picker).toBeHidden();
  await page.locator('#addbtn').click();
  await expect(picker).toBeVisible();
  await page.locator('#addbtn').click();
  await expect(picker).toBeHidden();

  await expectNoHardwareWrites(request);
});

test('pressure nav visibility is local UI state', async ({ page, request }) => {
  await resetJournal(request);
  await page.goto('/config.htm');

  // The radio pair also calls setPressureHardware(), which would POST /psi.
  // Test the local-only part instead so no transducer command is sent.
  await page.evaluate(() => setPressureNav(true));
  await expect(page.locator('body')).toHaveClass(/show-pressure/);
  expect(await page.evaluate(() => localStorage.getItem('yeast2tap-pressure-nav'))).toBe('1');

  await page.evaluate(() => setPressureNav(false));
  await expect(page.locator('body')).not.toHaveClass(/show-pressure/);

  await expectNoHardwareWrites(request);
});
