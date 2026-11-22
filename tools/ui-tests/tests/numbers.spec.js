import { test, expect } from '@playwright/test';

// Every number that leaves the browser carries a dot. A comma is rejected with a
// message, never converted. These tests run against the local harness; they prove
// the browser half of the rule. The firmware half is NumberParse (see src/).

const PAGES = [
  '/',
  '/control.htm',
  '/logging.htm',
  '/setup.htm',
  '/scale.htm',
  '/config.htm',
  '/gravity.htm',
  '/pressure.htm',
];

// Capture the browser dialogs so a rejection does not hang the test, and keep the
// texts for assertions.
function watchDialogs(page) {
  const messages = [];
  page.on('dialog', async (dialog) => {
    messages.push(dialog.message());
    await dialog.dismiss();
  });
  return messages;
}

// Intercept a write endpoint so the payload can be inspected without touching the
// mock controller (the harness answers 403 for hardware writes).
async function capturePosts(page, pattern) {
  const bodies = [];
  await page.route(pattern, async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      bodies.push(request.postData() || '');
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    await route.continue();
  });
  return bodies;
}

function formData(body) {
  return JSON.parse(new URLSearchParams(body).get('data'));
}

test.describe('central number module', () => {
  test('Num is loaded and usable on every page', async ({ page }) => {
    for (const url of PAGES) {
      await page.goto(url);
      const state = await page.evaluate(() => ({
        type: typeof Num,
        dot: Num.parse('2.75'),
        comma: Num.parse('2,75'),
      }));
      expect(state, url).toEqual({ type: 'object', dot: 2.75, comma: null });
    }
  });

  test('parse, fmt and round follow the dot convention', async ({ page }) => {
    await page.goto('/scale.htm');
    const result = await page.evaluate(() => ({
      plain: Num.parse('2.75'),
      leadingDot: Num.parse('.5'),
      exponent: Num.parse('1e-3'),
      negative: Num.parse('-4.5'),
      padded: Num.parse('  7.25  '),
      comma: Num.parse('2,75'),
      twoDots: Num.parse('2.7.5'),
      trailing: Num.parse('2.75 kg'),
      empty: Num.parse(''),
      garbage: Num.parse('abc'),
      fmt: Num.fmt(2.5, 2),
      fmtMissing: Num.fmt(null),
      round: Num.round(2.346, 2),
      roundMissing: Num.round(undefined),
    }));
    expect(result).toEqual({
      plain: 2.75,
      leadingDot: 0.5,
      exponent: 0.001,
      negative: -4.5,
      padded: 7.25,
      comma: null,
      twoDots: null,
      trailing: null,
      empty: null,
      garbage: null,
      fmt: '2.50',
      fmtMissing: '--',
      round: 2.35,
      roundMissing: null,
    });
  });

  test('guard marks a comma as soon as it is typed in a numeric field', async ({ page }) => {
    await page.goto('/scale.htm');
    const field = page.locator('#capacity-liters');
    await field.fill('18,5');
    await expect(field).toHaveClass(/num-bad/);
    await field.fill('18.5');
    await expect(field).not.toHaveClass(/num-bad/);
  });
});

test.describe('scale page', () => {
  test('a comma is rejected and a dot is sent as a number', async ({ page }) => {
    const dialogs = watchDialogs(page);
    const posts = await capturePosts(page, '**/scale');
    await page.goto('/scale.htm');
    await page.waitForFunction(() => window.ScalePage && ScalePage.settings);

    await page.fill('#capacity-liters', '18,5');
    await page.click('#save-keg');
    expect(posts).toHaveLength(0);
    expect(dialogs.join('\n')).toContain('dot');
    // The comma is kept as typed: it is never rewritten into a dot.
    await expect(page.locator('#capacity-liters')).toHaveValue('18,5');
    await expect(page.locator('#capacity-liters')).toHaveClass(/num-bad/);

    await page.fill('#capacity-liters', '18.5');
    await page.fill('#beer-density', '1.012');
    await page.click('#save-keg');
    await expect.poll(() => posts.length).toBe(1);
    const payload = formData(posts[0]);
    expect(payload.scales[0].capacityMl).toBe(18500);
    expect(payload.scales[0].beerDensityKgPerL).toBe(1.012);
    // Let the post-save reload finish before the next interaction, so the page
    // cannot overwrite the field from the fixture mid-test.
    await expect.poll(() => dialogs.length).toBeGreaterThan(0);
  });

  test('known weight for calibration is a number', async ({ page }) => {
    const dialogs = watchDialogs(page);
    const posts = await capturePosts(page, '**/scale');
    await page.goto('/scale.htm');
    await page.waitForFunction(() => window.ScalePage && ScalePage.settings);

    await page.fill('#known-weight', '1,5');
    await page.click('#calibrate-button');
    expect(posts).toHaveLength(0);
    expect(dialogs.join('\n')).toContain('dot');

    await page.fill('#known-weight', '1500');
    await page.click('#calibrate-button');
    await expect.poll(() => posts.length).toBe(1);
    expect(formData(posts[0]).knownWeightGrams).toBe(1500);
  });
});

test.describe('config page', () => {
  test('numeric settings must be dot numbers', async ({ page }) => {
    const dialogs = watchDialogs(page);
    const posts = await capturePosts(page, '**/config*');
    await page.goto('/config.htm');
    await page.waitForFunction(() => document.querySelector('input[name=aoff]').value !== '');

    await page.fill('input[name=aoff]', '15,5');
    await page.click('#submitsave');
    expect(posts).toHaveLength(0);
    expect(dialogs.join('\n')).toContain('dot');
    await expect(page.locator('input[name=aoff]')).toHaveClass(/num-bad/);

    await page.fill('input[name=aoff]', '16');
    await page.click('#submitsave');
    await expect.poll(() => posts.length).toBe(1);
    expect(formData(posts[0]).aoff).toBe(16);
  });

  // The page has a Save button in the header and another one in the bottom save
  // bar. Both must post; the bottom one used to be a plain submit button on a
  // form whose onsubmit returns false, so it did nothing.
  test('the bottom Save button posts the settings too', async ({ page }) => {
    const posts = await capturePosts(page, '**/config*');
    await page.goto('/config.htm');
    await page.waitForFunction(() => document.querySelector('input[name=aoff]').value !== '');

    await page.fill('input[name=aoff]', '17');
    await page.click('.cfg-save-bar button[type=submit]');
    await expect.poll(() => posts.length).toBe(1);
    expect(formData(posts[0]).aoff).toBe(17);
  });
});

test.describe('pressure page', () => {
  test('coefficients must be dot numbers', async ({ page }) => {
    const dialogs = watchDialogs(page);
    const posts = await capturePosts(page, '**/psi');
    await page.goto('/pressure.htm');
    await page.waitForFunction(() => document.querySelector('#fpa').value !== '');

    await page.fill('#fpa', '12,5');
    await page.evaluate(() => PCTRL.apply());
    expect(posts).toHaveLength(0);
    expect(dialogs.join('\n')).toContain('dot');
    await expect(page.locator('#fpa')).toHaveClass(/num-bad/);

    await page.fill('#fpa', '12.5');
    await page.evaluate(() => PCTRL.apply());
    await expect.poll(() => posts.length).toBe(1);
    const payload = formData(posts[0]);
    expect(payload.a).toBe(12.5);
    expect(typeof payload.b).toBe('number');
  });
});

test.describe('gravity page', () => {
  test('numeric hydrometer settings are dot numbers', async ({ page }) => {
    const dialogs = watchDialogs(page);
    const posts = await capturePosts(page, '**/gdc');
    await page.goto('/gravity.htm');
    await page.waitForFunction(() => document.querySelector('input[name=off]').value !== '');
    await page.fill('input[name=off]', '0,5');
    await page.evaluate(() => save());
    expect(posts).toHaveLength(0);
    expect(dialogs.join('\n')).toContain('dot');
    await expect(page.locator('input[name=off]')).toHaveClass(/num-bad/);

    await page.fill('input[name=off]', '0.5');
    await page.evaluate(() => save());
    await expect.poll(() => posts.length).toBe(1);
    const payload = JSON.parse(posts[0]);
    expect(payload.off).toBe(0.5);
    expect(typeof payload.stpt).toBe('number');
    expect(typeof payload.lpc).toBe('number');
  });

  test('a calibration point refuses a comma', async ({ page }) => {
    const dialogs = watchDialogs(page);
    await page.goto('/gravity.htm');
    await page.waitForFunction(() => typeof TCEditor !== 'undefined');
    await page.evaluate(() => { TCEditor.points = []; TCEditor.render(); });
    await page.click('#addbutton');
    await expect(page.locator('#dlg_addcalpoint')).toBeVisible();

    await page.fill('#uncalvalue', '1,5');
    await page.fill('#calvalue', '1.010');
    await page.click('#btn-addcal');
    expect(dialogs.join('\n')).toContain('dot');
    expect(await page.evaluate(() => TCEditor.points.length)).toBe(0);

    await page.fill('#uncalvalue', '1.5');
    await page.click('#btn-addcal');
    expect(await page.evaluate(() => TCEditor.points.length)).toBe(1);
  });
});

test.describe('easy ramp', () => {
  test('computes, rejects a comma and saves real numbers', async ({ page }) => {
    const dialogs = watchDialogs(page);
    const posts = await capturePosts(page, '**/tschedule');
    await page.goto('/control.htm');
    await page.waitForFunction(() => typeof BrewPiSetting !== 'undefined');
    await page.evaluate(() => { BrewPiSetting.valid = true; });

    await page.locator('.seg[data-g="method"] button[data-v="ind"]').click();
    await page.locator('#beer-set').check();
    await page.fill('#independent-heat-t', '18.5');
    await page.click('#easybtn');
    await expect(page.locator('#dlg_easy')).toBeVisible();

    await expect(page.locator('#er-to')).toHaveValue('21.5');
    await expect(page.locator('#er-sum')).toContainText('18.5 → 21.5 °C over 3 days');

    await page.fill('#er-to', '2,5');
    await expect(page.locator('#er-err')).not.toHaveText('');
    await expect(page.locator('#er-save')).toBeDisabled();
    await expect(page.locator('#er-to')).toHaveClass(/num-bad/);

    await page.fill('#er-to', '20.25');
    await page.fill('#er-days', '2.5');
    await expect(page.locator('#er-err')).toHaveText('');
    await expect(page.locator('#er-sum')).toContainText('20.3 °C over 2.5 days');
    await expect(page.locator('#er-save')).toBeEnabled();

    await page.click('#er-save');
    if (await page.locator('#dlg_replace').isVisible()) await page.click('#rep-ok');
    await expect.poll(() => posts.length).toBe(1);
    const profile = formData(posts[0]);
    expect(profile.t).toEqual([
      { c: 't', d: 0, t: 18.5 },
      { c: 'r', d: 2.5 },
      { c: 't', d: 1, t: 20.25 },
    ]);
    expect(dialogs.join('\n')).not.toContain('dot');
  });

  test('gravity start sends the SG as a number', async ({ page }) => {
    const dialogs = watchDialogs(page);
    const posts = await capturePosts(page, '**/tschedule');
    await page.goto('/control.htm');
    await page.waitForFunction(() => typeof BrewPiSetting !== 'undefined');
    await page.evaluate(() => { BrewPiSetting.valid = true; });

    await page.locator('.seg[data-g="method"] button[data-v="ind"]').click();
    await page.locator('#beer-set').check();
    await page.fill('#independent-heat-t', '18.5');
    await page.click('#easybtn');
    await page.locator('input[name=erstart][value="gravity"]').check();

    await page.fill('#er-sg', '1,018');
    await expect(page.locator('#er-save')).toBeDisabled();

    await page.fill('#er-sg', '1.018');
    await expect(page.locator('#er-save')).toBeEnabled();
    await page.click('#er-save');
    if (await page.locator('#dlg_replace').isVisible()) await page.click('#rep-ok');
    await expect.poll(() => posts.length).toBe(1);
    const first = formData(posts[0]).t[0];
    expect(first.c).toBe('g');
    expect(first.g).toBe(1.018);
    expect(dialogs.join('\n')).not.toContain('dot');
  });
});

test('dashboard OG box turns 1050 into 1.050, SG box does not', async ({ page }) => {
  const dialogs = watchDialogs(page);
  const posts = await capturePosts(page, '**/gravity');
  await page.goto('/');
  await page.waitForFunction(() => typeof inputOG === 'function');

  await page.evaluate(() => inputOG());
  await page.locator('#dlg_addgravity input.sginput').first().fill('1050');
  await page.evaluate(() => inputgravity());
  await expect.poll(() => posts.length).toBe(1);
  expect(JSON.parse(posts[0])).toMatchObject({ gravity: 1.05, og: 1 });

  await page.evaluate(() => inputSG());
  await page.locator('#dlg_addgravity input.sginput').first().fill('1050');
  await page.evaluate(() => inputgravity());
  expect(posts).toHaveLength(1);
  expect(dialogs.join('\n')).toContain('invalid');
});

for (const locale of ['tr-TR', 'de-DE']) {
  test.describe(`locale ${locale}`, () => {
    test.use({ locale });

    test('the browser language does not change the decimal separator', async ({ page }) => {
      const dialogs = watchDialogs(page);
      const posts = await capturePosts(page, '**/scale');
      await page.goto('/scale.htm');
      await page.waitForFunction(() => window.ScalePage && ScalePage.settings);

      await page.fill('#capacity-liters', '18.5');
      await page.fill('#empty-keg', '4000');
      await page.click('#save-keg');
      await expect.poll(() => posts.length).toBe(1);
      expect(formData(posts[0]).scales[0].capacityMl).toBe(18500);
      // Wait for the post-save reload alert, otherwise that reload can rewrite
      // the field from the fixture while the comma test is running.
      await expect.poll(() => dialogs.length).toBe(1);

      await page.fill('#capacity-liters', '18,5');
      await page.click('#save-keg');
      await expect(page.locator('#capacity-liters')).toHaveClass(/num-bad/);
      await expect.poll(() => dialogs.length).toBe(2);
      expect(posts).toHaveLength(1);
    });
  });
}
