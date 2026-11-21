import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { header, periodRecord, TAG } from './helpers/logfile.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const viewerUrl = 'file:///' + path.join(repoRoot, 'htmljs', 'dist', 'english', 'y2tlogviewer.htm').replace(/\\/g, '/');
const T0 = 1700000000;

function logBytes() {
  const data = [];
  data.push(...header({ startTime: T0, interval: 60 }));
  data.push(TAG.mode, 'C'.charCodeAt(0));
  data.push(TAG.state, 1);
  for (let i = 0; i < 90; i++) {
    const temp = 18 + Math.sin(i / 8) * 3;
    data.push(...periodRecord({
      beerSet: 20, beerTemp: temp, fridgeTemp: 5, fridgeSet: 5,
      roomTemp: 22, auxTemp: temp, gravity: 1.05 + 0.004 * (temp - 20),
    }));
  }
  return Array.from(new Uint8Array(data));
}

test('gravity: corrected on main chart, no shrink, zoom kept', async ({ page }) => {
  page.on('pageerror', (e) => { throw new Error('page error: ' + e.message); });
  await page.goto(viewerUrl);
  await page.waitForFunction(() => typeof window.BChart !== 'undefined' && window.BChart.chart);
  await page.evaluate((bytes) => {
    window.file = { name: 'test.log' };
    BChart.raw = new Uint8Array(bytes);
    BChart.chart.process(new Uint8Array(bytes));
    BChart.chart.updateChart();
  }, logBytes());

  await page.click('.menu-button');
  await page.click('text=Create Temperature Correction');
  await page.click('text=OK');
  await page.waitForFunction(() => document.body.classList.contains('panel-mode'));
  await page.waitForTimeout(300);

  const labels = await page.evaluate(() => BChart.chart.chart.getLabels());
  expect(labels).toContain('corrected');

  // Corrected must be flat-ish: that is the whole point of the line.
  const spread = await page.evaluate(() => {
    const g = BChart.chart.chart;
    const col = g.getLabels().indexOf('corrected');
    const vals = [];
    for (let r = 0; r < g.numRows(); r++) {
      const v = g.getValue(r, col);
      if (v != null && !isNaN(v)) vals.push(v);
    }
    return { n: vals.length, spread: Math.max(...vals) - Math.min(...vals) };
  });
  expect(spread.n).toBeGreaterThan(50);
  expect(spread.spread).toBeLessThan(0.002);

  // Size must not change when the degree flips or the fit refreshes.
  const sizes = [];
  for (let i = 0; i < 4; i++) {
    await page.evaluate((k) => {
      document.getElementById('tc_poly_selection').value = k ? '2' : '3';
      update_formula();
    }, i % 2);
    await page.waitForTimeout(120);
    sizes.push(await page.evaluate(() => {
      const r = document.getElementById('tc-graph').getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    }));
  }
  for (const s of sizes) {
    expect(Math.abs(s.w - sizes[0].w)).toBeLessThan(2);
    expect(Math.abs(s.h - sizes[0].h)).toBeLessThan(2);
  }

  // Zoom, then flip the degree: the window must survive.
  const zoomed = await page.evaluate(() => {
    const t = BChart.chart.data.map((r) => r[0].getTime());
    BChart.chart.chart.updateOptions({ dateWindow: [t[10], t[40]] });
    return BChart.chart.chart.xAxisRange();
  });
  await page.evaluate(() => {
    document.getElementById('tc_poly_selection').value = '3';
    update_formula();
  });
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => BChart.chart.chart.xAxisRange());
  expect(after[0]).toBeCloseTo(zoomed[0], -4);
  expect(after[1]).toBeCloseTo(zoomed[1], -4);

  // Closing takes the extra curve away again.
  await page.click('#dock-panel button:has-text("Close")');
  await page.waitForTimeout(250);
  const closed = await page.evaluate(() => BChart.chart.chart.getLabels());
  expect(closed).not.toContain('corrected');
});
