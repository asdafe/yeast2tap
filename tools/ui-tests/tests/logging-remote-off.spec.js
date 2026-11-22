import { test, expect } from '@playwright/test';

// Turning remote logging off must not need the Update button: the settings hide
// at the same moment, so there was nothing left to press. The switch now posts
// the disabled state by itself and only folds the card away when the controller
// accepted it.

async function openLogging(page, { failPost = false } = {}) {
  const posts = [];
  await page.route('**/log', async (route) => {
    if (route.request().method() === 'POST') {
      posts.push(JSON.parse(decodeURIComponent((route.request().postData() || '').replace(/^data=/, ''))));
      if (failPost) {
        await route.fulfill({ status: 406, contentType: 'application/json', body: '{}' });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
    } else {
      await route.continue();
    }
  });
  page.on('dialog', (d) => d.dismiss());
  await page.goto('/logging.htm');
  await expect(page.locator('#enabled')).toBeAttached();
  await page.waitForFunction(() => window.remoteLogReady === true);
  return posts;
}

async function setSwitch(page, on) {
  await page.evaluate((on) => {
    Q('#enabled').checked = on;
    Q('#enabled').dispatchEvent(new Event('change'));
  }, on);
}

test.describe('remote log switch', () => {
  test('switching off posts the disabled state without pressing Update', async ({ page }) => {
    const posts = await openLogging(page);
    await setSwitch(page, true);              // reveal only; nothing to send
    expect(posts).toHaveLength(0);

    await setSwitch(page, false);
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0].enabled).toBe(false);
    expect(posts[0]).toHaveProperty('url');
    expect(posts[0]).toHaveProperty('format');
    expect(posts[0]).toHaveProperty('method');
    expect(posts[0]).toHaveProperty('type');
    expect(posts[0]).toHaveProperty('period');
  });

  test('the card folds after the controller accepts, and says so', async ({ page }) => {
    await openLogging(page);
    await setSwitch(page, true);
    await setSwitch(page, false);

    await expect(page.locator('#remote-log-card')).toHaveClass(/is-collapsed/);
    await expect(page.locator('#remote-status')).toContainText('off');
    await expect(page.locator('#remote-status')).toHaveClass(/is-ok/);
  });

  test('a rejected request keeps the card, and Update, visible', async ({ page }) => {
    await openLogging(page, { failPost: true });
    await setSwitch(page, true);
    await setSwitch(page, false);

    await expect(page.locator('#remote-status')).toHaveClass(/is-bad/);
    await expect(page.locator('#remote-log-card')).not.toHaveClass(/is-collapsed/);
    await expect(page.locator('#remote-log-card button:has-text("Update")')).toBeVisible();
    // The switch goes back to the state the controller still holds.
    await expect(page.locator('#enabled')).toBeChecked();
  });

  test('a second click while the request is in flight does not post twice', async ({ page }) => {
    const posts = await openLogging(page);
    await setSwitch(page, true);
    await page.evaluate(() => {
      Q('#enabled').checked = false;
      Q('#enabled').dispatchEvent(new Event('change'));
      Q('#enabled').dispatchEvent(new Event('change'));
    });
    await expect.poll(() => posts.length).toBe(1);
  });
});
