import { test, expect } from '@playwright/test';
import WebSocket from 'ws';

test.describe('mock API', () => {
  test.beforeEach(async ({ request }) => {
    await request.post('/__requests/reset');
  });

  test('theme persists through the real GET/POST shape', async ({ request }) => {
    expect(await (await request.get('/theme')).json()).toEqual({ theme: '' });

    const body = 'data=' + encodeURIComponent(JSON.stringify({ theme: 'lab' }));
    const post = await request.post('/theme', {
      data: body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    expect(post.status()).toBe(200);

    expect(await (await request.get('/theme')).json()).toEqual({ theme: 'lab' });
  });

  test('scale, config and notes fixtures have the fields the UI reads', async ({ request }) => {
    const scale = await (await request.get('/scale')).json();
    expect(Array.isArray(scale.scales)).toBe(true);
    expect(scale).toHaveProperty('use');
    expect(scale).toHaveProperty('retentionDays');

    const config = await (await request.get('/config?cfg=1')).json();
    expect(config.mac).toHaveLength(6);
    expect(typeof config.fid).toBe('number');
    expect(typeof config.frsize).toBe('number');
    expect(typeof config.fsize).toBe('number');
    expect(typeof config.fs).toBe('number');

    expect(await (await request.get('/notes')).json()).toEqual({ dash: 'Dry hopped', room: 'Ferm. Chamber', keg: {} });
    expect(await (await request.get('/tschedule')).json()).toHaveProperty('t');
  });

  test('getstatus groups control, temperature, sensors, gravity and system data', async ({ request }) => {
    const status = await (await request.get('/getstatus')).json();

    // Similar values sit together, so a client can read one block at a time.
    expect(status.temperature).toEqual(expect.objectContaining({ beer: expect.any(Number), unit: 'C' }));
    expect(status.control).toHaveProperty('heaterActive');
    expect(status.sensors.beer).toEqual(expect.objectContaining({ connected: true }));
    expect(status.gravity).toEqual(expect.objectContaining({ og: expect.any(Number), sg: expect.any(Number) }));
    expect(status.system.clock).toEqual(expect.objectContaining({ synced: true, localTime: expect.any(String) }));
    expect(status.system.storage).toEqual(expect.objectContaining({ totalBytes: expect.any(Number) }));
    expect(status.system).toHaveProperty('wsClients');

    // The flat keys of the old payload are gone; only mode/state stay at the top.
    expect(status).not.toHaveProperty('beerTemp');
    expect(status).not.toHaveProperty('lastRestartReason');
    expect(Array.isArray(status.scale)).toBe(true);
  });

  test('the removed /fs endpoint is not served any more', async ({ request }) => {
    const response = await request.get('/fs');
    expect(response.status()).toBe(404);
  });

  test('web socket greets with A and keeps sending status', async ({ baseURL }) => {
    const ws = new WebSocket(baseURL.replace('http', 'ws') + '/ws');
    const messages = [];
    await new Promise((resolve, reject) => {
      ws.on('message', (data) => messages.push(data.toString()));
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    await expect.poll(() => messages.length).toBeGreaterThanOrEqual(2);
    expect(messages[0].startsWith('A:')).toBe(true);
    expect(JSON.parse(messages[0].slice(2))).toHaveProperty('ver');

    const before = messages.length;
    await expect.poll(() => messages.length, { timeout: 3000 }).toBeGreaterThan(before);
    ws.close();
  });

  test('request journal records and resets', async ({ request }) => {
    await request.get('/theme');
    const listed = await (await request.get('/__requests')).json();
    expect(listed.requests.some((r) => r.path === '/theme')).toBe(true);

    await request.post('/__requests/reset');
    const cleared = await (await request.get('/__requests')).json();
    expect(cleared.requests).toEqual([]);
  });

  test('unknown API paths stay 404', async ({ request }) => {
    expect((await request.get('/no-such-api')).status()).toBe(404);
  });
});
