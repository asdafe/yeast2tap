import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { header, periodRecord, sessionSummary, TAG } from './helpers/logfile.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const viewerPath = path.join(repoRoot, 'htmljs', 'dist', 'english', 'y2tlogviewer.htm');
const viewerUrl = 'file:///' + viewerPath.replace(/\\/g, '/');

// y2tlogviewer is the log viewer with the dashboard skin and one new
// record: the session summary written when a log is stopped (notes + keg
// levels). These tests cover the summary and the "old file" case, where a log
// written by an older viewer or a cropped/foreign file has no block at all.

const SUMMARY = {
  t: 1700003600,
  note: 'Dry hopped on day 4.',
  kegs: [
    { id: 0, name: 'Keg A', pct: 62, l: 11.8 },
    { id: 1, name: 'Keg B', pct: null, l: null },
  ],
};

function buildLog({ withSummary = true } = {}) {
  const data = [];
  data.push(...header({ startTime: 1700000000 }));
  data.push(TAG.mode, 'B'.charCodeAt(0));
  data.push(TAG.state, 3);
  for (let i = 0; i < 6; i++) {
    data.push(...periodRecord({ beerSet: 18.6, beerTemp: 19 + i / 10, fridgeTemp: 18.5, gravity: 1.06 - i / 1000 }));
  }
  if (withSummary) data.push(...sessionSummary(SUMMARY));
  return new Uint8Array(data);
}

async function openWithLog(page, bytes) {
  const file = path.join(repoRoot, 'tools', 'ui-tests', 'artifacts', `y2t-${Date.now()}.log`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(bytes));
  await page.goto(viewerUrl);
  await page.waitForFunction(() => typeof window.BChart !== 'undefined' && window.BChart.chart);
  await page.setInputFiles('#fileinput', file);
  await page.waitForTimeout(800);
}

test.describe('y2tlogviewer session summary', () => {
  test('shows the note and the keg levels written at stop', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openWithLog(page, buildLog());

    await expect(page.locator('#session-summary')).toBeVisible();
    await expect(page.locator('#session-note')).toHaveText('Dry hopped on day 4.');
    const rows = page.locator('#session-kegs tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('Keg A');
    await expect(rows.nth(0)).toContainText('62 %');
    await expect(rows.nth(0)).toContainText('11.8 L');
    // A keg with no usable reading keeps a dash instead of a fake zero.
    await expect(rows.nth(1)).toContainText('Keg B');
    await expect(rows.nth(1)).toContainText('--');
    expect(errors).toEqual([]);
  });

  test('a log without the block shows no summary and still charts', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openWithLog(page, buildLog({ withSummary: false }));

    await expect(page.locator('#session-summary')).toBeHidden();
    // The chart itself is unaffected: the loader still produced data rows.
    const rows = await page.evaluate(() => window.BChart.chart.data.length);
    expect(rows).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test('the summary block does not shift the chart data', async ({ page }) => {
    await openWithLog(page, buildLog());
    const withSummary = await page.evaluate(() => BChart.chart.data.map((r) => [r[0].getTime(), r[2]]));
    await openWithLog(page, buildLog({ withSummary: false }));
    const without = await page.evaluate(() => BChart.chart.data.map((r) => [r[0].getTime(), r[2]]));
    expect(withSummary).toEqual(without);
  });
});
