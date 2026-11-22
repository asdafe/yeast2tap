import { test, expect } from '@playwright/test';

// The Settings backup must carry every stored setting the pages can change, and
// a restore must send each one back through the endpoint that accepts it. These
// regressions are easy to miss because a missing entry simply reports "Not
// Available" and the dialog still finishes.

async function openBackupDialog(page) {
  // The dialog reports failures with alerts; dismiss them so the page can finish.
  page.on('dialog', (dialog) => dialog.dismiss());
  await page.goto('/config.htm');
  await page.waitForFunction(() => typeof window.Backup !== 'undefined' && window.BWF);
  await page.evaluate(() => {
    Backup.init();
    document.querySelector('#backup-diag').style.display = 'block';
  });
}

test('backup includes notes, timezone and the cap schedule', async ({ page }) => {
  await openBackupDialog(page);

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.locator('#backup-diag button', { hasText: 'Save' }).first().click(),
  ]);
  expect(download.suggestedFilename()).toBe('bpl.settings.json');

  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));

  // The dashboard room label and notes live in /notes, not in /bpl.cfg.
  expect(payload.notes).toBeTruthy();
  expect(payload.notes.room).toBeTruthy();
  // Timezone offset, and the auto-cap schedule.
  expect(payload.time).toEqual(expect.objectContaining({ o: expect.any(Number) }));
  expect(payload.cap).toEqual(expect.objectContaining({ m: expect.any(Number) }));
  // Scale settings still ride along with the full status payload.
  expect(payload.scale.scales.length).toBeGreaterThan(0);
});

test('restore posts notes, the timezone and the cap schedule', async ({ page }) => {
  const posts = [];
  await page.route(
    (url) => ['/notes', '/time', '/cap'].includes(url.pathname),
    async (route) => {
      if (route.request().method() === 'POST') {
        posts.push({ path: new URL(route.request().url()).pathname, body: route.request().postData() });
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        return;
      }
      await route.continue();
    },
  );

  const file = {
    notes: { dash: 'hello', room: 'Lager fridge', keg: {} },
    time: { t: '2026-11-02 09:05:00', e: 1790000000, o: -180 },
    cap: { m: 3, at: 1790000000 },
  };

  await openBackupDialog(page);
  await page.setInputFiles('#backupfile', {
    name: 'bpl.settings.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(file)),
  });
  await page.locator('#backup-diag button', { hasText: 'Restore' }).first().click();

  await expect
    .poll(() => posts.map((p) => p.path).sort(), { timeout: 20000 })
    .toEqual(['/cap', '/notes', '/time']);

  const notes = posts.find((p) => p.path === '/notes');
  expect(decodeURIComponent(notes.body)).toContain('"room":"Lager fridge"');
  const time = posts.find((p) => p.path === '/time');
  // Only the timezone is restored; the clock is not moved back to the backup time.
  expect(time.body).toBe('off=-180');
  const cap = posts.find((p) => p.path === '/cap');
  expect(cap.body).toBe('at=1790000000');
});
