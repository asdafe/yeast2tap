import { test, expect } from '@playwright/test';

// The Device page is for wiring and calibration; its scale row must show the raw
// HX711 counts, not derived grams, even once the scale is calibrated.
test('device page shows raw counts after calibration', async ({ page }) => {
  await page.goto('/setup.htm');
  await page.waitForFunction(() => typeof window.scaleLiveText === 'function');

  const texts = await page.evaluate(() => {
    const base = {
      configured: true,
      state: 3,
      calibrated: true,
      rawCounts: 8123,
      grossGrams: 16400,
    };
    return {
      calibrated: scaleLiveText({ use: true }, base),
      uncalibrated: scaleLiveText({ use: true }, { ...base, calibrated: false, rawCounts: 9001 }),
      disabled: scaleLiveText({ use: false }, base),
      noSignal: scaleLiveText({ use: true }, { ...base, state: 5 }),
    };
  });

  expect(texts.calibrated).toBe('8123 raw counts');
  expect(texts.uncalibrated).toBe('9001 raw counts');
  expect(texts.disabled).toBe('Scale disabled');
  expect(texts.noSignal).toContain('No signal');
});
