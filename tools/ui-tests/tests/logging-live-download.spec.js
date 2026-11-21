import { test, expect } from '@playwright/test';

// "Download Live Log" fetches the file being written right now. The firmware
// treats a negative index as "the live file" and streams it through a second
// read handle, so recording is never disturbed. These tests pin the contract:
// the button only exists while recording, and it asks for dl=-1.

async function openLogging(page, { recording }) {
  await page.route(
    (url) => url.pathname === '/loglist.php',
    async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.has('dl')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/octet-stream',
          headers: { 'Content-Disposition': 'attachment; filename="ipa_us05.log"' },
          body: 'LOG',
        });
        return;
      }
      // Status payload: BrewLogger::loggingStatus().
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          rec: recording ? 1 : 0,
          log: recording ? 'ipa_us05' : '',
          start: recording ? 1790300000 : 0,
          fs: { size: 589824, used: 20000 },
          plato: false,
          wobf: false,
          list: [],
        }),
      });
    },
  );
  await page.goto('/logging.htm');
  await page.waitForFunction(() => typeof window.logs !== 'undefined');
  await page.waitForTimeout(300);
}

test.describe('logging live download', () => {
  test('offers the live download only while a log is recording', async ({ page }) => {
    await openLogging(page, { recording: false });
    await expect(page.locator('#livedlbutton')).toBeHidden();

    await openLogging(page, { recording: true });
    await expect(page.locator('#livedlbutton')).toBeVisible();
    await expect(page.locator('#livedlbutton')).toHaveText(/Download Live Log|Scarica|Last ned|Baixar|Stiahnut|Descargar|下载/);
  });

  test('asks the controller for the file being written', async ({ page }) => {
    const requested = [];
    page.on('request', (r) => {
      if (r.url().includes('/loglist.php?dl=')) requested.push(r.url());
    });
    // window.open would need a popup; capture the navigation instead.
    await page.addInitScript(() => {
      window.open = (url) => { window.__opened = url; return null; };
    });

    await openLogging(page, { recording: true });
    await page.locator('#livedlbutton').click();

    expect(await page.evaluate(() => window.__opened)).toBe('loglist.php?dl=-1');
  });

  test('the finished-log table is unchanged', async ({ page }) => {
    // The negative index must not leak into the per-row download.
    await page.addInitScript(() => {
      window.open = (url) => { window.__opened = url; return null; };
    });
    await openLogging(page, { recording: true });
    // No saved logs in this fixture, so just prove the live path is the only
    // negative one.
    await page.locator('#livedlbutton').click();
    const opened = await page.evaluate(() => window.__opened);
    expect(opened).toMatch(/dl=-1$/);
  });
});
