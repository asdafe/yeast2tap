import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fermentationLog, concatChunks } from './helpers/logfile.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const viewerPath = path.join(repoRoot, 'htmljs', 'dist', 'english', 'y2tlogviewer.htm');
const viewerUrl = 'file:///' + viewerPath.replace(/\\/g, '/');

// Regressions for the "Crop to / Save As" round trip. A cropped log must keep
// the gravity it was cropped from: the encoder and the decoder share the same
// byte format, so a value written from the wrong source only shows up after
// re-opening the file.

test.describe('y2tlogviewer crop round trip', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (error) => {
      throw new Error('page error: ' + error.message);
    });
    await page.goto(viewerUrl);
    await page.waitForFunction(() => typeof window.BChart !== 'undefined' && window.BChart.chart);
  });

  test('crop keeps gravity for a non-calibrating log', async ({ page }) => {
    const result = await page.evaluate((bytes) => {
      const data = new Uint8Array(bytes);
      const chart = BChart.chart;
      chart.process(data);
      chart.updateChart();
      const before = chart.data.map((row) => row[GravityLine]);

      const chunks = chart.partial(chart.start().getTime(), chart.end().getTime());
      const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const cropped = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        cropped.set(chunk, offset);
        offset += chunk.length;
      }

      const reopened = new UniBrewChart('div_g');
      reopened.process(cropped);
      const after = reopened.data.map((row) => row[GravityLine]);
      return { before, after, croppedLength: cropped.length };
    }, Array.from(fermentationLog()));

    expect(result.before.filter((v) => typeof v === 'number' && !Number.isNaN(v)).length).toBeGreaterThan(0);
    expect(result.after.filter((v) => typeof v === 'number' && !Number.isNaN(v)).length).toBeGreaterThan(0);
    expect(result.after[0]).toBeCloseTo(1.06, 3);
    expect(Math.min(...result.after.filter((v) => typeof v === 'number'))).toBeCloseTo(1.031, 3);
  });

  test('crop keeps the beer temperature curve', async ({ page }) => {
    const result = await page.evaluate((bytes) => {
      const chart = BChart.chart;
      chart.process(new Uint8Array(bytes));
      chart.updateChart();
      const chunks = chart.partial(chart.start().getTime(), chart.end().getTime());
      const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const cropped = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        cropped.set(chunk, offset);
        offset += chunk.length;
      }
      const reopened = new UniBrewChart('div_g');
      reopened.process(cropped);
      return {
        temps: reopened.data.map((row) => row[BeerTempLine]),
        rows: reopened.data.length,
      };
    }, Array.from(fermentationLog()));

    expect(result.rows).toBe(4);
    expect(result.temps[0]).toBeCloseTo(20, 2);
    expect(result.temps[3]).toBeCloseTo(20.2, 2);
  });

  test('a cropped log can be cropped again without losing gravity', async ({ page }) => {
    const result = await page.evaluate((bytes) => {
      function crop(source) {
        const chart = new UniBrewChart('div_g');
        chart.process(source);
        chart.updateChart();
        const chunks = chart.partial(chart.start().getTime(), chart.end().getTime());
        const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const out = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          out.set(chunk, offset);
          offset += chunk.length;
        }
        return out;
      }
      const once = crop(new Uint8Array(bytes));
      const twice = crop(once);
      const chart = new UniBrewChart('div_g');
      chart.process(twice);
      return chart.data.map((row) => row[GravityLine]);
    }, Array.from(fermentationLog()));

    const values = result.filter((v) => typeof v === 'number' && !Number.isNaN(v));
    expect(values.length).toBeGreaterThan(0);
    expect(values[0]).toBeCloseTo(1.06, 3);
    expect(values[values.length - 1]).toBeCloseTo(1.031, 3);
  });

  test('a gravity temperature formula stays plain decimal and round-trips', async ({ page }) => {
    // Degrees 2 and 3 fits on SG produce coefficients around 1e-7..1e-9, where
    // JavaScript would print exponent notation. Neither the firmware's /coeff
    // parser nor the Scale page's formula box accepts an exponent, so the text
    // must be plain decimal and parse back to the same coefficients.
    const result = await page.evaluate(() => {
      const cases = [
        [0.000123456789, -0.000018234, 2.345e-7, -3.7e-9],
        [-0.5, 0.2495489695590052, -0.013370714889313219, 0.00023604309349858901],
      ];
      return cases.map((eq) => {
        const text = format_formula(eq);
        const back = parsePolynomial(text);
        return { text, exponent: /[eE]/.test(text), maxErr: Math.max(...eq.map((v, i) => Math.abs(v - back[i]))) };
      });
    });

    for (const item of result) {
      expect(item.exponent, 'formula must not contain an exponent: ' + item.text).toBe(false);
      expect(item.maxErr).toBeLessThan(1e-6);
    }
  });
});

test('concatChunks helper keeps byte order', () => {
  const joined = concatChunks([new Uint8Array([1, 2]), new Uint8Array([3])]);
  expect(Array.from(joined)).toEqual([1, 2, 3]);
});
