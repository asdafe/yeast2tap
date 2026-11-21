import { test, expect } from '@playwright/test';
import { createFixtures } from '../server/fixtures.js';

// Scale page: the sampling session controls, the temperature correction box and
// the sample-record filter in the history chart. POST bodies are captured with
// page.route because the mock server runs in its own webServer process (the
// pattern from scale-chart.spec.js), not through globalThis.__scalePosts.

async function openScale(page) {
  await page.goto('/scale.htm');
  await page.waitForFunction(() => window.ScalePage && ScalePage.chart && ScalePage.chart.numRows() > 1);
}

async function captureScalePosts(page) {
  const posts = [];
  await page.route(
    (url) => url.pathname === '/scale',
    async (route) => {
      const request = route.request();
      if (request.method() === 'POST') {
        posts.push(JSON.parse(new URLSearchParams(request.postData()).get('data')));
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      } else {
        await route.continue();
      }
    },
  );
  return posts;
}

test('sampling controls save interval and hours', async ({ page }) => {
  const posts = await captureScalePosts(page);
  page.on('dialog', (dialog) => dialog.accept());
  await openScale(page);

  await page.fill('#sample-minutes', '5');
  await page.fill('#sample-hours', '12');
  await page.click('#save-daily');

  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].action).toBe('settings');
  expect(posts[0].sampleMinutes).toBe(5);
  expect(posts[0].sampleHours).toBe(12);
  // The daily card keeps saving its own two values exactly as before.
  expect(posts[0].retentionDays).toBe(180);
  expect(posts[0].dailyMinute).toBe(60);
});

test('start and stop post sample actions', async ({ page }) => {
  const posts = await captureScalePosts(page);
  const dialogs = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    dialog.accept();
  });
  await openScale(page);

  await page.fill('#sample-minutes', '5');
  await page.fill('#sample-hours', '12');
  await page.click('#sample-start');

  // The boxes are saved first and the session starts only after that save.
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[0].action).toBe('settings');
  expect(posts[0].sampleMinutes).toBe(5);
  expect(posts[0].sampleHours).toBe(12);
  expect(posts[1]).toEqual({ action: 'sampleStart' });
  expect(dialogs[0]).toContain('previous session');

  await page.click('#sample-stop');
  await expect.poll(() => posts.length).toBe(3);
  expect(posts[2]).toEqual({ action: 'sampleStop' });
});

test('sampling status shows the remaining time', async ({ page }) => {
  const status = createFixtures().scale;
  status.sampleActive = true;
  status.sampleRemainingSec = 2820;
  // Silence the mock's websocket push: it carries sampleActive:false and would
  // overwrite the status text about a second after load.
  await page.routeWebSocket(/\/ws$/, () => {});
  await page.route(
    (url) => url.pathname === '/scale',
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === 'POST') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      } else if (!url.searchParams.get('daily')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(status) });
      } else {
        await route.continue();
      }
    },
  );

  await openScale(page);
  await expect(page.locator('#sample-state')).toHaveText('Sampling, 47 min left');
});

test('a pasted formula is saved as four coefficients', async ({ page }) => {
  const posts = await captureScalePosts(page);
  page.on('dialog', (dialog) => dialog.accept());
  await openScale(page);

  await page.fill('#correction-formula', '-412.5 +3.75 t -0.0625 t^2');
  await page.click('#save-correction');

  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].action).toBe('settings');
  expect(posts[0].scales[0].tempCorrection).toEqual([-412.5, 3.75, -0.0625, 0]);
});

test('an invalid formula saves nothing', async ({ page }) => {
  const posts = await captureScalePosts(page);
  await openScale(page);

  for (const text of ['1,5 t', '1e-3 t^2', 't^4', '+', '2000000 t', '', '3 t + junk']) {
    await page.fill('#correction-formula', text);
    await page.click('#save-correction');
    await expect(page.locator('#correction-state')).toHaveClass(/is-error/);
    await expect(page.locator('#correction-state')).toContainText('Enter a formula such as');
  }
  expect(posts).toHaveLength(0);
});

test('the parser accepts every shape the log viewer can copy', async ({ page }) => {
  await openScale(page);

  const parsed = await page.evaluate(() => {
    const cases = ['-0.5', 't', '1 t^3', '  3  ', '-412.5 +3.75 t -0.0625 t^2', '78000 -4000 t'];
    return cases.map((text) => ScalePage.parseCorrection(text));
  });

  expect(parsed).toEqual([
    [-0.5, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 0, 1],
    [3, 0, 0, 0],
    [-412.5, 3.75, -0.0625, 0],
    [78000, -4000, 0, 0],
  ]);
});

test('history ignores sample records', async ({ page }) => {
  await openScale(page);

  // The fixture holds 12 FlagSample rows on the last day; the chart keeps one
  // row per day built from the daily records, not from the samples.
  expect(await page.evaluate(() => ScalePage.chart.numRows())).toBe(3);
  const last = await page.evaluate(() => ({
    level: ScalePage.chart.getValue(2, 2),
    consumed: ScalePage.chart.getValue(2, 1),
  }));
  expect(last.level).toBeCloseTo((14000 - 4000) / 1000 / 1.01, 3);
  expect(last.consumed).toBeCloseTo((1200 + 600) / 1000 / 1.01, 3);
});
