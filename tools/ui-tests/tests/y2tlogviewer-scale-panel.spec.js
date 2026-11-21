import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const viewerUrl = 'file:///' + path.join(repoRoot, 'htmljs', 'dist', 'english', 'y2tlogviewer.htm').replace(/\\/g, '/');

// The scale correction opens in the same docked layout as the gravity one: the
// controls fill the column that is empty in scale mode, the fit graph goes under
// the chart, and nothing is covered by a modal.

const SLOPE = -3000;
const BASE = -900000;
// Same shape as a real export: a keg with a known tare and calibration factor, so
// the target box can speak kilograms.
const ZERO = -500000;
const FACTOR = -20;

function exportFile() {
  const rows = [];
  const t0 = 1700000000;
  for (let i = 0; i < 80; i++) {
    const temp = 1 + i * 0.05;
    rows.push([19000, t0 + i * 120, 18000, 0, 32, 0, Math.round(BASE + SLOPE * (temp - 2.5)), +temp.toFixed(2)]);
  }
  const file = path.join(repoRoot, 'tools', 'ui-tests', 'artifacts', `scale-panel-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    exportedAt: 'x',
    settings: { scales: [{ id: 0, kegName: 'Keg A' }] },
    records: rows,
  }));
  return file;
}

/** The same drift, but with the keg's calibration so weights are meaningful. */
function calibratedExport() {
  const rows = [];
  const t0 = 1700000000;
  for (let i = 0; i < 80; i++) {
    const temp = 1 + i * 0.05;
    rows.push([19000, t0 + i * 120, 18000, 0, 32, 0, Math.round(BASE + SLOPE * (temp - 2.5)), +temp.toFixed(2)]);
  }
  const file = path.join(repoRoot, 'tools', 'ui-tests', 'artifacts', `scale-cal-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    exportedAt: 'x',
    settings: {
      scales: [{
        id: 0, kegName: 'Keg A', calibrated: true,
        zeroOffset: ZERO, calibrationFactor: FACTOR,
      }],
    },
    records: rows,
  }));
  return file;
}

async function openScale(page) {
  page.on('pageerror', (e) => { throw new Error('page error: ' + e.message); });
  await page.goto(viewerUrl);
  await page.waitForFunction(() => typeof window.BChart !== 'undefined');
  await page.setInputFiles('#fileinput', exportFile());
  await page.waitForFunction(() => typeof ScaleView !== 'undefined' && ScaleView.chart);
}

async function openPanel(page) {
  await page.click('.menu-button');
  await page.click('#menu-scale-tc');
  await page.waitForFunction(() => document.body.classList.contains('panel-mode'));
}

test.describe('scale correction panel', () => {
  test('docks instead of opening a modal', async ({ page }) => {
    await openScale(page);
    await openPanel(page);

    await expect(page.locator('#dock-panel #scale_tc_calibration')).toBeVisible();
    await expect(page.locator('#dock-chart-host #scale-tc-graph')).toBeVisible();
    await expect(page.locator('#scale-tc-dialog')).toBeHidden();

    // Side by side and stacked. The page scrolls rather than squeezing both
    // graphs into one screen, so only the order matters.
    const b = await page.evaluate(() => ({
      main: document.getElementById('div_scale').getBoundingClientRect(),
      panel: document.getElementById('dock-panel').getBoundingClientRect(),
      graph: document.getElementById('scale-tc-graph').getBoundingClientRect(),
    }));
    expect(b.panel.left).toBeGreaterThanOrEqual(b.main.right - 1);
    expect(b.graph.top).toBeGreaterThanOrEqual(b.main.bottom - 1);

    // Both graphs share a plot width and offset.
    const widths = await page.evaluate(() => {
      const area = (g) => {
        const r = g.plotter_.area;
        return { x: Math.round(r.x), w: Math.round(r.w) };
      };
      return {
        main: area(ScaleView.chart),
        scatter: area(ScaleView.graph),
      };
    });
    expect(Math.abs(widths.scatter.w - widths.main.w)).toBeLessThan(3);
    expect(Math.abs(widths.scatter.x - widths.main.x)).toBeLessThan(3);
  });

  test('the scale chart keeps its height and is re-measured', async ({ page }) => {
    await openScale(page);
    const before = await page.evaluate(() => document.getElementById('div_scale').getBoundingClientRect().height);
    await openPanel(page);
    const after = await page.evaluate(() => {
      const el = document.getElementById('div_scale');
      return { box: el.getBoundingClientRect().height, graph: ScaleView.chart.height_ };
    });
    // The graph is not squeezed to fit the panel: the page scrolls instead.
    expect(after.box).toBeCloseTo(before, 0);
    // Dygraph has to agree with the new width, not just the CSS box.
    expect(Math.abs(after.graph - after.box)).toBeLessThan(3);
  });

  test('the target box is a weight when the export has calibration', async ({ page }) => {
    await page.goto(viewerUrl);
    await page.waitForFunction(() => typeof window.BChart !== 'undefined');
    await page.setInputFiles('#fileinput', calibratedExport());
    await page.waitForFunction(() => typeof ScaleView !== 'undefined' && ScaleView.chart);

    await page.click('.menu-button');
    await page.click('#menu-scale-tc');
    await page.waitForFunction(() => document.body.classList.contains('panel-mode'));

    const seeded = await page.evaluate(() => ({
      unit: document.getElementById('scale_tc_unit').textContent,
      value: document.getElementById('scale_tc_calibration').value,
      hint: document.getElementById('scale_tc_target_hint').textContent,
    }));
    // The box speaks the language of the keg: kilograms.
    expect(seeded.unit).toBe('kg');
    expect(parseFloat(seeded.value)).toBeGreaterThan(15);
    expect(seeded.hint).toContain('weight');
    expect(seeded.hint).toContain('\u00b0C');

    // Asking for a heavier keg moves the anchor: the correction must be zero at
    // the temperature where the fit reads that weight.
    const moved = await page.evaluate(() => {
      const before = ScaleView.refTemp;
      document.getElementById('scale_tc_calibration').value = '21.00';
      updateScaleFormula();
      return { before: before, after: ScaleView.refTemp, eq: ScaleView.equation };
    });
    expect(Math.abs(moved.after - moved.before)).toBeGreaterThan(0.05);
    const atRef = moved.eq[0] + moved.eq[1] * moved.after
      + moved.eq[2] * moved.after * moved.after + moved.eq[3] * Math.pow(moved.after, 3);
    expect(atRef).toBeCloseTo(0, 3);
  });

  test('Apply keeps the zoom and the panel open', async ({ page }) => {
    await openScale(page);
    const win = await page.evaluate(() => {
      const t = ScaleView.rows.map((r) => r[1] * 1000).sort((a, b) => a - b);
      ScaleView.chart.updateOptions({ dateWindow: [t[10], t[40]] });
      return ScaleView.chart.xAxisRange();
    });
    await openPanel(page);
    await page.click('#dock-panel button:has-text("Apply")');
    await page.waitForTimeout(250);

    const after = await page.evaluate(() => ({
      win: ScaleView.chart.xAxisRange(),
      panel: document.body.classList.contains('panel-mode'),
      corrected: ScaleView.chart.getLabels().includes('Corrected counts'),
    }));
    expect(after.win[0]).toBeCloseTo(win[0], -4);
    expect(after.win[1]).toBeCloseTo(win[1], -4);
    expect(after.panel).toBe(true);
    expect(after.corrected).toBe(true);
  });

  test('only one keg selector is on screen', async ({ page }) => {
    await openScale(page);
    await openPanel(page);

    // The selector above the chart is the one to use; the panel's copy is hidden.
    await expect(page.locator('#scale_keg_select')).toBeVisible();
    await expect(page.locator('#scale_tc_keg')).toBeHidden();
    const visible = await page.evaluate(() => {
      const sels = Array.from(document.querySelectorAll('select'))
        .filter((s) => s.id === 'scale_keg_select' || s.id === 'scale_tc_keg')
        .filter((s) => s.getClientRects().length > 0);
      return sels.map((s) => s.id);
    });
    expect(visible).toEqual(['scale_keg_select']);
  });

  test('zooming the chart refits on the visible slice', async ({ page }) => {
    await openScale(page);
    await openPanel(page);

    // The fixture is one row per 2 minutes; zoom to a tenth of it. This goes
    // through the same path a drag-zoom ends in, which is what fires zoomCallback.
    const before = await page.evaluate(() => ({ count: ScaleView.fitCount, total: ScaleView.rows.length }));
    await page.evaluate(() => {
      const t = ScaleView.rows.map((r) => r[1] * 1000).sort((a, b) => a - b);
      ScaleView.chart.doZoomXDates_(t[10], t[30]);
    });
    await page.waitForTimeout(200);

    const after = await page.evaluate(() => ({
      count: ScaleView.fitCount,
      graphRows: ScaleView.graph.numRows(),
      span: ScaleView.chart.xAxisRange(),
    }));
    expect(after.count).toBeLessThan(before.count);
    expect(after.count).toBeGreaterThan(3);
    // The fit graph shows exactly the points the fit used.
    expect(after.graphRows).toBe(after.count);
  });

  test('Close puts the chart back and drops the panel', async ({ page }) => {    await openScale(page);
    const before = await page.evaluate(() => document.getElementById('div_scale').getBoundingClientRect().height);
    await openPanel(page);
    await page.click('#dock-panel button:has-text("Close")');
    await page.waitForFunction(() => !document.body.classList.contains('panel-mode'));
    const after = await page.evaluate(() => ({
      box: document.getElementById('div_scale').getBoundingClientRect().height,
      graph: ScaleView.chart.height_,
    }));
    expect(after.box).toBeCloseTo(before, 0);
    expect(Math.abs(after.graph - after.box)).toBeLessThan(3);
  });
});
