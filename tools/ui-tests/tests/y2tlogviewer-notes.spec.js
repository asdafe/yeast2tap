import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { header, periodRecord, TAG } from './helpers/logfile.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const viewerUrl = 'file:///' + path.join(repoRoot, 'htmljs', 'dist', 'english', 'y2tlogviewer.htm').replace(/\\/g, '/');
const artifacts = path.join(repoRoot, 'tools', 'ui-tests', 'artifacts');

// Notes live on the device (/notes.json), not inside the brew log, so being able
// to read that file is the only way to see them next to a session. A log that
// was stopped after this change also carries the whole notes object.

function writeTemp(name, buffer) {
  fs.mkdirSync(artifacts, { recursive: true });
  const file = path.join(artifacts, `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(file, buffer);
  return file;
}

const NOTES = {
  dash: 'Dry hopped 60 g Citra on day 4.\nKegs moved to the cold room.',
  room: 'Garage',
  keg: { 0: 'Pale Ale - dry hop bag removed.', 1: 'Stout - leave until December.' },
};

async function openIn(page, file) {
  await page.goto(viewerUrl);
  await page.waitForFunction(() => typeof window.BChart !== 'undefined' && window.BChart.chart);
  const alerts = [];
  page.on('dialog', async (d) => { alerts.push(d.message()); await d.dismiss(); });
  await page.setInputFiles('#fileinput', file);
  await page.waitForTimeout(700);
  return alerts;
}

test.describe('y2tlogviewer reads saved notes', () => {
  test('opens a notes file and shows every note', async ({ page }) => {
    const alerts = await openIn(page, writeTemp('notes.json', Buffer.from(JSON.stringify(NOTES))));
    expect(alerts).toEqual([]);

    await expect(page.locator('#notes-view')).toBeVisible();
    await expect(page.locator('#notes-dash')).toContainText('Dry hopped 60 g Citra');
    await expect(page.locator('#notes-dash')).toContainText('cold room');
    await expect(page.locator('#notes-room')).toContainText('Garage');
    await expect(page.locator('#notes-kegs .notes-keg')).toHaveCount(2);
    await expect(page.locator('#notes-kegs')).toContainText('Pale Ale - dry hop bag removed.');
    await expect(page.locator('#notes-kegs')).toContainText('Stout - leave until December.');

    // The chart is not part of a notes file.
    const chart = await page.evaluate(() => getComputedStyle(document.getElementById('chart-stack')).display);
    expect(chart).toBe('none');
  });

  test('a log carries the notes and the per-keg notes', async ({ page }) => {
    const start = 1700000000;
    const data = [...header({ startTime: start })];
    data.push(TAG.mode, 'B'.charCodeAt(0));
    data.push(TAG.state, 3);
    for (let i = 0; i < 20; i++) {
      data.push(...periodRecord({ beerSet: 18.6, beerTemp: 19 - i * 0.01, gravity: 1.05 - i * 0.0001 }));
    }
    const summary = Buffer.from(JSON.stringify({
      t: start + 1200,
      notes: NOTES,
      kegs: [{ id: 0, name: 'Keg A', pct: 62, l: 11.8 }, { id: 1, name: 'Keg B', pct: 18, l: 3.4 }],
    }), 'utf8');
    for (let off = 0; off < summary.length; off += 120) {
      const n = Math.min(120, summary.length - off);
      data.push(0xe1, n);
      for (let i = 0; i < n; i++) data.push(0xf7, summary[off + i]);
    }

    const alerts = await openIn(page, writeTemp('log-notes.log', Buffer.from(data)));
    expect(alerts).toEqual([]);

    await expect(page.locator('#session-summary')).toBeVisible();
    await expect(page.locator('#session-note')).toContainText('Dry hopped 60 g Citra');
    await expect(page.locator('#session-room')).toContainText('Garage');
    // Two keg rows plus one note row each.
    await expect(page.locator('#session-kegs tr')).toHaveCount(4);
    await expect(page.locator('#session-kegs tr.keg-note-row')).toHaveCount(2);
    await expect(page.locator('#session-kegs')).toContainText('Stout - leave until December.');
  });

  test('an older log with only a single note still shows it', async ({ page }) => {
    const start = 1700000000;
    const data = [...header({ startTime: start })];
    data.push(TAG.mode, 'B'.charCodeAt(0));
    data.push(...periodRecord({ beerTemp: 19, gravity: 1.05 }));
    const summary = Buffer.from(JSON.stringify({ t: start + 60, note: 'Plain single note.' }), 'utf8');
    data.push(0xe1, summary.length);
    for (let i = 0; i < summary.length; i++) data.push(0xf7, summary[i]);

    await openIn(page, writeTemp('log-old.log', Buffer.from(data)));
    await expect(page.locator('#session-note')).toHaveText('Plain single note.');
  });

  test('switching back from notes to a log restores the chart', async ({ page }) => {
    await openIn(page, writeTemp('notes2.json', Buffer.from(JSON.stringify(NOTES))));
    await expect(page.locator('#notes-view')).toBeVisible();

    const start = 1700000000;
    const data = [...header({ startTime: start })];
    data.push(TAG.mode, 'B'.charCodeAt(0));
    for (let i = 0; i < 5; i++) data.push(...periodRecord({ beerTemp: 19, gravity: 1.05 }));
    await page.setInputFiles('#fileinput', writeTemp('log-again.log', Buffer.from(data)));
    await page.waitForTimeout(800);

    await expect(page.locator('#notes-view')).toBeHidden();
    const display = await page.evaluate(() => getComputedStyle(document.getElementById('chart-stack')).display);
    expect(display).not.toBe('none');
    expect(await page.evaluate(() => BChart.chart.data.length)).toBe(5);
  });

  test('rejects a JSON file that is neither scale nor notes', async ({ page }) => {
    const alerts = await openIn(page, writeTemp('other.json', Buffer.from(JSON.stringify({ foo: 'bar' }))));
    expect(alerts.length).toBe(1);
    expect(alerts[0]).toContain('Cannot open this file');
  });
});
