import { test, expect } from '@playwright/test';

// The room sensor card on the dashboard shows a label the user may rename. Only
// that text changes: no button, no extra field, and the sensor, its mapping and
// the Beer/Fridge labels stay exactly as they were.

const DEFAULT_LABEL = 'Ferm. Chamber';

function watchDialogs(page) {
  const messages = [];
  page.on('dialog', async (dialog) => {
    messages.push(dialog.message());
    await dialog.dismiss();
  });
  return messages;
}

async function captureNotePosts(page) {
  const bodies = [];
  await page.route('**/notes', async (route) => {
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

function noteBody(raw) {
  return JSON.parse(new URLSearchParams(raw).get('data'));
}

test.beforeEach(async ({ request }) => {
  // Each test starts from a dashboard with no saved label.
  await request.post('/notes', {
    data: 'data=' + encodeURIComponent(JSON.stringify({ room: '' })),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
});

test('the room card starts with the default label and keeps its styling', async ({ page }) => {
  watchDialogs(page);
  await page.goto('/');
  const label = page.locator('#room-name');
  await expect(label).toHaveText(DEFAULT_LABEL);
  await expect(label).not.toHaveAttribute('contenteditable', 'true');
});

test('a double click edits the label in place and saves it', async ({ page }) => {
  const dialogs = watchDialogs(page);
  const posts = await captureNotePosts(page);
  await page.goto('/');

  const label = page.locator('#room-name');
  const style = await label.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      color: s.color,
      letterSpacing: s.letterSpacing,
    };
  });

  await label.dblclick();
  await expect(label).toHaveAttribute('contenteditable', 'true');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Cellar 2');
  await page.keyboard.press('Enter');

  await expect(label).toHaveText('Cellar 2');
  await expect(label).not.toHaveAttribute('contenteditable', 'true');
  await expect.poll(() => posts.length).toBe(1);
  expect(noteBody(posts[0])).toEqual({ room: 'Cellar 2' });

  // Same element, same font, same size: only the text changed.
  const after = await label.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      color: s.color,
      letterSpacing: s.letterSpacing,
    };
  });
  expect(after).toEqual(style);
  expect(dialogs).toEqual([]);
});

test('the new label survives a page reload', async ({ page }) => {
  watchDialogs(page);
  await page.goto('/');
  const label = page.locator('#room-name');

  await label.dblclick();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Garage');
  await page.keyboard.press('Enter');
  await expect(label).toHaveText('Garage');
  await expect.poll(async () => {
    const raw = await (await page.request.get('/notes')).json();
    return raw.room;
  }).toBe('Garage');

  await page.reload();
  await expect(page.locator('#room-name')).toHaveText('Garage');
});

test('an emptied label falls back to the default', async ({ page }) => {
  watchDialogs(page);
  await page.goto('/');
  const label = page.locator('#room-name');

  await label.dblclick();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Temporary');
  await page.keyboard.press('Enter');
  await expect(label).toHaveText('Temporary');

  await label.dblclick();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  await expect(label).toHaveText(DEFAULT_LABEL);

  await page.reload();
  await expect(page.locator('#room-name')).toHaveText(DEFAULT_LABEL);
});

test('Escape abandons an edit without saving', async ({ page }) => {
  watchDialogs(page);
  const posts = await captureNotePosts(page);
  await page.goto('/');
  const label = page.locator('#room-name');

  await label.dblclick();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Discard me');
  await page.keyboard.press('Escape');

  await expect(label).toHaveText(DEFAULT_LABEL);
  expect(posts).toEqual([]);
});

test('a single click still toggles the series and does not edit', async ({ page }) => {
  watchDialogs(page);
  await page.goto('/');
  await page.evaluate(() => {
    window.__toggles = 0;
    BChart.toggle = function () { window.__toggles += 1; };
  });

  const label = page.locator('#room-name');
  await label.click();
  expect(await page.evaluate(() => window.__toggles)).toBe(1);
  await expect(label).not.toHaveAttribute('contenteditable', 'true');
  await expect(label).toHaveText(DEFAULT_LABEL);
});

test('beer and fridge labels are untouched and not editable', async ({ page }) => {
  watchDialogs(page);
  await page.goto('/');

  const beer = page.locator('.card.stat .beer-temp .legend-name');
  const fridge = page.locator('.card.stat .fridge-temp .legend-name');
  const beerText = await beer.textContent();
  const fridgeText = await fridge.textContent();

  await beer.dblclick();
  await fridge.dblclick();

  await expect(beer).toHaveText(beerText);
  await expect(fridge).toHaveText(fridgeText);
  expect(await page.locator('#room-name').count()).toBe(1);
  await expect(page.locator('#room-name')).toHaveText(DEFAULT_LABEL);
});
