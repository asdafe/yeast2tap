import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fermentationLog } from './helpers/logfile.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const viewerPath = path.join(repoRoot, 'htmljs', 'dist', 'english', 'y2tlogviewer.htm');
const viewerUrl = 'file:///' + viewerPath.replace(/\\/g, '/');

// The scale page's "Export data" download: {exportedAt, settings, records},
// each record [day, time, level g, consumed g, flags, scale, raw counts,
// temperature C] (ScaleManager::writeDailyJson). Two daily rows followed by
// twelve FlagSample rows, one keg, all exactly on the line
// raw = 4000000 + 4000 * (t - 19.5) so the degree-2 fit is exact.
const dailyRows = [
  [20320, 1790000000, 15000, 0, 0, 0, 4000000, 19.5],
  [20321, 1790086400, 14800, 200, 0, 0, 4001000, 19.75],
];
const sampleRows = [];
for (let i = 0; i < 12; i++) {
  const t = 18.5 + 0.25 * i;
  sampleRows.push([20322, 1790176400 + 3600 * i, 13980 - 20 * i, 0, 32, 0, 4000000 + 4000 * (t - 19.5), t]);
}
const records = dailyRows.concat(sampleRows);

// Mean temperature of the rows the fit uses. Samples are preferred over the
// daily rows, which also move with consumption.
const sampleMeanTemp = sampleRows.reduce((sum, r) => sum + r[7], 0) / sampleRows.length;

test.describe('y2tlogviewer scale mode', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (error) => {
      throw new Error('page error: ' + error.message);
    });
    await page.goto(viewerUrl);
    await page.waitForFunction(() => typeof window.BChart !== 'undefined' && window.BChart.chart);
  });

  test('a scale export opens in scale mode', async ({ page }) => {
    const opened = await page.evaluate((rows) => {
      ScaleView.open(rows);
      return {
        mode: document.body.classList.contains('scale-mode'),
        rows: ScaleView.chart.numRows(),
        kept: ScaleView.rows.length,
      };
    }, records);

    expect(opened.mode).toBe(true);
    expect(opened.rows).toBe(14);
    expect(opened.kept).toBe(14);
  });

  test('a scale export opened through the file input enters scale mode', async ({ page }) => {
    // The openfile() wiring: FileReader -> parseScaleExport -> ScaleView.open.
    await page.setInputFiles('#fileinput', {
      name: 'scale_daily.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ exportedAt: '2026-11-02T00:00:00.000Z', settings: {}, records }, null, 2)),
    });
    await page.waitForFunction(() => window.ScaleView && ScaleView.chart && document.body.classList.contains('scale-mode'));

    const state = await page.evaluate(() => ({
      mode: document.body.classList.contains('scale-mode'),
      rows: ScaleView.chart.numRows(),
    }));
    expect(state.mode).toBe(true);
    expect(state.rows).toBe(14);
  });

  test('the correction dialog fits raw against temperature', async ({ page }) => {
    await page.evaluate((rows) => ScaleView.open(rows), records);

    // The reference input defaults to the mean temperature of the fitted rows.
    await page.evaluate(() => openScaleTcDialog());
    const dialog = await page.evaluate(() => ({
      ref: parseFloat(document.querySelector('#scale_tc_calibration').value),
      source: document.querySelector('#scale_tc_source').textContent,
      count: ScaleView.fitCount,
    }));
    // Only the twelve sampling rows are fitted; the two daily rows move with
    // consumption and would bend the curve.
    expect(dialog.count).toBe(12);
    expect(dialog.source).toContain('sampling records');
    expect(dialog.ref).toBeCloseTo(sampleMeanTemp, 3);

    // Anchor at 19.5: the correction must be zero there and cancel the
    // +4000 counts/degC drift, i.e. c(t) = 78000 - 4000 t.
    await page.evaluate(() => {
      document.querySelector('#scale_tc_calibration').value = '19.5';
    });
    const fit = await page.evaluate(() => ScaleView.fit());

    expect(Array.isArray(fit)).toBe(true);
    expect(fit).toHaveLength(4);
    const atRef = fit[0] + fit[1] * 19.5 + fit[2] * 19.5 * 19.5 + fit[3] * 19.5 * 19.5 * 19.5;
    expect(atRef).toBeCloseTo(0, 6);
    expect(fit[0]).toBeCloseTo(78000, 0);
    expect(fit[1]).toBeCloseTo(-4000, 0);
    expect(fit[2]).toBeCloseTo(0, 0);
    expect(fit[3]).toBeCloseTo(0, 0);
  });

  test('the fit and the selector follow the keg', async ({ page }) => {
    // Two kegs drifting differently at the same timestamps. The formula is
    // stored per keg, so fitting them pooled would be wrong for both: that
    // answer is [46800, -2400, 0, 0].
    const rows = [];
    for (let i = 0; i < 12; i++) {
      const t = 18.5 + 0.25 * i;
      const time = 1790176400 + 3600 * i;
      rows.push([20322, time, 13980 - 20 * i, 0, 32, 0, 4000000 + 4000 * (t - 19.5), t]);
      rows.push([20322, time, 9980 - 4 * i, 0, 32, 1, 3000000 + 800 * (t - 19.5), t]);
    }
    const settings = { scales: [{ id: 0, kegName: 'Pale Ale' }, { id: 1, kegName: 'Stout' }] };

    const result = await page.evaluate((data) => {
      ScaleView.open(data.rows, data.settings);
      document.querySelector('#scale_tc_calibration').value = '19.5';
      const select = document.querySelector('#scale_tc_keg');
      const labels = Array.prototype.map.call(select.options, function (o) { return o.textContent; });
      select.value = '0';
      select.dispatchEvent(new Event('change'));
      const fit0 = ScaleView.equation;
      select.value = '1';
      select.dispatchEvent(new Event('change'));
      const fit1 = ScaleView.equation;
      ScaleView.open(data.rows);
      const fallback = Array.prototype.map.call(select.options, function (o) { return o.textContent; });
      return { labels: labels, fallback: fallback, fit0: fit0, fit1: fit1 };
    }, { rows, settings });

    expect(result.labels).toEqual(['Pale Ale', 'Stout']);
    expect(result.fallback).toEqual(['Scale 1', 'Scale 2']);
    expect(result.fit0).toEqual([78000, -4000, 0, 0]);
    expect(result.fit1).toEqual([15600, -800, 0, 0]);
    expect(result.fit0).not.toEqual([46800, -2400, 0, 0]);
    expect(result.fit1).not.toEqual([46800, -2400, 0, 0]);
  });

  test('the copied formula is what the scale page accepts', async ({ page }) => {
    const text = await page.evaluate((rows) => {
      ScaleView.open(rows);
      document.querySelector('#scale_tc_calibration').value = '19.5';
      ScaleView.fit();
      return ScaleView.formulaText();
    }, records);

    expect(text).toBe(await page.evaluate(() => format_formula(ScaleView.equation)));
    expect(text).toMatch(/^[-0-9. +t^]+$/);
    // The same grammar the gravity dialog parses round-trips the coefficients.
    const parsed = await page.evaluate((formula) => parsePolynomial(formula), text);
    expect(parsed[0]).toBeCloseTo(78000, 0);
    expect(parsed[1]).toBeCloseTo(-4000, 0);
    expect(parsed[2]).toBeCloseTo(0, 0);
    expect(parsed[3]).toBeCloseTo(0, 0);
  });

  test('an empty export says there is nothing to fit', async ({ page }) => {
    const result = await page.evaluate(() => {
      ScaleView.open([]);
      return ScaleView.fit();
    });

    expect(result).toEqual({ error: 'Need at least 3 points with both raw counts and temperature for a degree 2 fit.' });
  });

  test('crop writes JSON with the same record shape', async ({ page }) => {
    const result = await page.evaluate((rows) => {
      ScaleView.open(rows);
      // The chart opens zoomed to the sampling session, and "crop" means "what is
      // on screen". Reset to the whole history first so this compares the same
      // thing the old viewer did.
      ScaleView.chart.updateOptions({ dateWindow: null });
      const full = ScaleView.crop();
      // Zoom to the evening of the last day: only the sample rows are kept.
      ScaleView.chart.updateOptions({ dateWindow: [1790170000000, 1790200000000] });
      return { full, cropped: ScaleView.crop() };
    }, records);

    const full = JSON.parse(result.full);
    expect(full.records).toHaveLength(14);
    for (const row of full.records) expect(row).toHaveLength(8);

    const cropped = JSON.parse(result.cropped);
    expect(cropped.exportedAt).toBeTruthy();
    expect(cropped.records).toHaveLength(7);
    expect(cropped.records[0]).toHaveLength(8);
    expect(cropped.records[0][4]).toBe(32);

    // The cropped JSON is a file the same viewer re-opens (parseScaleExport).
    const reopened = await page.evaluate(
      (json) => parseScaleExport(new TextEncoder().encode(json).buffer),
      result.cropped,
    );
    expect(reopened.records).toHaveLength(7);
    expect(reopened.records[0]).toEqual(cropped.records[0]);
  });

  test('a failed open leaves scale mode', async ({ page }) => {
    page.on('dialog', (dialog) => dialog.accept());
    await page.evaluate((rows) => ScaleView.open(rows), records);
    expect(await page.evaluate(() => document.body.classList.contains('scale-mode'))).toBe(true);

    // Bytes that are neither a scale export nor a brew log: the alert must not
    // leave the old rows behind for a later "Crop to" to save under this name.
    await page.setInputFiles('#fileinput', {
      name: 'broken.log',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('not a log'),
    });
    await page.waitForFunction(() => !document.body.classList.contains('scale-mode'));

    const state = await page.evaluate(() => ({
      mode: document.body.classList.contains('scale-mode'),
      rows: ScaleView.rows.length,
    }));
    expect(state.mode).toBe(false);
    expect(state.rows).toBe(0);
  });

  test('opening a normal brew log leaves scale mode', async ({ page }) => {
    await page.evaluate((rows) => ScaleView.open(rows), records);
    expect(await page.evaluate(() => document.body.classList.contains('scale-mode'))).toBe(true);

    await page.setInputFiles('#fileinput', {
      name: 'brew.log',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(fermentationLog()),
    });
    await page.waitForFunction(() => window.BChart && BChart.chart && BChart.chart.data && BChart.chart.data.length > 0);

    const state = await page.evaluate(() => ({
      mode: document.body.classList.contains('scale-mode'),
      rows: ScaleView.rows.length,
    }));
    expect(state.mode).toBe(false);
    expect(state.rows).toBe(0);
  });
});
