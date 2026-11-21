import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const viewerUrl = 'file:///' + path.join(repoRoot, 'htmljs', 'dist', 'english', 'y2tlogviewer.htm').replace(/\\/g, '/');

// A scale export can hold several kegs. The chart draws one keg's raw counts at a
// time, chosen from a selector visible before the correction dialog is opened.
// The keg level is not charted here: it is on the Scale page.

const DAY = 86400;
const T0 = 1700000000;

function exportFile() {
  const rows = [];
  for (let i = 0; i < 6; i++) {
    // Keg 0 counts sit at 900000, keg 1 at 950000; temperature drifts the same way.
    rows.push([19000 + i, T0 + i * DAY, 18000 - 500 * i, 0, 32, 0, 900000 - 4000 * (5 + i), 5 + i]);
    rows.push([19000 + i, T0 + i * DAY, 12000, 0, 32, 1, 950000 - 4000 * (5 + i), 5 + i]);
  }
  const file = path.join(repoRoot, 'tools', 'ui-tests', 'artifacts', `kegsel-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    exportedAt: 'x',
    settings: { scales: [{ id: 0, kegName: 'Keg A' }, { id: 1, kegName: 'Keg B' }] },
    records: rows,
  }));
  return file;
}

async function openExport(page) {
  await page.goto(viewerUrl);
  await page.waitForFunction(() => typeof window.BChart !== 'undefined');
  await page.setInputFiles('#fileinput', exportFile());
  await page.waitForFunction(() => typeof ScaleView !== 'undefined' && ScaleView.chart);
}

function rawSeries(page) {
  return page.evaluate(() => {
    const g = ScaleView.chart;
    const col = g.getLabels().indexOf('Raw counts');
    const out = [];
    for (let r = 0; r < g.numRows(); r++) out.push(g.getValue(r, col));
    return out;
  });
}

test.describe('y2tlogviewer keg selector', () => {
  test('lists every keg on the first screen, without opening the dialog', async ({ page }) => {
    await openExport(page);

    const bar = page.locator('#scale-keg-bar');
    await expect(bar).toBeVisible();
    const options = await page.evaluate(() => Array.from(document.querySelectorAll('#scale_keg_select option')).map((o) => o.textContent));
    expect(options).toEqual(['Keg A', 'Keg B']);
    // Nothing modal is open yet.
    await expect(page.locator('#scale-tc-dialog')).toBeHidden();
  });

  test('charts the selected keg raw counts', async ({ page }) => {
    await openExport(page);

    // Default selection is the first keg, whose counts start at 880000 (5 °C).
    const raw = (await rawSeries(page)).filter((v) => v != null && !isNaN(v));
    expect(raw[0]).toBeCloseTo(880000, 0);

    // Counts are in the hundreds of thousands; anything else means the wrong
    // column is being read.
    for (const v of raw) expect(Math.abs(v)).toBeGreaterThan(100000);
  });

  test('switching keg redraws the counts for that keg only', async ({ page }) => {
    await openExport(page);
    await page.selectOption('#scale_keg_select', '1');

    const raw = (await rawSeries(page)).filter((v) => v != null && !isNaN(v));
    expect(raw.length).toBeGreaterThan(0);
    // Keg B counts sit 50000 above keg A's at every temperature: 930000 at 5 °C
    // down to 910000 at 10 °C.
    expect(raw[0]).toBeCloseTo(930000, 0);
    for (const v of raw) expect(v).toBeGreaterThan(905000);
    for (const v of raw) expect(v).toBeLessThan(935000);

    // The dialog selector follows, so correction and chart never disagree.
    expect(await page.evaluate(() => document.getElementById('scale_tc_keg').value)).toBe('1');
  });

  test('the selector disappears with the scale view', async ({ page }) => {
    await openExport(page);
    await page.evaluate(() => ScaleView.close());
    await expect(page.locator('#scale-keg-bar')).toBeHidden();
    expect(await page.evaluate(() => document.querySelectorAll('#scale_keg_select option').length)).toBe(0);
  });
});
