import { test, expect } from '@playwright/test';
import { createFixtures } from '../server/fixtures.js';

// ScaleManager::writeDailyJson(255) shape, copied from the harness fixture so a
// route can replace it when the test needs an empty history.
const RECORDS = [
  [20320, 1790000000, 16400, 0, 0, 0, 4120000, 19.5],
  [20320, 1790000000, 12400, 0, 0, 1, 3980000, 19.4],
  [20321, 1790086400, 15200, 1200, 0, 0, 4080000, 19.6],
  [20321, 1790086400, 11800, 600, 0, 1, 3960000, 19.6],
  [20322, 1790172800, 14000, 1200, 0, 0, 4040000, 19.7],
  [20322, 1790172800, 11200, 600, 4, 1, 3940000, 19.7],
];

// Weight (kg) and raw counts stay in the records and in the export, but they are
// not charted: raw counts only exist to fit the scale temperature correction in
// y2tlogviewer, and the weight line repeated the level line in different units.
const LABELS = [
  'Date',
  'Consumed (L)',
  'Pale Ale left (L)',
  'Scale 2 left (L)',
];

async function openScale(page) {
  await page.goto('/scale.htm');
  await page.waitForFunction(() => window.ScalePage && ScalePage.chart && ScalePage.chart.numRows() > 1);
}

test('chart shows the daily bars and one beer-left line per keg', async ({ page }) => {
  await openScale(page);

  expect(await page.evaluate(() => ScalePage.chart.getLabels())).toEqual(LABELS);

  // Nothing is plotted on a second axis any more.
  const axes = await page.evaluate(() => ({
    y2: ScalePage.chart.getOption('y2label'),
    labels: ScalePage.chart.getLabels(),
  }));
  expect(axes.y2).toBeFalsy();
  expect(axes.labels.join('|')).not.toContain('weight');
  expect(axes.labels.join('|')).not.toContain('raw');

  const values = await page.evaluate(() => ({
    left: ScalePage.chart.getValue(0, 2),
    consumed: ScalePage.chart.getValue(1, 1),
    secondKeg: ScalePage.chart.getValue(0, 3),
  }));
  expect(values.left).toBeCloseTo((16400 - 4000) / 1000 / 1.01, 3);
  // Scale 2 is unconfigured in the fixture, so its empty-keg mass is zero.
  expect(values.secondKeg).toBeCloseTo(12400 / 1000 / 1.01, 3);
  expect(values.consumed).toBeCloseTo(1.8 / 1.01, 3);
});

test('raw counts are still exported even though they are not charted', async ({ page }) => {
  await openScale(page);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#export-data-button').click(),
  ]);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  // The temperature-correction fit needs column 6, so it must survive.
  expect(payload.records[0][6]).toBe(4120000);
  expect(payload.records.slice(0, RECORDS.length).map((r) => r[6])).toEqual(RECORDS.map((r) => r[6]));
});

test('a legend click hides and restores its line', async ({ page }) => {
  await openScale(page);

  const item = page.locator('#scale-legend .scale-legend-item[data-series="1"]');
  await expect(item).toContainText('Pale Ale left (L)');
  await item.click();
  await expect(item).toHaveClass(/is-off/);
  expect(await page.evaluate(() => ScalePage.chart.visibility()[1])).toBe(false);

  await item.click();
  await expect(item).not.toHaveClass(/is-off/);
  expect(await page.evaluate(() => ScalePage.chart.visibility()[1])).toBe(true);
});

test('reset history posts resetHistory and empties the chart', async ({ page }) => {
  const posts = [];
  let cleared = false;
  await page.route(
    (url) => url.pathname === '/scale',
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === 'POST') {
        posts.push(JSON.parse(new URLSearchParams(request.postData()).get('data')));
        cleared = true;
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      } else if (url.searchParams.get('daily')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ retentionDays: 180, records: cleared ? [] : RECORDS }),
        });
      } else {
        await route.continue();
      }
    },
  );
  page.on('dialog', (dialog) => dialog.accept());

  await openScale(page);
  expect(await page.evaluate(() => ScalePage.chart.numRows())).toBe(3);

  await page.locator('#reset-history-button').click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toEqual({ action: 'resetHistory' });

  await expect.poll(() => page.evaluate(() => ScalePage.chart.numRows())).toBe(1);
  expect(await page.evaluate(() => ScalePage.chart.getValue(0, 1))).toBe(0);
});

test('export downloads the settings and the daily records', async ({ page }) => {
  await openScale(page);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#export-data-button').click(),
  ]);
  expect(download.suggestedFilename()).toBe('scale_daily.json');

  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  expect(payload.settings.scales).toHaveLength(2);
  // writeDailyJson(255) exports the daily records and the sample-session rows
  // (FlagSample = 32) in file order, so the export carries both.
  expect(payload.records).toEqual([...RECORDS, ...createFixtures().scaleSamples]);
  expect(typeof payload.exportedAt).toBe('string');
});
