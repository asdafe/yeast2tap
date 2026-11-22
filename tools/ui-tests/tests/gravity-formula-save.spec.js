import { test, expect } from '@playwright/test';

// The hydrometer page must not wipe the temperature-correction coefficients.
//
// /gdc saves from this page carry many unrelated fields; only the save that
// edited the formula (or changed what the numbers mean) may send ttce and
// ttceunit. The firmware deletes the four coefficients when the tag changes, so
// an extra tag on an ordinary save used to zero the formula the user typed.
//
// POST bodies are captured with page.route because the mock server runs in its
// own process (the pattern scale-sampling.spec.js uses).

async function openGravity(page, bodies) {
  await page.route('**/gdc', async (route) => {
    if (route.request().method() === 'POST') {
      bodies.push(JSON.parse(route.request().postData() || 'null'));
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    } else {
      await route.continue();
    }
  });
  await page.goto('/gravity.htm');
  await expect(page.locator('#tilt-correction-formula')).toHaveValue(/t/);
  await expect(page.locator('input[name="off"]')).toHaveValue('0');
}

test.describe('hydrometer settings save', () => {
  test('a changed formula is sent with the SG tag when the curve is off', async ({ page }) => {
    const bodies = [];
    await openGravity(page, bodies);
    await page.fill('#tilt-correction-formula', '0.004 + 0.002*t');
    await page.click('button:has-text("Save")');

    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0].ttce).toEqual([0.004, 0.002, 0, 0]);
    expect(bodies[0].ttceunit).toBe(1); // cal is off -> SG coefficients
  });

  test('an untouched formula is not re-sent, so it cannot be retagged', async ({ page }) => {
    const bodies = [];
    await openGravity(page, bodies);

    // First save writes the formula.
    await page.fill('#tilt-correction-formula', '0.004 + 0.002*t');
    await page.click('button:has-text("Save")');
    await expect.poll(() => bodies.length).toBe(1);

    // Second save changes an unrelated field only.
    await page.fill('input[name="off"]', '0.006');
    await page.click('button:has-text("Save")');
    await expect.poll(() => bodies.length).toBe(2);

    expect(bodies[1].off).toBe(0.006);
    expect(bodies[1]).not.toHaveProperty('ttce');
    expect(bodies[1]).not.toHaveProperty('ttceunit');
  });

  test('the fitted curve is sent with the points', async ({ page }) => {
    const bodies = [];
    await openGravity(page, bodies);

    await page.click('button:has-text("Edit points")');
    await page.fill('#uncalvalue', '20');
    await page.fill('#calvalue', '1.050');
    await page.click('#btn-addcal');
    await page.fill('#uncalvalue', '30');
    await page.fill('#calvalue', '1.030');
    await page.click('#btn-addcal');
    await page.click('button:has-text("OK")');

    await page.click('button:has-text("Save")');
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0].gcce).toHaveLength(4);
    expect(Number.isFinite(bodies[0].gcce[1])).toBe(true);
  });
});

// The coefficients describe the tilt angle only when the calibration curve turns
// an angle into SG. A GravityMon/iSpindel sends SG, so its polynomial must stay
// SG-tagged even while "Calculated by yeast2tap" is off. Tagging it as an angle
// silently disables the formula — that is what happened on the real device.
const STORED_AS_ANGLE = {
  dev: 1, plato: 0, off: 0.01, lpc: 0.1, stpt: 1, a0: 0, a1: 1, a2: 0, a3: 0,
  cal: 0, tc: 1, gravitymon: 1, gravitymondetected: 1,
  ttce: [0.00521886, -0.000175383, -0.000032452, 1.201868258e-6],
  ttceunit: 2,
  calpts: [],
};

async function openMisTagged(page, bodies) {
  await page.route('**/gdc?data**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STORED_AS_ANGLE) }));
  await page.route('**/gdc', async (route) => {
    if (route.request().method() === 'POST') {
      bodies.push(JSON.parse(route.request().postData() || 'null'));
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    } else {
      await route.continue();
    }
  });
  await page.goto('/gravity.htm');
  await expect(page.locator('#formula-unit-note')).toContainText('not being corrected');
}

test.describe('correction basis follows the device', () => {
  test('warns that angle-tagged coefficients do not correct SG', async ({ page }) => {
    await openMisTagged(page, []);
    await expect(page.locator('#formula-unit-note')).toHaveClass(/is-warn/);
  });

  test('saving an SG device retags the coefficients as SG', async ({ page }) => {
    const bodies = [];
    await openMisTagged(page, bodies);
    await page.click('button:has-text("Save")');
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0].ttceunit).toBe(1);
    expect(bodies[0].ttce[0]).toBeCloseTo(0.00521886, 9);
  });
});
