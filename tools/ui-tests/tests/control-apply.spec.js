import { test, expect } from '@playwright/test';

// The control page's Apply used to send the write and say nothing. It now asks
// the controller for its values ('s' -> 'S:{...}') and reports whether the write
// actually took. These tests drive the mock's 'j'/'s' handling.

async function openControl(page) {
  await page.goto('/control.htm');
  await page.waitForFunction(() => window.BrewPiSetting && BrewPiSetting.valid);
  await page.waitForFunction(() => window.modekeeper && modekeeper.device);
  // The mock starts with control off, so Apply would just send "mode:o".
  if (!(await page.isChecked('#mode-run'))) await page.click('label[for="mode-run"]');
  await page.locator('.seg[data-g="method"] button[data-v="pid"]').click();
  await page.locator('.seg[data-g="what"] button[data-v="beer"]').click();
  await page.locator('.seg[data-g="src"] button[data-v="fixed"]').click();
}

test('Apply reports a write the controller accepted', async ({ page }) => {
  await openControl(page);
  await page.fill('#beer-t', '18.5');
  await page.click('#modekeeper-apply');

  await expect(page.locator('#apply-note')).toHaveText('Applied.');
});

test('Apply reports a write the controller did not take', async ({ page, request }) => {
  await request.get('/__control/ignore-writes?on=1');
  try {
    await openControl(page);
    // A different setpoint, otherwise the page says "No changes to apply.".
    await page.fill('#beer-t', '21.5');
    await page.click('#modekeeper-apply');

    await expect(page.locator('#apply-note')).toHaveText(/^Not applied: .*beer setpoint/, {
      timeout: 8000,
    });
  } finally {
    await request.get('/__control/ignore-writes?on=0');
  }
});

test('Apply stops waiting instead of claiming success', async ({ page, request }) => {
  await request.get('/__control/mute-reads?on=1');
  try {
    await openControl(page);
    await page.fill('#beer-t', '22.5');
    await page.click('#modekeeper-apply');

    await expect(page.locator('#apply-note')).toHaveText('No confirmation from the controller.', {
      timeout: 8000,
    });
  } finally {
    await request.get('/__control/mute-reads?on=0');
  }
});

// Independent mode: the heater pulse-PI fields live behind the predictive switch
// and must be sent with Apply, then confirmed through the 'S' echo.
test('Independent heater pulse-PI panel follows the switch and is applied', async ({ page }) => {
  await page.goto('/control.htm');
  await page.waitForFunction(() => window.BrewPiSetting && BrewPiSetting.valid);
  await page.waitForFunction(() => window.modekeeper && modekeeper.device);
  if (!(await page.isChecked('#mode-run'))) await page.click('label[for="mode-run"]');
  await page.locator('.seg[data-g="method"] button[data-v="ind"]').click();

  // The switch lives inside the collapsible "Heater control (advanced)" section.
  const summary = page.locator('details.ctrl-fold summary').first();
  if (!(await page.locator('details.ctrl-fold').first().evaluate((el) => el.open))) {
    await summary.click();
  }

  // Off is the default: the panel stays closed.
  await expect(page.locator('#ind-pi-panel')).toBeHidden();

  await page.check('#independent-pid-on');
  await expect(page.locator('#ind-pi-panel')).toBeVisible();
  // The device values arrive with the control-constants message.
  await expect(page.locator('#ind-pi-kp')).toHaveValue('20');
  await expect(page.locator('#ind-pi-ki')).toHaveValue('8');
  await expect(page.locator('#ind-pi-pulse')).toHaveValue('1');

  await page.fill('#independent-cool-t', '4');
  await page.fill('#independent-heat-t', '20');
  await page.fill('#ind-pi-kp', '22');
  await page.fill('#ind-pi-ki', '9');
  await page.fill('#ind-pi-pulse', '1.5');
  // The harness blocks POST /tschedule on purpose. Independent Apply saves the
  // profile first, so stub only that call: this test is about the pulse-PI write.
  await page.evaluate(() => { modekeeper.postProfile = (extra, done) => done(true); });
  await page.click('#modekeeper-apply');

  await expect(page.locator('#apply-note')).toHaveText('Applied.');
});

// The reported bug: changing only the cooler setpoint in Independent mode sent
// the write, the controller stored it, but the page still said "fridge setpoint
// did not stick" because it read the wrong key from the 'S' echo.
test('Independent cooler-only Apply is confirmed through the S echo', async ({ page }) => {
  await page.goto('/control.htm');
  await page.waitForFunction(() => window.BrewPiSetting && BrewPiSetting.valid);
  await page.waitForFunction(() => window.modekeeper && modekeeper.device);
  if (!(await page.isChecked('#mode-run'))) await page.click('label[for="mode-run"]');
  await page.locator('.seg[data-g="method"] button[data-v="ind"]').click();

  await page.fill('#independent-cool-t', '4');
  await page.fill('#independent-heat-t', '20');
  await page.click('#modekeeper-apply');
  await expect(page.locator('#apply-note')).toHaveText('Applied.');

  // Now only the cooler changes; the heater stays where it was.
  await page.fill('#independent-cool-t', '5.5');
  await page.click('#modekeeper-apply');
  await expect(page.locator('#apply-note')).toHaveText('Applied.');
});
