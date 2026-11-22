import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const viewerUrl = 'file:///' + path.join(repoRoot, 'htmljs', 'dist', 'english', 'y2tlogviewer.htm').replace(/\\/g, '/');

// A history export can cover weeks while a sampling session lasts hours. On the
// full range the session is a couple of pixels wide, which reads as "the export
// has two or three points". The chart opens zoomed to the session instead, and a
// double click returns to the whole history.

const DAY = 86400;

/** 10 daily rows over 10 days, then a 2 hour session every 5 minutes on day 10. */
function exportFile() {
  const rows = [];
  const t0 = 1790000000;
  for (let d = 0; d < 10; d++) {
    for (const keg of [0, 1]) {
      rows.push([20320 + d, t0 + d * DAY, 18000 - 100 * d, 100, 0, keg, 900000 + 40 * d, 5 + d * 0.1]);
    }
  }
  const sessionStart = t0 + 10 * DAY;
  for (let i = 0; i < 25; i++) {
    for (const keg of [0, 1]) {
      const temp = 3 + 2 * Math.sin(i / 4);
      rows.push([20330, sessionStart + i * 300, 17000, 0, 32, keg,
        Math.round(900000 + (keg ? 40000 : 0) - 600 * (temp - 3)), temp]);
    }
  }
  const file = path.join(repoRoot, 'tools', 'ui-tests', 'artifacts', `zoom-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    exportedAt: 'x',
    settings: { scales: [{ id: 0, kegName: 'A' }, { id: 1, kegName: 'B' }] },
    records: rows,
  }));
  return { file, sessionStart };
}

test.describe('y2tlogviewer scale window', () => {
  test('opens zoomed to the sampling session, not the whole history', async ({ page }) => {
    const { file, sessionStart } = exportFile();
    await page.goto(viewerUrl);
    await page.waitForFunction(() => typeof window.BChart !== 'undefined');
    await page.setInputFiles('#fileinput', file);
    await page.waitForFunction(() => typeof ScaleView !== 'undefined' && ScaleView.chart);

    const view = await page.evaluate(() => {
      const g = ScaleView.chart;
      return {
        range: g.xAxisRange(),
        rows: g.numRows(),
        inView: ScaleView.rowsInRange().length,
        hint: (document.getElementById('scale-window-hint') || {}).textContent,
      };
    });

    const sessionEnd = (sessionStart + 24 * 300) * 1000;
    // The window covers the session (plus the pad), not the 10 day history.
    expect(view.range[0]).toBeLessThanOrEqual(sessionStart * 1000);
    expect(view.range[1]).toBeGreaterThanOrEqual(sessionEnd);
    expect(view.range[1] - view.range[0]).toBeLessThan(6 * 3600 * 1000);
    // One point per timestamp: 10 daily records plus the 25 session samples.
    // The export holds two rows per timestamp (one per keg); the chart pivots
    // them onto the selected keg, so it no longer doubles the row count.
    expect(view.rows).toBe(35);
    expect(view.inView).toBe(50);          // 25 samples x 2 kegs, raw rows in range
    expect(view.hint).toContain('sampling session');
  });

  test('double click returns to the sampling session, not the whole history', async ({ page }) => {
    const { file, sessionStart } = exportFile();
    await page.goto(viewerUrl);
    await page.waitForFunction(() => typeof window.BChart !== 'undefined');
    await page.setInputFiles('#fileinput', file);
    await page.waitForFunction(() => typeof ScaleView !== 'undefined' && ScaleView.chart);

    // Zoom somewhere, then double-click the chart the way a reader would.
    await page.evaluate(() => {
      const t = ScaleView.rows.map((r) => r[1] * 1000).sort((a, b) => a - b);
      ScaleView.chart.updateOptions({ dateWindow: [t[5], t[15]] });
    });
    await page.locator('#div_scale').dblclick();
    await page.waitForTimeout(200);

    const after = await page.evaluate(() => ScaleView.chart.xAxisRange());
    const sessionMs = sessionStart * 1000;
    // Back on the session, not on ten days of daily records.
    expect(after[1] - after[0]).toBeLessThan(6 * 3600 * 1000);
    expect(after[0]).toBeLessThanOrEqual(sessionMs);
    expect(after[1]).toBeGreaterThan(sessionMs + 24 * 300 * 1000);
  });

  test('applying a formula keeps the window', async ({ page }) => {
    const { file } = exportFile();
    await page.goto(viewerUrl);
    await page.waitForFunction(() => typeof window.BChart !== 'undefined');
    await page.setInputFiles('#fileinput', file);
    await page.waitForFunction(() => typeof ScaleView !== 'undefined' && ScaleView.chart);

    const before = await page.evaluate(() => ScaleView.chart.xAxisRange());
    await page.click('.menu-button');
    await page.click('#menu-scale-tc');
    await page.evaluate(() => applyScaleCorrection());
    const after = await page.evaluate(() => ({
      range: ScaleView.chart.xAxisRange(),
      corrected: ScaleView.chart.numRows(),
      hasCorrected: ScaleView.chart.getLabels().includes('Corrected counts'),
    }));

    expect(after.range[0]).toBeCloseTo(before[0], -4);
    expect(after.range[1]).toBeCloseTo(before[1], -4);
    expect(after.hasCorrected).toBe(true);
    const values = await page.evaluate(() => {
      const g = ScaleView.chart;
      const out = [];
      for (let r = 0; r < g.numRows(); r++) out.push(g.getValue(r, 3));
      return out;
    });
    expect(values.filter((v) => v != null && !isNaN(v)).length).toBeGreaterThan(0);
  });
});
