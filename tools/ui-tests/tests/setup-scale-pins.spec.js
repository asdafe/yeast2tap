import { test, expect } from '@playwright/test';

// GPIO 13, 14 and 18 belong to the rotary encoder in the default ESP32 build, and
// the firmware rejects them for a scale. The two scale defaults (25/26 and 27/33)
// must stay offered, otherwise a second keg scale cannot be saved.

test('scale pins: encoder pins blocked, 25/26 and 27/33 offered', async ({ page }) => {
  await page.goto('/setup.htm');
  await page.waitForFunction(
    () => document.querySelectorAll('#scale-device-list .scale-device-row').length > 0,
  );

  const state = await page.evaluate(() => {
    const out = { encoderSelectable: [], scaleDefaultsSelectable: [], configured: [] };
    const wanted = [25, 26, 27, 33];
    const byPin = {};
    document.querySelectorAll('#scale-device-list .scale-device-row').forEach((row) => {
      ['.scale-dout', '.scale-clock'].forEach((sel) => {
        const select = row.querySelector(sel);
        if (!select) return;
        const value = Number(select.value);
        if (select.value !== '' && value >= 0) out.configured.push(value);
        for (const option of select.options) {
          const pin = Number(option.value);
          if ([13, 14, 18].includes(pin) && !option.disabled) out.encoderSelectable.push(pin);
          if (wanted.includes(pin)) byPin[pin] = !option.disabled;
        }
      });
    });
    out.scaleDefaultsSelectable = wanted.filter((pin) => byPin[pin]);
    return out;
  });

  // Nothing the firmware reserves for the encoder is selectable for a scale.
  expect(state.encoderSelectable).toEqual([]);
  // The documented scale defaults are all selectable again.
  expect(state.scaleDefaultsSelectable).toEqual([25, 26, 27, 33]);
  // The saved assignment is shown unchanged.
  expect(state.configured).toEqual([16, 17]);
});
