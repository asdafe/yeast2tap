import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const viewerUrl = 'file:///' + path.join(repoRoot, 'htmljs', 'dist', 'english', 'y2tlogviewer.htm').replace(/\\/g, '/');

// The menu used to hide "Create Scale Temperature Correction" unless a scale
// export was already open, which made the feature undiscoverable: the menu
// looked like it only had the gravity correction. It is now always listed.

function scaleExportFile() {
  const rows = [];
  for (let i = 0; i < 8; i++) {
    const temp = 5 + i;
    rows.push([19000 + i, 1700000000 + i * 86400, 18000, 0, 32, 0, Math.round(900000 - 4000 * temp), temp]);
  }
  const file = path.join(repoRoot, 'tools', 'ui-tests', 'artifacts', `menu-scale-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    exportedAt: 'x',
    settings: { scales: [{ id: 0, kegName: 'Keg A' }] },
    records: rows,
  }));
  return file;
}

test.describe('y2tlogviewer menu', () => {  test('offers the scale temperature correction before anything is opened', async ({ page }) => {
    await page.goto(viewerUrl);
    await page.waitForFunction(() => typeof window.BChart !== 'undefined');
    await page.click('.menu-button');

    const item = page.locator('#menu-scale-tc');
    await expect(item).toBeVisible();
    await expect(item).toContainText('Create Scale Temperature Correction');
    // Greyed out, with a hint about what it needs.
    await expect(item).toContainText('open a scale export');
  });

  test('explains what is missing instead of doing nothing', async ({ page }) => {
    await page.goto(viewerUrl);
    await page.waitForFunction(() => typeof window.BChart !== 'undefined');

    const dialogs = [];
    page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss(); });

    await page.click('.menu-button');
    await page.click('#menu-scale-tc');
    await page.waitForTimeout(300);

    expect(dialogs.length).toBe(1);
    expect(dialogs[0]).toContain('Open a scale export first');
    await expect(page.locator('#scale-tc-dialog')).toBeHidden();
  });

  test('opens the dialog once a scale export is loaded', async ({ page }) => {
    await page.goto(viewerUrl);
    await page.waitForFunction(() => typeof window.BChart !== 'undefined');
    await page.setInputFiles('#fileinput', scaleExportFile());
    await page.waitForFunction(() => typeof ScaleView !== 'undefined' && ScaleView.rows.length > 0);

    await page.click('.menu-button');
    await page.click('#menu-scale-tc');

    // The correction is docked, not a modal: controls on the right, fit graph
    // under the chart, and the dialog itself stays hidden.
    await expect(page.locator('#dock-panel #scale_tc_calibration')).toBeVisible();
    await expect(page.locator('#dock-chart-host #scale-tc-graph')).toBeVisible();
    await expect(page.locator('#scale-tc-dialog')).toBeHidden();
    // The fitted correction is drawn: measured and corrected against time, and
    // the corrected one is flat. Columns are Time, Measured, Corrected, Temperature.
    const corrected = await page.evaluate(() => {
      const g = ScaleView.graph;
      const col = g.getLabels().indexOf('Corrected');
      return Array.from({ length: g.numRows() }, (_, r) => g.getValue(r, col))
        .filter((v) => v != null && !isNaN(v));
    });
    expect(corrected.length).toBeGreaterThan(0);
    expect(Math.max(...corrected) - Math.min(...corrected)).toBeLessThan(1);
  });
});
