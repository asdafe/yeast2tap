import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calibratingLog } from './helpers/logfile.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const viewerUrl =
  'file:///' + path.join(repoRoot, 'htmljs', 'dist', 'english', 'y2tlogviewer.htm').replace(/\\/g, '/');

// The temperature-correction dialog fits a polynomial to (temperature, reading)
// pairs taken from the visible range. Two things used to go wrong:
//   - the device temperature is only logged when it changed, and a missing value
//     was fitted as 0 degC (regression evaluates Math.pow(null, n) === 0);
//   - points were passed in time order, so a temperature that wanders up and
//     down drew a zig-zag instead of a parabola.

const TILTS = [20.0, 20.4, 20.8, 21.2, 21.6, 22.0];

function sparseAuxLog() {
  // Device temperature present on the 1st, 3rd and 5th record only.
  return calibratingLog({
    rows: TILTS.map((tilt, i) => ({ tilt, aux: i % 2 === 0 ? 10 + i : undefined })),
  });
}

async function openLog(page, bytes, mode = 'tilt') {
  await page.goto(viewerUrl);
  await page.waitForFunction(() => typeof window.BChart !== 'undefined' && window.BChart.chart);
  await page.evaluate(
    ({ bytes: data, mode: source }) => {
      window.file = { name: 'test.log' };
      BChart.raw = new Uint8Array(data);
      BChart.chart.process(BChart.raw);
      if (BChart.chart.calibrating) {
        // Same path as loaded(): build the tilt->SG formula, then re-process.
        BChart.chart.getFormula();
        BChart.chart.process(BChart.raw);
      }
      BChart.chart.updateChart();
      document.querySelector(`input[name="tc_source"][value="${source}"]`).checked = true;
    },
    { bytes: Array.from(bytes), mode },
  );
}

test.describe('temperature correction dialog', () => {
  test('skips records without a device temperature', async ({ page }) => {
    await openLog(page, sparseAuxLog());
    const result = await page.evaluate(() => {
      derivetc();
      return {
        points: TC.data,
        angleRows: BChart.chart.angles.filter((a) => a != null).length,
        nulls: TC.data.filter((p) => p[0] == null || isNaN(p[0])).length,
      };
    });

    // Six angles exist, but only three records carry a usable temperature.
    expect(result.angleRows).toBe(TILTS.length);
    expect(result.points.length).toBe(3);
    expect(result.nulls).toBe(0);
    expect(result.points.map((p) => p[0])).toEqual([10, 12, 14]);
  });

  test('orders the fitted points by temperature', async ({ page }) => {
    await openLog(page, sparseAuxLog());
    const xs = await page.evaluate(() => {
      derivetc();
      return TC.data.map((p) => p[0]);
    });
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });

  test('refuses to fit when too few usable points remain', async ({ page }) => {
    // Only one record has a device temperature, so nothing can be fitted.
    await openLog(
      page,
      calibratingLog({ rows: TILTS.map((tilt, i) => ({ tilt, aux: i === 0 ? 10 : undefined })) }),
    );
    const shown = await page.evaluate(() => {
      let message = null;
      window.alert = (text) => {
        message = text;
      };
      derivetc();
      return message;
    });
    expect(shown).toContain('Not enough');
  });

  test('draws measured and corrected against time', async ({ page }) => {
    await openLog(page, sparseAuxLog());
    const result = await page.evaluate(() => {
      derivetc();
      const rows = TC.graph.rawData_;
      const f = TC.equation;
      // Columns: Time, Measured, Corrected, Temperature. Corrected uses the
      // temperature column, not the x value: the x axis is time now.
      return {
        labels: TC.graph.getLabels(),
        rowCount: rows.length,
        xs: rows.map((r) => r[0]),
        correctedOk: rows.every((r) => {
          const expected = r[1] + f[0] + f[1] * r[3] + f[2] * r[3] * r[3] + f[3] * r[3] * r[3] * r[3];
          return Math.abs(r[2] - expected) < 1e-9;
        }),
        // The correction must be zero at the temperature the target resolves to.
        zeroAtReference: Math.abs(
          f[0] + f[1] * TC.refTemp + f[2] * TC.refTemp * TC.refTemp
            + f[3] * TC.refTemp * TC.refTemp * TC.refTemp,
        ) < 1e-6,
        refTemp: TC.refTemp,
      };
    });

    expect(result.labels).toEqual(['Time', 'Measured', 'Corrected', 'Temperature']);
    expect(result.xs).toEqual([...result.xs].sort((a, b) => a - b));
    expect(result.correctedOk).toBe(true);
    expect(result.zeroAtReference).toBe(true);
  });

  test('redraws when the target reading changes', async ({ page }) => {
    await openLog(page, sparseAuxLog());
    const result = await page.evaluate(() => {
      derivetc();
      const before = {
        formula: Q('#tc_formula').textContent,
        // Columns: Time, Measured, Corrected, Temperature.
        column: TC.graph.rawData_.map((r) => r[2]),
      };
      // The box holds a reading now, not a temperature: ask for the value the fit
      // gives at 25 units of temperature, which is a different anchor from the
      // default one and still inside the data.
      Q('#tc_calibration').value = TC.f_p2(25).toFixed(5);
      update_formula();
      return {
        before,
        afterFormula: Q('#tc_formula').textContent,
        afterColumn: TC.graph.rawData_.map((r) => r[2]),
      };
    });

    expect(result.afterFormula).not.toBe(result.before.formula);
    expect(result.afterColumn).not.toEqual(result.before.column);
  });

  test('uses the last known device temperature instead of 0 degC', async ({ page }) => {
    // Calibration points make sgByTilt() available. A temperature-dependent
    // correction distinguishes the two failures: carrying the last received
    // device temperature forward (what the firmware does with _auxTemp) versus
    // reading a missing value as 0 degC, which ttc(0) turns into "no change".
    const log = calibratingLog({
      points: [
        [20, 1.0],
        [21, 1.01],
        [22, 1.02],
        [23, 1.03],
      ],
      rows: [
        { tilt: 21, aux: 20, raw: 1.01 },
        { tilt: 22, aux: undefined, raw: 1.02 },
        { tilt: 23, aux: 22, raw: 1.03 },
      ],
    });
    await openLog(page, log, 'tilt');

    const corrected = await page.evaluate(() => {
      BChart.setTemperatureCorrection([0, 0.01, 0, 0]);
      const out = [];
      for (let i = 0; i < BChart.chart.data.length; i++) {
        const tilt = BChart.chart.angles[i];
        out.push({
          tilt,
          aux: BChart.chart.data[i][AuxTempLine],
          sg: BChart.chart.data[i][GravityLine],
          at20: BChart.chart.sgByTilt(tilt + 0.2),
          at22: BChart.chart.sgByTilt(tilt + 0.22),
          noCorrection: BChart.chart.sgByTilt(tilt),
        });
      }
      return out;
    });

    const [first, missing, last] = corrected;
    expect(first.aux).toBeCloseTo(20, 6);
    expect(missing.aux == null || isNaN(missing.aux)).toBe(true);
    expect(last.aux).toBeCloseTo(22, 6);

    // Records with a temperature use their own value.
    expect(first.sg).toBeCloseTo(first.at20, 6);
    expect(last.sg).toBeCloseTo(last.at22, 6);
    // The record without one reuses the previous device temperature (20 C), and
    // must not silently fall back to 0 C (which would apply no correction).
    expect(missing.sg).toBeCloseTo(missing.at20, 6);
    expect(Math.abs(missing.sg - missing.noCorrection)).toBeGreaterThan(0.001);
  });
});
