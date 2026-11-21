import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { header, periodRecord, TAG, encodeTilt, encodeGravity } from './helpers/logfile.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const viewerPath = path.join(repoRoot, 'htmljs', 'dist', 'english', 'y2tlogviewer.htm');
const viewerUrl = 'file:///' + viewerPath.replace(/\\/g, '/');

// Regression tests for the gravity temperature correction:
//  * the display unit must not decide whether the correction is applied,
//  * a formula copied from the dialog must be the total correction, so pasting
//    it back (or storing it on the device) does not invert it.

const SG_TO_PLATO = (sg) => (((182.4601 * sg - 775.6821) * sg + 1262.7794) * sg - 669.5622);

/** Log where the gravity column is already "raw + applied", as the firmware writes it. */
function correctedLog(applied, rawAt, temps) {
  const data = [];
  data.push(...header({ correction: applied }));
  data.push(TAG.mode, 'F'.charCodeAt(0));
  data.push(TAG.state, 1);
  for (const t of temps) {
    const appliedAt = applied.reduce((s, c, k) => s + c * Math.pow(t, k), 0);
    data.push(...periodRecord({
      beerSet: 20, beerTemp: t, fridgeTemp: 19.5, fridgeSet: 19,
      roomTemp: 21, auxTemp: t, gravity: rawAt(t) + appliedAt,
    }));
  }
  return new Uint8Array(data);
}

/**
 * A calibrating log with three tilt->gravity points, so sgByTilt() exists.
 * The same physical series is encoded in SG or in Plato.
 */
function calibratingLog(plato) {
  const data = [];
  data.push(...header({ calibrating: true, plato }));
  data.push(TAG.mode, 'F'.charCodeAt(0));
  data.push(TAG.state, 1);
  const points = [[20, 1.05], [30, 1.03], [40, 1.01]];
  data.push(TAG.calibration, points.length);
  for (const [tilt, sg] of points) {
    const value = plato ? SG_TO_PLATO(sg) : sg;
    data.push(...encodeTilt(tilt), ...encodeGravity(value, plato));
  }
  for (const tilt of [20, 24, 28, 32, 36, 40]) {
    data.push(...periodRecord({
      beerSet: 20, beerTemp: 20, fridgeTemp: 19.5, fridgeSet: 19,
      roomTemp: 21, auxTemp: tilt, tilt, plato,
    }));
  }
  return new Uint8Array(data);
}

test.describe('gravity temperature correction', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (e) => { throw new Error('page error: ' + e.message); });
    await page.goto(viewerUrl);
    await page.waitForFunction(() => typeof window.BChart !== 'undefined' && window.BChart.chart);
  });

  test('pTempCorrection keeps Plato in Fahrenheit', async ({ page }) => {
    const r = await page.evaluate(() => ({
      f: BrewMath.pTempCorrection(false, 12.4, 68, 68),
      c: BrewMath.pTempCorrection(true, 12.4, 20, 20),
      fChanged: BrewMath.pTempCorrection(false, 12.4, 80, 68),
    }));
    // pla2sg/sg2pla are fits, so the round trip is not bit exact; 1e-3 relative.
    expect(r.f).toBeCloseTo(12.4, 1);
    expect(r.c).toBeCloseTo(12.4, 1);
    // A real correction must move the Plato value, not hand back SG (~1.05).
    expect(r.fChanged).toBeGreaterThan(11);
    expect(Math.abs(r.fChanged - 12.4)).toBeGreaterThan(1e-3);
  });

  test('the same log shows the same curve in SG and Plato', async ({ page }) => {
    // A tilt-derived log: the temperature dependence is already handled by the
    // angle formula, so the SG series must not get a second, unit-dependent
    // correction. Before this fix Plato got one and SG did not.
    const r = await page.evaluate(({ sgBytes, platoBytes }) => {
      const run = (bytes) => {
        const c = new UniBrewChart('div_g');
        c.process(new Uint8Array(bytes));
        if (c.calibrating) {
          c.getFormula();
          c.process(new Uint8Array(bytes));
        }
        return {
          rows: c.data.map((row, i) => ({
            tilt: c.angles[i],
            actual: row[GravityLine],
            mapped: (c.angles[i] == null || !c.sgByTilt) ? null : c.sgByTilt(c.angles[i]),
          })),
          coTemp: c.coTemp,
        };
      };
      return { sg: run(sgBytes), plato: run(platoBytes) };
    }, { sgBytes: Array.from(calibratingLog(false)), platoBytes: Array.from(calibratingLog(true)) });

    const sg = r.sg.rows.filter((row) => row.actual != null);
    const plato = r.plato.rows.filter((row) => row.actual != null);
    expect(sg.length).toBeGreaterThan(2);
    expect(plato.length).toBe(sg.length);

    // Neither unit receives an extra correction: the value is exactly sgByTilt().
    for (const row of sg) expect(row.actual).toBeCloseTo(row.mapped, 6);
    for (const row of plato) expect(row.actual).toBeCloseTo(row.mapped, 6);

    // And the two logs describe the same physical beer.
    for (let i = 0; i < sg.length; i++) {
      const fromPlato = 1 + (plato[i].actual / (258.6 - ((plato[i].actual / 258.2) * 227.1)));
      expect(fromPlato).toBeCloseTo(sg[i].actual, 3);
    }
  });

  test('a copied formula cancels an already-applied correction', async ({ page }) => {
    // The device reading drifts +0.0002 SG per degC around the true 1.050 at 20 C.
    // The firmware's own correction (+0.001 -0.0001 t) only removes half of that
    // slope, so the log still drifts; the fitted formula must remove the rest.
    const applied = [0.001, -0.0001, 0, 0];
    const rawAt = (t) => 1.05 + 0.0002 * (t - 20);
    const temps = [16, 17, 18, 19, 20, 21, 22, 23, 24];
    const bytes = Array.from(correctedLog(applied, rawAt, temps));

    const r = await page.evaluate((logBytes) => {
      window.file = { name: 'test.log' };   // derivetc() refuses to run without one
      BChart.raw = new Uint8Array(logBytes);
      BChart.chart.tcUserApplied = false;
      BChart.chart.tcGravityMode = false;
      BChart.chart.appliedCorrection = null;
      BChart.chart.process(new Uint8Array(logBytes));
      BChart.chart.updateChart();
      const headerApplied = BChart.chart.appliedCorrection;
      openDialog('#tc-graph-dialog');
      derivetc();
      const formula = document.querySelector('#tc_formula').textContent;
      const equation = TC.equation;
      // Apply the copied formula the way a user would: paste, then Update.
      document.querySelector('#update-tc-formula').value = formula;
      update_formula_input();
      const corrected = BChart.chart.data
        .map((row) => row[GravityLine])
        .filter((v) => v != null && !isNaN(v));
      return { headerApplied, formula, equation, corrected };
    }, bytes);

    // The coefficients the device already applied are recognised from the header.
    expect(r.headerApplied).toHaveLength(4);
    expect(r.headerApplied[0]).toBeCloseTo(0.001, 6);

    // The fitted formula is the total correction from the raw reading: slope
    // -0.0002/degC, zero at the 20 C reference. Fitting the logged column without
    // undoing the applied correction would give half that slope instead.
    expect(r.formula).not.toMatch(/[eE]/);
    expect(r.equation[1]).toBeCloseTo(-0.0002, 7);
    expect(r.equation[0]).toBeCloseTo(0.004, 3);

    // Applying it to a log that already contains the correction must not double it.
    expect(r.corrected.length).toBeGreaterThan(2);
    expect(r.corrected[0]).toBeCloseTo(1.05, 4);
    const spread = Math.max(...r.corrected) - Math.min(...r.corrected);
    expect(spread).toBeLessThan(1e-5);
  });
});
