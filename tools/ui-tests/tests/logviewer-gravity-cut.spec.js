import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { header, periodRecord, TAG } from './helpers/logfile.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const viewerUrl = 'file:///' + path.join(repoRoot, 'htmljs', 'dist', 'english', 'y2tlogviewer.htm').replace(/\\/g, '/');

// Cutting a stretch out of a brew log, the way it already worked for a scale
// export: the range on screen leaves the correction fit and the saved crop, and
// the chart shades it. The saved log keeps its real timeline: the gap is written
// as a resume tag, not as a shortened file.

const T0 = 1700000000;
const INTERVAL = 60;          // one record per minute
const N = 40;
const CUT_FROM = 10;          // rows 10..19 are the bad stretch
const CUT_TO = 19;
const SLOPE = 0.002;          // SG per degC (well above the 1/10000 log resolution)
const BAD_OFFSET = 0.02;      // what the bad stretch adds

/** Beer temperature ramps 18..22 C, gravity drifts with it, rows 10..19 jump. */
function logBytes() {
  const data = [];
  data.push(...header({ startTime: T0, interval: INTERVAL }));
  data.push(TAG.mode, 'C'.charCodeAt(0));
  data.push(TAG.state, 1);
  for (let i = 0; i < N; i++) {
    const temp = 18 + i * 0.1;
    const bad = i >= CUT_FROM && i <= CUT_TO ? BAD_OFFSET : 0;
    data.push(...periodRecord({
      beerSet: 20,
      beerTemp: temp,
      fridgeTemp: 5,
      fridgeSet: 5,
      roomTemp: 22,
      auxTemp: temp,
      gravity: 1.05 + SLOPE * (temp - 20) + bad,
    }));
  }
  return Array.from(new Uint8Array(data));
}

async function openLog(page) {
  page.on('pageerror', (e) => { throw new Error('page error: ' + e.message); });
  await page.goto(viewerUrl);
  await page.waitForFunction(() => typeof window.BChart !== 'undefined' && window.BChart.chart);
  await page.evaluate((bytes) => {
    window.file = { name: 'test.log' };
    BChart.raw = new Uint8Array(bytes);
    BChart.chart.process(new Uint8Array(bytes));
    BChart.chart.updateChart();
  }, logBytes());
}

/** Cut rows [from, to] by excluding the time span they cover. */
async function cutRows(page, from, to) {
  return page.evaluate(({ from, to, t0, interval }) => {
    const ms = (i) => (t0 + i * interval) * 1000;
    BChart.chart.excluded = [[ms(from), ms(to)]];
    cutUpdateHint();
    return {
      hint: document.getElementById('cut-hint').textContent,
      cuts: BChart.chart.excluded.length,
    };
  }, { from, to, t0: T0, interval: INTERVAL });
}

test.describe('brew log cut', () => {
  test('the two cut buttons sit on the main screen, not in the menu', async ({ page }) => {
    await openLog(page);
    await expect(page.locator('#cut-bar')).toBeVisible();
    await expect(page.locator('#cut_exclude')).toBeVisible();
    await expect(page.locator('#cut_clear')).toBeVisible();

    // They are gone from the menu.
    await page.click('.menu-button');
    const menu = await page.locator('#popupMenu').textContent();
    expect(menu).not.toContain('Exclude visible range');
    expect(menu).not.toContain('Clear cuts');
    await page.click('.menu-button');
  });

  test('a cut is reported and leaves the data on screen', async ({ page }) => {
    await openLog(page);
    const after = await cutRows(page, CUT_FROM, CUT_TO);

    expect(after.cuts).toBe(1);
    expect(after.hint).toContain('1 cut');
    expect(after.hint).toContain((CUT_TO - CUT_FROM + 1) + ' records');

    // Cutting is about the fit, not about hiding evidence: every row is still there.
    expect(await page.evaluate(() => BChart.chart.data.length)).toBe(N);
  });

  test('the correction fit ignores the cut stretch', async ({ page }) => {
    await openLog(page);

    // With the bad stretch in, the slope is pulled away from the true one.
    const rough = await page.evaluate(() => {
      document.querySelector('#tc_sensor').value = 'beer';
      openDialog('#tc-graph-dialog');
      derivetc();
      return TC.equation[1];
    });

    await cutRows(page, CUT_FROM, CUT_TO);

    const clean = await page.evaluate(() => {
      derivetc();
      return TC.equation[1];
    });

    expect(Math.abs(clean)).toBeCloseTo(SLOPE, 4);
    expect(Math.abs(rough)).toBeGreaterThan(Math.abs(clean) * 1.5);
  });

  test('a crop leaves the cut out but keeps the timeline', async ({ page }) => {
    await openLog(page);
    await cutRows(page, CUT_FROM, CUT_TO);

    const saved = await page.evaluate(({ t0, interval }) => {
      const start = (t0 + 0 * interval) * 1000;
      const end = (t0 + 39 * interval) * 1000;
      const chunks = BChart.chart.partial(start, end);
      const out = [];
      for (const c of chunks) for (let i = 0; i < c.length; i++) out.push(c[i]);
      return out;
    }, { t0: T0, interval: INTERVAL });

    // The saved log must be readable again: load it back and count what came out.
    const reread = await page.evaluate((bytes) => {
      const chart = new UniBrewChart('div_g');
      chart.process(new Uint8Array(bytes));
      return chart.data.map((row) => ({ t: row[0].getTime(), beer: row[1] }));
    }, saved);

    // 40 rows minus the 10 cut ones.
    const real = reread.filter((r) => !isNaN(r.beer));
    expect(real.length).toBe(N - (CUT_TO - CUT_FROM + 1));

    // The gap is a gap in time: the record after it is the row that followed the
    // cut, 1 minute after it, not the record that would have closed the hole.
    const before = T0 + (CUT_FROM - 1) * INTERVAL;
    const after = T0 + (CUT_TO + 1) * INTERVAL;
    const times = real.map((r) => Math.round(r.t / 1000));
    expect(times).toContain(before);
    expect(times).toContain(after);
    for (const t of times) {
      expect(t < T0 + CUT_FROM * INTERVAL || t > T0 + CUT_TO * INTERVAL).toBe(true);
    }
  });

  test('clearing the cuts restores the whole log', async ({ page }) => {
    await openLog(page);
    await cutRows(page, CUT_FROM, CUT_TO);

    const restored = await page.evaluate(() => {
      cutClear();
      return {
        cuts: BChart.chart.excluded.length,
        hint: document.getElementById('cut-hint').textContent,
      };
    });
    expect(restored.cuts).toBe(0);
    expect(restored.hint).toBe('');
  });

  test('a new log starts with no cuts', async ({ page }) => {
    await openLog(page);
    await cutRows(page, CUT_FROM, CUT_TO);
    await page.evaluate((bytes) => {
      BChart.chart.process(new Uint8Array(bytes));
      BChart.chart.updateChart();
    }, logBytes());
    expect(await page.evaluate(() => BChart.chart.excluded.length)).toBe(0);
    expect(await page.evaluate(() => document.getElementById('cut-hint').textContent)).toBe('');
  });
});
