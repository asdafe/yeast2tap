import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { header, periodRecord, TAG } from './helpers/logfile.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const viewerUrl = 'file:///' + path.join(repoRoot, 'htmljs', 'dist', 'english', 'y2tlogviewer.htm').replace(/\\/g, '/');
const artifacts = path.join(repoRoot, 'tools', 'ui-tests', 'artifacts');

// The viewer has to accept what the controller records: the binary file the
// Logging page hands out. These tests drive the real file input, not the parser.

function writeTemp(name, buffer) {
  fs.mkdirSync(artifacts, { recursive: true });
  const file = path.join(artifacts, `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.log`);
  fs.writeFileSync(file, buffer);
  return file;
}

function recordedLog(version = 7, hours = 3) {
  const start = 1700000000;
  const data = [];
  // The header block is written by BrewLogger::_startLog.
  const tag = (version | 0xe0) & 0xff;
  data.push(TAG.header, tag, 0, 60,
    (start >>> 24) & 0xff, (start >>> 16) & 0xff, (start >>> 8) & 0xff, start & 0xff);
  if (version >= 7) data.push(1, 0); // device-info block, no device
  data.push(TAG.calibration, 0);
  data.push(TAG.mode, 'B'.charCodeAt(0));
  data.push(TAG.state, 3);
  for (let i = 0; i < hours * 60; i++) {
    data.push(...periodRecord(i === 0
      ? { beerSet: 18.6, beerTemp: 19, fridgeTemp: 18.2, fridgeSet: 18, roomTemp: 21, gravity: 1.05 }
      : { beerTemp: 19 - i * 0.001, gravity: (i % 10 === 0) ? 1.05 - i * 0.00002 : undefined }));
  }
  return Buffer.from(data);
}

async function openIn(page, file) {
  await page.goto(viewerUrl);
  await page.waitForFunction(() => typeof window.BChart !== 'undefined' && window.BChart.chart);
  const alerts = [];
  page.on('dialog', async (d) => { alerts.push(d.message()); await d.dismiss(); });
  await page.setInputFiles('#fileinput', file);
  await page.waitForTimeout(900);
  return alerts;
}

test.describe('y2tlogviewer opens recorded logs', () => {
  for (const version of [7, 6]) {
    test(`opens a v${version} log and draws it`, async ({ page }) => {
      const alerts = await openIn(page, writeTemp(`v${version}`, recordedLog(version)));
      expect(alerts).toEqual([]);

      const state = await page.evaluate(() => ({
        rows: BChart.chart.data.length,
        version: BChart.chart.version,
        chart: !!BChart.chart.chart,
        start: document.getElementById('log-start').textContent,
      }));
      expect(state.version).toBe(version);
      expect(state.rows).toBe(180);
      expect(state.chart).toBe(true);
      expect(state.start).not.toBe('');
    });
  }

  test('loads one log after another without keeping the previous one', async ({ page }) => {
    await openIn(page, writeTemp('first', recordedLog(7, 2)));
    let rows = await page.evaluate(() => BChart.chart.data.length);
    expect(rows).toBe(120);

    await openIn(page, writeTemp('second', recordedLog(7, 5)));
    rows = await page.evaluate(() => BChart.chart.data.length);
    expect(rows).toBe(300);
  });

  test('rejects a file that is not a log, and says why', async ({ page }) => {
    const notALog = Buffer.from('Time,Temperature\n2024-01-01,18.5\n');
    const alerts = await openIn(page, writeTemp('csv', notALog));
    expect(alerts.length).toBe(1);
    expect(alerts[0]).toContain('Cannot open this file');
    expect(alerts[0]).toContain('0x54');
    expect(alerts[0]).toContain('Logging page');
  });

  test('names the unsupported version of a log it cannot read', async ({ page }) => {
    // Only the low 3 bits of the header carry the version, so this decodes as 4.
    const old = Buffer.from([0xff, 0x0c, 0, 60, 0, 0, 0, 1]);
    const alerts = await openIn(page, writeTemp('v4', old));
    expect(alerts.length).toBe(1);
    expect(alerts[0]).toContain('version (4)');
    expect(alerts[0]).toContain('Supported versions are 5, 6 and 7');
  });
});
