import { test, expect } from '@playwright/test';

// "Measure now" no longer measures the selected keg: it asks the firmware to
// measure every keg and then reports what was consumed since the last daily
// record. The firmware treats a POST without an id as "all"; these tests drive
// the page against a mock that behaves that way.

function statusWith({ measuring, measureTime, result = 'ok' }) {
  const kegs = [
    { id: 0, name: 'Keg scale 1', kegName: 'Pale Ale', configured: true, calibrated: true, state: 3, beerDensityKgPerL: 1.01 },
    { id: 1, name: 'Keg scale 2', kegName: 'Stout', configured: true, calibrated: true, state: 3, beerDensityKgPerL: 1.02 },
  ];
  return {
    use: true,
    dailyMinute: 60,
    timeSynced: true,
    sampleActive: false,
    scales: kegs.map((keg) => Object.assign({}, keg, {
      measuring: measuring,
      measureCount: measuring ? 20 : 0,
      measureTarget: 50,
      measureResult: measuring ? null : result,
      measureTime: measuring ? 0 : measureTime,
      measureAction: measuring ? 'manual' : null,
      measureGrams: 15000,
      grossGrams: 15000,
      rawCounts: 8000,
      percent: 60,
      capacityLiters: 19,
      temperatureC: 19.5,
      retryPending: false,
      kegChangePending: false,
    })),
  };
}

const MEASURE_TIME = 1790300000;

// consumedGrams per keg for the record written by this measurement.
const DAILY = {
  retentionDays: 180,
  records: [
    [20325, MEASURE_TIME, 15000, 1230, 1, 0, 8000, 19.5],
    [20325, MEASURE_TIME, 11000, 1076, 1, 1, 7900, 19.5],
    // A sample row, which the chart ignores but the page must not choke on.
    [20325, MEASURE_TIME, 15000, 0, 32, 0, 8000, 19.5],
  ],
};

async function openWithMock(page, opts = {}) {
  let polls = 0;
  const posts = [];
  const measuringPolls = opts.measuringPolls === undefined ? 1 : opts.measuringPolls;

  await page.route(
    (url) => url.pathname === '/scale',
    async (route) => {
      const request = route.request();
      if (request.method() === 'POST') {
        posts.push(JSON.parse(new URLSearchParams(request.postData()).get('data')));
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        return;
      }
      const url = new URL(request.url());
      if (url.searchParams.get('daily')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DAILY) });
        return;
      }
      // First load: idle. After the POST: measuring for a few polls, then done.
      const started = posts.length > 0;
      const measuring = started && polls < measuringPolls;
      polls++;
      const body = opts.noTime
        ? statusWith({ measuring: false, measureTime: 0 })
        : statusWith({ measuring: measuring, measureTime: MEASURE_TIME, result: opts.result });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    },
  );

  const dialogs = [];
  page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });

  await page.goto('/scale.htm');
  await page.waitForFunction(() => window.ScalePage && window.ScalePage.settings);
  return { posts, dialogs };
}

test.describe('scale page measure now', () => {
  test('the button lives in the daily consumption box', async ({ page }) => {
    await openWithMock(page);
    const inPanel = await page.evaluate(() => {
      const button = document.getElementById('measure-button');
      const panel = button.closest('.scale-panel');
      return {
        one: document.querySelectorAll('#measure-button').length,
        heading: panel ? panel.querySelector('h5').textContent.trim() : null,
        inReadingRow: !!button.closest('.scale-reading-row'),
      };
    });
    expect(inPanel.one).toBe(1);
    expect(inPanel.heading).toContain('Daily keg level and consumption');
    expect(inPanel.inReadingRow).toBe(false);
  });

  test('asks for every keg and reports today’s consumption', async ({ page }) => {
    const { posts, dialogs } = await openWithMock(page);

    await page.locator('#measure-button').click();
    await expect.poll(() => dialogs.length, { timeout: 15000 }).toBe(1);

    // No id: the firmware reads that as "every scale".
    expect(posts).toEqual([{ action: 'measure' }]);

    const message = dialogs[0];
    expect(message).toContain('Measurement finished.');
    expect(message).toContain("Today's consumption so far:");
    expect(message).toContain('across 2 kegs');
    // 1230 g / 1.01 and 1076 g / 1.02, rounded to two decimals.
    expect(message).toContain('Pale Ale: 1.22 L (1,230 g)');
    expect(message).toContain('Stout: 1.05 L (1,076 g)');
    expect(message).toContain('(2,306 g)');
  });

  test('reports a keg that gave no reading instead of counting it', async ({ page }) => {
    const { dialogs } = await openWithMock(page, { result: 'noSignal' });
    await page.locator('#measure-button').click();
    await expect.poll(() => dialogs.length, { timeout: 15000 }).toBe(1);
    expect(dialogs[0]).toContain('no reading');
  });

  test('says so when the clock is not synchronised', async ({ page }) => {
    const { dialogs } = await openWithMock(page, { noTime: true });
    await page.locator('#measure-button').click();
    await expect.poll(() => dialogs.length, { timeout: 15000 }).toBe(1);
    expect(dialogs[0]).toContain('clock is not synchronised');
  });
});
