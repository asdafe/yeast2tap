import { test, expect } from '@playwright/test';
import { loadEmbeddedAssets } from '../server/embedded-assets.js';

const repoRoot = new URL('../../..', import.meta.url);
const assets = loadEmbeddedAssets(repoRoot.pathname.replace(/^\//, '').replace(/\/$/, ''));

const SCRIPT_MARKERS = {
  '/shared.js': 'var JSVERSION',
  '/bwf.js': 'function invoke',
  '/dygraph.min.js': 'dygraphs',
};

test.describe('embedded assets', () => {
  for (const [route, marker] of Object.entries(SCRIPT_MARKERS)) {
    test(`${route} is served from the real wdoc bytes`, async ({ request, baseURL }) => {
      const asset = assets.get(route);
      expect(asset, `${route} missing from wdoc`).toBeTruthy();

      const response = await request.get(route);
      expect(response.status()).toBe(200);
      expect(response.url().startsWith(baseURL)).toBe(true);
      expect(response.headers()['content-type']).toBe('application/javascript');
      expect(response.headers()['content-encoding']).toBe('gzip');
      expect(Number(response.headers()['content-length'])).toBe(asset.bytes.length);
      expect(response.headers()['cache-control']).toBeUndefined();

      const body = await response.text();
      expect(body).toContain(marker);
      expect(body.length).toBeGreaterThan(100);
    });
  }

  test('index is served as real gzip HTML', async ({ request, baseURL }) => {
    const asset = assets.get('/');
    const response = await request.get('/');
    expect(response.status()).toBe(200);
    expect(response.url().startsWith(baseURL)).toBe(true);
    expect(response.headers()['content-type']).toBe('text/html');
    expect(response.headers()['content-encoding']).toBe('gzip');
    expect(Number(response.headers()['content-length'])).toBe(asset.bytes.length);

    const body = await response.text();
    expect(body.toLowerCase()).toContain('yeast2tap');
    expect(body).toContain('<html');
  });

  test('unknown static paths return 404', async ({ request }) => {
    const response = await request.get('/definitely-not-a-page.htm');
    expect(response.status()).toBe(404);
  });
});
