import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { header, periodRecord, TAG } from './helpers/logfile.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const viewerUrl = 'file:///' + path.join(repoRoot, 'htmljs', 'dist', 'english', 'y2tlogviewer.htm').replace(/\\/g, '/');
const T0 = 1700000000;
const N = 60;

// The correction fit used to open as a full-screen modal, hiding the very chart it
// is built from, and Apply threw away the zoom. It now docks beside and under the
// chart, and the window the reader chose survives Apply.

function logBytes() {
  const data = [];
  data.push(...header({ startTime: T0, interval: 60 }));
  data.push(TAG.mode, 'C'.charCodeAt(0));
  data.push(TAG.state, 1);
  for (let i = 0; i < N; i++) {
    const temp = 18 + Math.sin(i / 6) * 3;
    data.push(...periodRecord({
      beerSet: 20, beerTemp: temp, fridgeTemp: 5, fridgeSet: 5,
      roomTemp: 22, auxTemp: temp, gravity: 1.05 + 0.002 * (temp - 20),
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

async function openGravityPanel(page) {
  await page.click('.menu-button');
  await page.click('text=Create Temperature Correction');
  await page.click('text=OK');
  await page.waitForFunction(() => document.body.classList.contains('panel-mode'));
}

test.describe('gravity correction panel', () => {
  test('docks beside the chart instead of covering it', async ({ page }) => {
    await openLog(page);
    await openGravityPanel(page);

    // Controls on the right, fit graph under the main chart: neither is a modal.
    await expect(page.locator('#dock-panel #tc_calibration')).toBeVisible();
    await expect(page.locator('#dock-chart-host #tc-graph')).toBeVisible();
    await expect(page.locator('#tc-graph-dialog')).toBeHidden();

    // The main chart is still on screen, not covered by an overlay.
    const boxes = await page.evaluate(() => {
      const main = document.getElementById('div_g').getBoundingClientRect();
      const panel = document.getElementById('dock-panel').getBoundingClientRect();
      const graph = document.getElementById('tc-graph').getBoundingClientRect();
      return { main, panel, graph };
    });
    // Side by side: the panel starts at or after the chart's right edge.
    expect(boxes.panel.left).toBeGreaterThanOrEqual(boxes.main.right - 1);
    // Stacked: the fit graph starts below the main chart. The page scrolls rather
    // than squeezing everything into one screen, so only the order matters.
    expect(boxes.graph.top).toBeGreaterThanOrEqual(boxes.main.bottom - 1);

    // The main chart and the fit graph share a plot width and offset, so the two
    // halves of the panel read as one picture.
    const widths = await page.evaluate(() => {
      const area = (g) => {
        const r = g.plotter_.area;
        return { x: Math.round(r.x), w: Math.round(r.w) };
      };
      return { main: area(BChart.chart.chart), scatter: area(TC.graph) };
    });
    expect(Math.abs(widths.scatter.w - widths.main.w)).toBeLessThan(3);
    expect(Math.abs(widths.scatter.x - widths.main.x)).toBeLessThan(3);
  });

  test('the legend stays visible under the panel', async ({ page }) => {
    await openLog(page);
    await expect(page.locator('.chart-legend')).toBeVisible();
    await openGravityPanel(page);
    // The controls take the top of the right column and the legend follows them,
    // so the reader can still tell which line is which while fitting.
    await expect(page.locator('.chart-legend')).toBeVisible();
    const order = await page.evaluate(() => {
      const panel = document.getElementById('dock-panel').getBoundingClientRect();
      const legend = document.querySelector('.chart-legend').getBoundingClientRect();
      return { panelBottom: Math.round(panel.bottom), legendTop: Math.round(legend.top) };
    });
    expect(order.legendTop).toBeGreaterThanOrEqual(order.panelBottom - 2);

    await page.click('#dock-panel button:has-text("Close")');
    await expect(page.locator('.chart-legend')).toBeVisible();
    await expect(page.locator('body')).not.toHaveClass(/panel-mode/);
  });

  test('Apply keeps the zoomed window', async ({ page }) => {
    await openLog(page);
    // Zoom into a stretch before opening the panel.
    const window0 = await page.evaluate(() => {
      const t = BChart.chart.data.map((r) => r[0].getTime());
      const w = [t[10], t[30]];
      BChart.chart.chart.updateOptions({ dateWindow: w });
      return BChart.chart.chart.xAxisRange();
    });
    await openGravityPanel(page);
    await page.click('#dock-panel button:has-text("Apply")');
    await page.waitForTimeout(300);

    const after = await page.evaluate(() => BChart.chart.chart.xAxisRange());
    expect(after[0]).toBeCloseTo(window0[0], -4);
    expect(after[1]).toBeCloseTo(window0[1], -4);
    // Not the whole log.
    const full = await page.evaluate(() => BChart.chart.chart.xAxisExtremes());
    expect(after[1] - after[0]).toBeLessThan((full[1] - full[0]) * 0.9);
  });

  test('a new log still starts at the whole range', async ({ page }) => {
    await openLog(page);
    await page.evaluate(() => {
      const t = BChart.chart.data.map((r) => r[0].getTime());
      BChart.chart.chart.updateOptions({ dateWindow: [t[10], t[30]] });
    });
    await page.evaluate((bytes) => {
      BChart.raw = new Uint8Array(bytes);
      BChart.chart.resetWindowOnUpdate = true;
      BChart.chart.process(new Uint8Array(bytes));
      BChart.chart.updateChart();
    }, logBytes());
    const r = await page.evaluate(() => ({
      win: BChart.chart.chart.xAxisRange(),
      full: BChart.chart.chart.xAxisExtremes(),
    }));
    expect(r.win[0]).toBeCloseTo(r.full[0], -4);
    expect(r.win[1]).toBeCloseTo(r.full[1], -4);
  });

  test('the chart draws lines, not a marker per sample', async ({ page }) => {
    await openLog(page);
    const opts = await page.evaluate(() => {
      const g = BChart.chart.chart;
      return {
        gravity: g.getOption('drawPoints', 'gravity'),
        filtersg: g.getOption('drawPoints', 'filtersg'),
      };
    });
    expect(opts.gravity).toBeFalsy();
  });

  test('zooming the chart refits the scatter on the visible slice', async ({ page }) => {
    await openLog(page);
    await openGravityPanel(page);

    const before = await page.evaluate(() => ({
      points: TC.data.length,
      ref: document.getElementById('tc_calibration').value,
    }));

    // A real zoom ends in doZoomXDates_, which is what fires zoomCallback.
    await page.evaluate(() => {
      const t = BChart.chart.data.map((r) => r[0].getTime());
      BChart.chart.chart.doZoomXDates_(t[10], t[25]);
    });
    await page.waitForTimeout(250);

    const after = await page.evaluate(() => ({
      points: TC.data.length,
      graphRows: TC.graph.numRows(),
      ref: document.getElementById('tc_calibration').value,
      panel: document.body.classList.contains('panel-mode'),
    }));    expect(after.points).toBeLessThan(before.points);
    expect(after.graphRows).toBe(after.points);
    // The reader's reference temperature survives the refit.
    expect(after.ref).toBe(before.ref);
    expect(after.panel).toBe(true);
  });

  test('the fit graph draws its series as lines', async ({ page }) => {    await openLog(page);
    await openGravityPanel(page);
    const series = await page.evaluate(() => TC.graph.attributes_.series || {});
    // No drawPoints override means Dygraph's default: a line.
    for (const name of Object.keys(series)) {
      expect(series[name].drawPoints).not.toBe(true);
    }
  });
});
