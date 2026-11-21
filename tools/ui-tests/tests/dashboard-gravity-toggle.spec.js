import { test, expect } from '@playwright/test';
import { header, periodRecord, TAG } from './helpers/logfile.js';

// The dashboard stores (or streams) gravity with the controller's offset and
// temperature correction already applied. The chart can show the device value
// again by subtracting the correction the log header advertises. Nothing is
// written to the log, and the zoomed window must survive the switch.

const T0 = 1700000000;
const INTERVAL = 60;
const OFFSET = 0.006;
const SLOPE = 0.001;   // SG per degC
const AUX = 12;        // far from the beer probe on purpose
const LOGGED = 1.040;

function logBytes({ correction = [OFFSET, SLOPE, 0, 0] } = {}) {
  const data = [];
  data.push(...header({ startTime: T0, interval: INTERVAL, correction }));
  data.push(TAG.mode, 'C'.charCodeAt(0));
  data.push(TAG.state, 1);
  for (let i = 0; i < 120; i++) {
    data.push(...periodRecord({
      beerSet: 20,
      beerTemp: 20,
      fridgeTemp: 5,
      fridgeSet: 5,
      roomTemp: 22,
      // The firmware logs aux only when it changed; the rest of the rows must
      // fall back to the last known value, never to 0 degC.
      ...(i === 0 ? { auxTemp: AUX } : {}),
      gravity: LOGGED,
    }));
  }
  return Array.from(new Uint8Array(data));
}

async function openDashboard(page, opts) {
  page.on('pageerror', (e) => { throw new Error('page error: ' + e.message); });
  await page.goto('/index.htm');
  await page.waitForFunction(() => typeof window.BChart !== 'undefined' && window.BChart.chart);
  await page.evaluate((bytes) => {
    BChart.chart.process(new Uint8Array(bytes));
    BChart.chart.updateChart();
    updateGravityViewBar();
  }, logBytes(opts));
}

function gravityColumn(page) {
  return page.evaluate(() => BChart.chart.chart.getValue(3, 7));
}

test.describe('dashboard gravity corrected / uncorrected', () => {
  test('starts on the stored gravity and explains that it is corrected', async ({ page }) => {
    await openDashboard(page);
    await expect(page.locator('#gravity-view-bar')).toBeVisible();
    await expect(page.locator('#gravity-view-note')).toContainText('correction are applied');
    expect(await gravityColumn(page)).toBeCloseTo(LOGGED, 6);
  });

  test('uncorrected removes offset and the polynomial at aux temperature', async ({ page }) => {
    await openDashboard(page);
    await page.click('label[for="gv-uncorrected"]');

    await expect(page.locator('#gravity-view-note')).toContainText('removed from this chart');
    const expected = LOGGED - (OFFSET + SLOPE * AUX);
    expect(await gravityColumn(page)).toBeCloseTo(expected, 6);

    // Not the beer probe: that would leave offset + slope*20 behind.
    const beerOnly = LOGGED - (OFFSET + SLOPE * 20);
    expect(Math.abs((await gravityColumn(page)) - beerOnly)).toBeGreaterThan(0.005);

    await page.click('label[for="gv-corrected"]');
    expect(await gravityColumn(page)).toBeCloseTo(LOGGED, 6);
  });

  test('switching keeps the zoomed window', async ({ page }) => {
    await openDashboard(page);
    const before = await page.evaluate(() => {
      const t0 = 1700000000 * 1000;
      BChart.chart.setXRange([t0 + 10 * 60000, t0 + 40 * 60000]);
      return BChart.chart.getXRange().slice();
    });
    await page.click('label[for="gv-uncorrected"]');
    const after = await page.evaluate(() => BChart.chart.getXRange().slice());
    expect(after[0]).toBeCloseTo(before[0], -3);
    expect(after[1]).toBeCloseTo(before[1], -3);
  });

  test('the bar stays hidden when no correction was applied', async ({ page }) => {
    await openDashboard(page, { correction: [0, 0, 0, 0] });
    await page.evaluate(() => { BChart.liveCorrection = null; updateGravityViewBar(); });
    await expect(page.locator('#gravity-view-bar')).toBeHidden();
    expect(await gravityColumn(page)).toBeCloseTo(LOGGED, 6);
  });
});
