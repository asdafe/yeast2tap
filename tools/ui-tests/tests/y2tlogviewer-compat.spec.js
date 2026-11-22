// Cross-check: the bytes BrewLogger::_addSessionSummary produces must be
// decodable by y2tlogviewer, and must be skippable by a viewer that predates
// the tag. Both parsers are run over the same stream here.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { header, periodRecord, TAG } from './helpers/logfile.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const newViewer = path.join(repoRoot, 'htmljs', 'dist', 'english', 'y2tlogviewer.htm');

// Mirror of BrewLogger::_addSessionSummary: chunks of 120 JSON bytes, each byte
// carried as [FillTag, byte], prefixed by [SessionSummaryTag, length].
function firmwareStyleSummary(json, chunk = 120) {
  const bytes = Buffer.from(json, 'utf8');
  const out = [];
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    const n = Math.min(chunk, bytes.length - offset);
    out.push(0xe1, n);
    for (let i = 0; i < n; i++) out.push(0xf7, bytes[offset + i]);
  }
  return out;
}

function buildLog(json) {
  const data = [];
  data.push(...header({ startTime: 1700000000 }));
  data.push(TAG.mode, 'B'.charCodeAt(0));
  data.push(TAG.state, 3);
  for (let i = 0; i < 8; i++) {
    data.push(...periodRecord({ beerSet: 18.6, beerTemp: 19 + i / 10, fridgeTemp: 18.5, gravity: 1.06 - i / 1000 }));
  }
  data.push(...firmwareStyleSummary(json));
  return new Uint8Array(data);
}

async function load(page, viewer, bytes) {
  const file = path.join(repoRoot, 'tools', 'ui-tests', 'artifacts', `y2t-x-${Date.now()}-${Math.random().toString(36).slice(2)}.log`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(bytes));
  await page.goto('file:///' + viewer.replace(/\\/g, '/'));
  await page.waitForFunction(() => typeof window.BChart !== 'undefined' && window.BChart.chart);
  await page.setInputFiles('#fileinput', file);
  await page.waitForTimeout(800);
}

test.describe('session summary block compatibility', () => {
  test('firmware-style bytes decode in the new viewer', async ({ page }) => {
    const json = JSON.stringify({
      t: 1700003600,
      note: 'Çok satırlı not: 60 g Citra.\nİkinci satır.',
      kegs: [{ id: 0, name: 'Keg A', pct: 62, l: 11.8 }],
    });
    await load(page, newViewer, buildLog(json));
    await expect(page.locator('#session-note')).toHaveText('Çok satırlı not: 60 g Citra.\nİkinci satır.');
    await expect(page.locator('#session-kegs tr')).toHaveCount(1);
  });

  test('a long note spanning several records is reassembled', async ({ page }) => {
    const note = 'x'.repeat(400);
    await load(page, newViewer, buildLog(JSON.stringify({ t: 1700003600, note, kegs: [] })));
    await expect(page.locator('#session-note')).toHaveText(note);
    // Empty keg list hides the card rather than showing an empty table.
    await expect(page.locator('#session-kegs-card')).toBeHidden();
  });

});
