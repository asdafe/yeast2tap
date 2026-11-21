import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { attachDiagnostics } from './helpers/diagnostics.js';

const PAGES = [
  'index.htm',
  'control.htm',
  'logging.htm',
  'setup.htm',
  'scale.htm',
  'config.htm',
  'gravity.htm',
  'pressure.htm',
];

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'mobile', width: 390, height: 844 },
];

const SCREENSHOT_DIR = path.join(process.cwd(), 'artifacts', 'screenshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

for (const pageName of PAGES) {
  for (const viewport of VIEWPORTS) {
    test(`${pageName} renders cleanly at ${viewport.name}`, async ({ page, baseURL }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const diagnostics = attachDiagnostics(page, baseURL);

      const started = Date.now();
      const response = await page.goto('/' + pageName, { waitUntil: 'load' });
      const loadMs = Date.now() - started;
      expect(response.status()).toBe(200);

      // Let the page's own load-time timers (chart retry, WebSocket greeting,
      // loading dialog) settle without waiting for networkidle.
      await page.waitForTimeout(1500);

      await expect(page.locator('body')).toBeVisible();
      await expect(page.locator('body')).not.toBeEmpty();

      const layout = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        bodyText: document.body.innerText.trim().length,
      }));

      const screenshot = path.join(SCREENSHOT_DIR, `${pageName}-${viewport.name}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });

      await testInfo.attach('diagnostics', {
        body: JSON.stringify(
          { page: pageName, viewport, loadMs, layout, ...diagnostics },
          null,
          2,
        ),
        contentType: 'application/json',
      });

      expect(diagnostics.externalRequests, 'external request').toEqual([]);
      expect(diagnostics.consoleErrors, 'console errors').toEqual([]);
      expect(diagnostics.pageErrors, 'page errors').toEqual([]);
      expect(diagnostics.failedRequests, 'failed requests').toEqual([]);
      expect(diagnostics.badResponses, 'HTTP >= 400').toEqual([]);
      expect(layout.bodyText, 'visible body text').toBeGreaterThan(0);
      expect(
        layout.scrollWidth,
        `horizontal overflow: ${layout.scrollWidth} > ${layout.clientWidth}`,
      ).toBeLessThanOrEqual(layout.clientWidth + 2);
    });
  }
}
