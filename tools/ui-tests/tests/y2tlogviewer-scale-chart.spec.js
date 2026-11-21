import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const viewerUrl = 'file:///' + path.join(repoRoot, 'htmljs', 'dist', 'english', 'y2tlogviewer.htm').replace(/\\/g, '/');

// Opening a scale export used to chart keg weight (kg) against raw counts. The
// calibration view is raw counts against temperature: that is the pair the
// correction is fitted from, and weight belongs on the Scale page.

const SLOPE = -4000;      // raw counts per degC
const BASE = 900000;

function scaleExportFile() {
  const rows = [];
  for (let i = 0; i < 8; i++) {
    const temp = 5 + i;
    rows.push([19000 + i, 1700000000 + i * 86400, 18000 - 100 * i, 0, 32, 0, Math.round(BASE + SLOPE * temp), temp]);
  }
  const file = path.join(repoRoot, 'tools', 'ui-tests', 'artifacts', `tc-chart-${Date.now()}.json`);
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
  await page.setInputFiles('#fileinput', scaleExportFile());
  await page.waitForFunction(() => typeof ScaleView !== 'undefined' && ScaleView.chart);
}

test.describe('y2tlogviewer scale chart', () => {
  test('charts temperature against raw counts, not keg weight', async ({ page }) => {
    await openExport(page);

    const chart = await page.evaluate(() => {
      const g = ScaleView.chart;
      const labels = g.getLabels();
      const rows = [];
      for (let r = 0; r < g.numRows(); r++) {
        rows.push(labels.map((_, c) => g.getValue(r, c)));
      }
      return { labels, rows };
    });

    expect(chart.labels).toEqual(['Time', 'Temperature (°C)', 'Raw counts', 'Corrected counts']);
    // The calibration pair stays intact: temperature on the left, counts on y2.
    expect(chart.labels).not.toContain('Filtered SG');
    // The keg level no longer shares the left axis: tens of kg next to a few °C
    // flattened the temperature line and hid the drift being corrected.
    expect(chart.labels).not.toContain('Keg (kg)');

    // Temperature is the record's own temperature column; raw is the counts.
    for (const row of chart.rows) {
      const temp = row[1], raw = row[2];
      expect(temp).toBeGreaterThan(0);
      expect(Math.abs(raw - (BASE + SLOPE * temp))).toBeLessThan(1);
    }
    // Nothing corrected until a formula is applied.
    for (const row of chart.rows) expect(row[3] == null || isNaN(row[3])).toBe(true);
  });

  test('the left axis spans the temperature, so the drift is visible', async ({ page }) => {
    await openExport(page);

    // The fixture runs 5..12 °C. Sharing the axis with 18 kg of beer stretched it
    // to ~22 units and turned that 7 °C into a nearly flat line.
    const range = await page.evaluate(() => ScaleView.chart.yAxisRange(0));
    expect(range[0]).toBeGreaterThan(4);
    expect(range[1]).toBeLessThan(13);
    expect(range[1] - range[0]).toBeLessThan(10);
  });

  test('the fit produces a formula and Apply draws the corrected counts', async ({ page }) => {
    await openExport(page);

    await page.click('.menu-button');
    await page.click('#menu-scale-tc');
    await expect(page.locator('#dock-panel #scale_tc_calibration')).toBeVisible();

    // Anchor at 8 C so the correction is zero there.
    await page.evaluate(() => {
      document.querySelector('#scale_tc_calibration').value = '8';
      updateScaleFormula();
    });

    const fit = await page.evaluate(() => ({
      equation: ScaleView.equation,
      formula: document.querySelector('#scale_tc_formula').textContent,
      atRef: ScaleView.equation.reduce((s, c, k) => s + c * Math.pow(8, k), 0),
    }));
    expect(fit.formula).not.toMatch(/[eE]/);
    // c(t) = ref - poly(t), so a raw slope of -4000/degC gives +4000 in c, and
    // the corrected counts are flat at the reference.
    expect(fit.equation[1]).toBeCloseTo(-SLOPE, 0);
    expect(fit.atRef).toBeCloseTo(0, 3);

    await page.evaluate(() => applyScaleCorrection());

    const after = await page.evaluate(() => {
      const g = ScaleView.chart;
      const labels = g.getLabels();
      const rows = [];
      for (let r = 0; r < g.numRows(); r++) {
        rows.push({ temp: g.getValue(r, 1), raw: g.getValue(r, 2), corrected: g.getValue(r, 3) });
      }
      return { labels, rows };
    });

    expect(after.labels).toEqual(['Time', 'Temperature (°C)', 'Raw counts', 'Corrected counts']);
    const corrected = after.rows.map((r) => r.corrected).filter((v) => v != null && !isNaN(v));
    expect(corrected.length).toBe(after.rows.length);
    // Corrected counts are flat: the temperature drift is removed.
    expect(Math.max(...corrected) - Math.min(...corrected)).toBeLessThan(2);
    // And they sit at the value the counts have at the reference temperature.
    expect(corrected[0]).toBeCloseTo(BASE + SLOPE * 8, 0);
  });
});
