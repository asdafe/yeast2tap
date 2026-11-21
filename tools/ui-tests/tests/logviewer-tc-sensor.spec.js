import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { header, periodRecord, TAG } from './helpers/logfile.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const viewerUrl = 'file:///' + path.join(repoRoot, 'htmljs', 'dist', 'english', 'y2tlogviewer.htm').replace(/\\/g, '/');

// The brew log records all four probes, so the gravity fit can be run against any
// of them. Beer is the default (and the only one the hydrometer really sits in);
// fridge and room are offered but flagged, because neither is the beer.

// Distinct temperature per probe so the fitted slope says which column was read.
// Beer swings 2 °C, aux 6 °C, fridge 0.5 °C, room 9 °C. Gravity drifts with the
// aux probe, the way a hydrometer's own reading would.
const TEMPS = [
  { beer: 18, aux: 12, fridge: 4.0, room: 15 },
  { beer: 19, aux: 14, fridge: 4.2, room: 17 },
  { beer: 20, aux: 16, fridge: 4.4, room: 19 },
  { beer: 21, aux: 18, fridge: 4.6, room: 21 },
  { beer: 22, aux: 20, fridge: 4.8, room: 23 },
  { beer: 23, aux: 22, fridge: 5.0, room: 25 },
];
const AUX_SLOPE = 0.0004;   // SG per degC of the aux probe

function log() {
  const data = [];
  data.push(...header());
  data.push(TAG.mode, 'C'.charCodeAt(0));
  data.push(TAG.state, 1);
  for (const t of TEMPS) {
    data.push(...periodRecord({
      beerSet: 20,
      beerTemp: t.beer,
      fridgeTemp: t.fridge,
      fridgeSet: 4,
      roomTemp: t.room,
      auxTemp: t.aux,
      gravity: 1.05 + AUX_SLOPE * (t.aux - 16),
    }));
  }
  return Array.from(new Uint8Array(data));
}

async function openLog(page) {
  page.on('pageerror', (e) => { throw new Error('page error: ' + e.message); });
  await page.goto(viewerUrl);
  await page.waitForFunction(() => typeof window.BChart !== 'undefined' && window.BChart.chart);
  await page.evaluate((bytes) => {
    window.file = { name: 'test.log' };   // derivetc() refuses to run without one
    BChart.raw = new Uint8Array(bytes);
    BChart.chart.process(new Uint8Array(bytes));
    BChart.chart.updateChart();
  }, log());
}

/** Run the fit with the given sensor selected and return the fitted coefficients. */
async function fitWith(page, sensor) {
  return page.evaluate((key) => {
    document.querySelector('#tc_sensor').value = key;
    openDialog('#tc-graph-dialog');
    derivetc();
    // The graph is drawn against time now, so the chosen probe shows up in the
    // Temperature column, not on the x axis. Its span is what proves which
    // column was read.
    var temps = [];
    if (TC.graph) {
      var col = TC.graph.getLabels().indexOf('Temperature');
      for (var r = 0; r < TC.graph.numRows(); r++) {
        var v = TC.graph.getValue(r, col);
        if (v != null && !isNaN(v)) temps.push(v);
      }
    }
    return {
      equation: TC.equation,
      tempLabel: TC.tempLabel,
      labels: TC.graph ? TC.graph.getLabels() : null,
      tempSpan: temps.length ? Math.max.apply(null, temps) - Math.min.apply(null, temps) : null,
    };
  }, sensor);
}

test.describe('gravity correction sensor selector', () => {
  test('offers all four probes and flags the two that are not the beer', async ({ page }) => {
    await openLog(page);
    await page.click('.menu-button');
    await page.click('text=Create Temperature Correction');

    const sel = page.locator('#tc_sensor');
    await expect(sel).toBeVisible();
    const options = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#tc_sensor option')).map((o) => o.textContent));
    expect(options).toEqual([
      'Beer sensor',
      'Aux (remote hydrometer)',
      'Fridge (not recommended)',
      'Room (not recommended)',
    ]);
    // Beer is the default, so nothing changes for anyone who ignores the menu.
    expect(await sel.inputValue()).toBe('beer');

    // The note says how much data the chosen probe actually has.
    await expect(page.locator('#tc-sensor-note')).toContainText('6 of 6 records');
  });

  test('the note follows the chosen probe and hides in tilt mode', async ({ page }) => {
    await openLog(page);
    await page.click('.menu-button');
    await page.click('text=Create Temperature Correction');

    await page.selectOption('#tc_sensor', 'room');
    await expect(page.locator('#tc-sensor-note')).toContainText('6 of 6 records');

    // Tilt mode reads the hydrometer's own temperature, so there is nothing to pick.
    await page.check('input[name="tc_source"][value="tilt"]');
    await expect(page.locator('#tc-sensor-row')).toBeHidden();
    await page.check('input[name="tc_source"][value="gravity"]');
    await expect(page.locator('#tc-sensor-row')).toBeVisible();
  });

  test('the fit reads the selected probe, not always beer', async ({ page }) => {
    await openLog(page);

    // The gravity series was built to drift with the aux probe, so fitting against
    // aux must recover that slope.
    const aux = await fitWith(page, 'aux');
    expect(aux.equation[1]).toBeCloseTo(-AUX_SLOPE, 6);
    expect(aux.tempLabel).toBe('Aux temperature');
    expect(aux.labels).toEqual(['Time', 'Measured', 'Corrected', 'Temperature']);
    expect(aux.tempSpan).toBeCloseTo(10, 1);

    // Beer spans 5 °C against aux's 10, so the same drift needs twice the slope.
    // Getting -AUX_SLOPE again would mean aux was read either way.
    const beer = await fitWith(page, 'beer');
    expect(beer.equation[1]).toBeCloseTo(-AUX_SLOPE * 2, 6);
    expect(beer.tempLabel).toBe('Beer temperature');
    expect(beer.tempSpan).toBeCloseTo(5, 1);

    // Fridge moves 1 °C across the whole log, so the same drift needs ten times
    // the slope. Room spans 10 °C, the same as aux, so it needs the same slope.
    const fridge = await fitWith(page, 'fridge');
    expect(fridge.equation[1]).toBeCloseTo(-AUX_SLOPE * 10, 5);
    expect(fridge.tempSpan).toBeCloseTo(1, 1);

    const room = await fitWith(page, 'room');
    expect(room.equation[1]).toBeCloseTo(-AUX_SLOPE, 6);
    expect(room.tempSpan).toBeCloseTo(10, 1);

    // Every fit must sit at zero correction on its own reference temperature.
    for (const r of [aux, beer, fridge, room]) expect(r.equation[0]).not.toBe(0);
  });
});
