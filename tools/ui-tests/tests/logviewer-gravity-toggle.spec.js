import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { header, periodRecord, TAG } from './helpers/logfile.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const viewerUrl = 'file:///' + path.join(repoRoot, 'htmljs', 'dist', 'english', 'y2tlogviewer.htm').replace(/\\/g, '/');

// The log stores "device reading + the correction the firmware applied", and the
// header advertises that correction. The firmware evaluates it at the hydrometer
// temperature (aux), so undoing it must use that column, not the beer probe.
// The radio lets the reader switch between the two views, and the note says
// which one is on screen.

const T0 = 1700000000;
const INTERVAL = 60;
const OFFSET = 0.006;
const SLOPE = 0.001;      // SG per degC
const BEER = 20;
const AUX = 12;           // deliberately far from the beer probe
const LOGGED = 1.040;     // what the firmware wrote (raw + offset + poly)

function logBytes({ calibrating = false } = {}) {
  const data = [];
  data.push(...header({ startTime: T0, interval: INTERVAL, calibrating, correction: [OFFSET, SLOPE, 0, 0] }));
  data.push(TAG.mode, 'C'.charCodeAt(0));
  data.push(TAG.state, 1);
  for (let i = 0; i < 12; i++) {
    data.push(...periodRecord({
      beerSet: 20,
      beerTemp: BEER,
      fridgeTemp: 5,
      fridgeSet: 5,
      roomTemp: 22,
      auxTemp: AUX,
      ...(calibrating ? { tilt: 45 } : { gravity: LOGGED }),
    }));
  }
  return Array.from(new Uint8Array(data));
}

async function openLog(page, opts) {
  page.on('pageerror', (e) => { throw new Error('page error: ' + e.message); });
  await page.goto(viewerUrl);
  await page.waitForFunction(() => typeof window.BChart !== 'undefined' && window.BChart.chart);
  await page.evaluate((bytes) => {
    window.file = { name: 'test.log' };
    BChart.raw = new Uint8Array(bytes);
    BChart.chart.process(new Uint8Array(bytes));
    BChart.chart.updateChart();
  }, logBytes(opts));
}

function gravityColumn(page) {
  return page.evaluate(() => BChart.chart.data.map((row) => row[7]));
}

test.describe('gravity corrected / uncorrected view', () => {
  test('starts on the logged (corrected) gravity and explains it', async ({ page }) => {
    await openLog(page);
    await expect(page.locator('#gravity-mode-bar')).toBeVisible();
    await expect(page.locator('#gravity-mode-note')).toContainText('corrected gravity');

    const values = await gravityColumn(page);
    expect(values.every((v) => Math.abs(v - LOGGED) < 1e-6)).toBe(true);
  });

  test('uncorrected removes offset and the polynomial at aux temperature', async ({ page }) => {
    await openLog(page);
    await page.click('input[name="gravity_display"][value="uncorrected"]');

    await expect(page.locator('#gravity-mode-note')).toContainText('uncorrected gravity');
    const values = await gravityColumn(page);
    const expected = LOGGED - (OFFSET + SLOPE * AUX);
    expect(values.every((v) => Math.abs(v - expected) < 1e-6)).toBe(true);

    // Not the beer-probe value: that would only subtract offset + slope*BEER.
    const beerOnly = LOGGED - (OFFSET + SLOPE * BEER);
    expect(Math.abs(values[0] - beerOnly)).toBeGreaterThan(0.001);

    await page.click('input[name="gravity_display"][value="corrected"]');
    await expect(page.locator('#gravity-mode-note')).toContainText('corrected gravity');
    const back = await gravityColumn(page);
    expect(back.every((v) => Math.abs(v - LOGGED) < 1e-6)).toBe(true);
  });

  test('is absent for a calibrating log', async ({ page }) => {
    await openLog(page, { calibrating: true });
    await expect(page.locator('#gravity-mode-bar')).toBeHidden();
  });
});
