import { test, expect } from '@playwright/test';

test('server health and index are reachable', async ({ page, request }) => {
  const health = await request.get('/__health');
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ ok: true });

  const response = await page.goto('/');
  expect(response.status()).toBe(200);
  await expect(page.locator('body')).toBeVisible();
});
