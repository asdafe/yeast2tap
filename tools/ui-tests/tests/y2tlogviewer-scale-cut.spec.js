import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const viewerUrl = 'file:///' + path.join(repoRoot, 'htmljs', 'dist', 'english', 'y2tlogviewer.htm').replace(/\\/g, '/');

// Cutting a stretch out of a session used to mean zooming, exporting a cropped
// file and loading it again. A cut can now be made in place: the range on screen
// is dropped from the fit and from a crop, and the chart shows it as a gap.
//
// The fixture is a clean drift (counts = 900000 - 4000 * T) with a five sample
// stretch bumped by +3000 counts, the sort of local disturbance that ruins a fit.

const SLOPE = -4000;
const BASE = 900000;
const BAD_FROM = 10;
const BAD_TO = 14;      // inclusive
const N = 30;
const STEP = 120;       // seconds between samples
const T0 = 1700000000;

function sampleTime(i) { return T0 + i * STEP; }

function exportFile() {
  const rows = [];
  for (let i = 0; i < N; i++) {
    const temp = 5 + i * 0.2;
    let counts = BASE + SLOPE * temp;
    if (i >= BAD_FROM && i <= BAD_TO) counts += 3000;
    rows.push([19000, sampleTime(i), 18000, 0, 32, 0, Math.round(counts), +temp.toFixed(1)]);
  }
  const file = path.join(repoRoot, 'tools', 'ui-tests', 'artifacts', `cut-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    exportedAt: 'x',
    settings: { scales: [{ id: 0, kegName: 'Keg A' }] },
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

/** Zoom to the bad stretch, the way a reader would drag the chart over it. */
async function zoomToBadStretch(page) {
  await page.evaluate(({ from, to, step, t0 }) => {
    ScaleView.chart.updateOptions({ dateWindow: [t0 * 1000 + from * step * 1000, t0 * 1000 + to * step * 1000] });
  }, { from: BAD_FROM - 0.5, to: BAD_TO + 0.5, step: STEP, t0: T0 });
}

test.describe('y2tlogviewer scale cut', () => {
  test('cutting the visible range drops it from the fit, in place', async ({ page }) => {
    await openExport(page);

    const before = await page.evaluate(() => ScaleView.fitData(0).length);
    expect(before).toBe(N);

    await zoomToBadStretch(page);
    await page.click('#scale_exclude');

    const after = await page.evaluate(() => ({
      points: ScaleView.fitData(0).length,
      cuts: ScaleView.excluded.length,
      hint: document.getElementById('scale-cut-hint').textContent,
      // The chart still has every timestamp; the cut ones are blank.
      rows: ScaleView.chart.numRows(),
      blanks: (function () {
        const g = ScaleView.chart;
        let n = 0;
        for (let r = 0; r < g.numRows(); r++) {
          const v = g.getValue(r, 2);
          if (v == null || isNaN(v)) n++;
        }
        return n;
      })(),
    }));

    expect(after.cuts).toBe(1);
    expect(after.points).toBe(N - (BAD_TO - BAD_FROM + 1));
    expect(after.rows).toBe(N);
    expect(after.blanks).toBe(BAD_TO - BAD_FROM + 1);
    expect(after.hint).toContain('left out of the fit');
  });

  test('the fit ignores the cut points and recovers the clean slope', async ({ page }) => {
    await openExport(page);

    // With the bump in, the fitted slope is pulled away from -4000 counts/°C.
    await page.click('.menu-button');
    await page.click('#menu-scale-tc');
    const rough = await page.evaluate(() => Math.abs(ScaleView.equation[1] - 4000));
    await page.click('#dock-panel button:has-text("Close")');

    await zoomToBadStretch(page);
    await page.click('#scale_exclude');

    await page.click('.menu-button');
    await page.click('#menu-scale-tc');
    const clean = await page.evaluate(() => Math.abs(ScaleView.equation[1] - 4000));

    expect(clean).toBeLessThan(1);
    expect(rough).toBeGreaterThan(clean);
  });

  test('a crop leaves the cut out of the saved file', async ({ page }) => {
    await openExport(page);
    await zoomToBadStretch(page);
    await page.click('#scale_exclude');

    const saved = await page.evaluate(() => JSON.parse(ScaleView.crop()).records);
    expect(saved.length).toBe(N - (BAD_TO - BAD_FROM + 1));
    // No saved row comes from the cut window.
    for (const r of saved) {
      expect(r[1] < sampleTime(BAD_FROM) || r[1] > sampleTime(BAD_TO)).toBe(true);
    }
  });

  test('clearing the cuts gives the whole session back', async ({ page }) => {
    await openExport(page);
    await zoomToBadStretch(page);
    await page.click('#scale_exclude');
    expect(await page.evaluate(() => ScaleView.fitData(0).length)).toBe(N - 5);

    await page.click('#scale_exclude_clear');
    const restored = await page.evaluate(() => ({
      points: ScaleView.fitData(0).length,
      hint: document.getElementById('scale-cut-hint').textContent,
    }));
    expect(restored.points).toBe(N);
    expect(restored.hint).toBe('');
  });

  test('a new export starts with no cuts', async ({ page }) => {
    await openExport(page);
    await zoomToBadStretch(page);
    await page.click('#scale_exclude');
    expect(await page.evaluate(() => ScaleView.excluded.length)).toBe(1);

    await page.setInputFiles('#fileinput', exportFile());
    await page.waitForFunction(() => typeof ScaleView !== 'undefined' && ScaleView.chart);
    expect(await page.evaluate(() => ScaleView.excluded.length)).toBe(0);
  });
});
