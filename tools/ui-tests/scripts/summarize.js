import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const RESULTS = path.join(ROOT, 'artifacts', 'results.json');
const OUT = path.join(ROOT, 'artifacts', 'summary.md');

function pageViewport(title) {
  const m = /^(.*?)\s+renders cleanly at\s+(desktop|tablet|mobile)$/.exec(title);
  return m ? { page: m[1], viewport: m[2] } : { page: title, viewport: '' };
}

function statusOf(run) {
  switch (run.status) {
    case 'expected': return 'passed';
    case 'unexpected': return 'failed';
    case 'skipped': return 'skipped';
    default: return 'skipped';
  }
}

// Playwright JSON report v3:
//   report.suites[] = file suite { title, specs[], suites[] }
//   describe block { title, specs[] }
//   spec { title, ok, tests: [ { status, duration, errors[], attachments[] } ] }
function visit(node, rows) {
  for (const spec of (node.specs || [])) {
    const run = (spec.tests || [])[0] || {};
    const attachments = (run.attachments || []).map((a) => ({
      name: a.name,
      path: a.path,
      contentType: a.contentType,
    }));
    const errors = (run.errors || []).map((e) => e.message || String(e));
    rows.push({
      title: spec.title,
      status: statusOf(run),
      duration: run.duration || 0,
      errors,
      attachments,
      location: spec.location,
    });
  }
  for (const child of (node.suites || [])) {
    visit(child, rows);
  }
}

function main() {
  if (!fs.existsSync(RESULTS)) {
    console.error('results.json not found: run npm run test:all first');
    process.exit(1);
  }

  const report = JSON.parse(fs.readFileSync(RESULTS, 'utf8'));
  const rows = [];
  for (const fileSuite of (report.suites || [])) {
    visit(fileSuite, rows);
  }

  const passed = rows.filter((r) => r.status === 'passed').length;
  const failed = rows.filter((r) => r.status === 'failed').length;
  const skipped = rows.filter((r) => r.status === 'skipped').length;
  const total = rows.length;
  const durationMs = rows.reduce((sum, r) => sum + r.duration, 0);

  const lines = [];
  lines.push('# yeast2tap UI Test Summary');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Total tests: ${total}`);
  lines.push(`Passed: ${passed}`);
  lines.push(`Failed: ${failed}`);
  lines.push(`Skipped: ${skipped}`);
  lines.push(`Total duration: ${(durationMs / 1000).toFixed(2)} s`);
  lines.push('');
  lines.push('## Results by test');
  lines.push('');
  lines.push('| Test | Page | Viewport | Status | Duration |');
  lines.push('|------|------|----------|--------|----------|');
  for (const r of rows) {
    const pv = pageViewport(r.title);
    lines.push(`| ${r.title} | ${pv.page} | ${pv.viewport} | ${r.status} | ${r.duration.toFixed(0)} ms |`);
  }

  const failures = rows.filter((r) => r.status === 'failed');
  if (failures.length) {
    lines.push('');
    lines.push('## Failures');
    lines.push('');
    for (const r of failures) {
      const pv = pageViewport(r.title);
      lines.push(`### ${r.title}`);
      lines.push(`- Page: ${pv.page}`);
      lines.push(`- Viewport: ${pv.viewport}`);
      lines.push(`- Status: ${r.status}`);
      if (r.errors.length) {
        lines.push('- Errors:');
        for (const e of r.errors) lines.push(`  - ${e}`);
      }
      const screenshots = r.attachments.filter((a) => a.path && a.path.endsWith('.png'));
      const traces = r.attachments.filter((a) => a.path && a.path.endsWith('.zip'));
      if (screenshots.length) {
        lines.push('- Screenshot(s):');
        for (const s of screenshots) lines.push(`  - ${s.path}`);
      }
      if (traces.length) {
        lines.push('- Trace(s):');
        for (const t of traces) lines.push(`  - ${t.path}`);
      }
      lines.push('');
    }
  }

  lines.push('## Scope');
  lines.push('- 8 embedded pages: index, control, logging, setup, scale, config, gravity, pressure');
  lines.push('- 3 viewports: desktop 1440x900, tablet 834x1112, mobile 390x844');
  lines.push('- Suites: smoke, assets, pages, interactions, language');
  lines.push('- No ESP32, serial, Wi-Fi, MQTT, OTA, BLE, iSpindel, provisioning, AP, or DuckDNS.');
  lines.push('- Firmware source untouched; gzip assets read only from `wdoc/*.h`.');
  lines.push('');
  lines.push('## Rerun commands (from `tools/ui-tests/`)');
  lines.push('```bash');
  lines.push('npm run test:all');
  lines.push('npm run report:summary');
  lines.push('```');
  lines.push('');
  lines.push('## Mock vs real differences');
  lines.push('- The server mimics firmware JSON/WebSocket endpoints with in-memory fixtures.');
  lines.push('- `/chart.php` returns 204; log decoding and plotted data are not simulated.');
  lines.push('- Periodic WebSocket `A:` status is harness-only to suppress the "not updating" banner.');
  lines.push('- Device writes (`POST /scale`, `/tschedule`, `/log`, `/fputs`, `/rm`, `/mqtt`, `/config`, `/rh`, `/psi`, `/ptc`) return 403 and are journaled.');
  lines.push('- `POST /theme` and `POST /notes` are UI state and are allowed.');
  lines.push('');
  lines.push('See `artifacts/report/` for the Playwright HTML report and `artifacts/screenshots/` for full-page screenshots.');

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, lines.join('\n') + '\n', 'utf8');
  console.log(`Wrote ${OUT} (${total} tests, ${passed} passed, ${failed} failed)`);
}

main();
