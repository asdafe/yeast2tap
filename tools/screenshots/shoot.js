// Live-device screenshot runner for yeast2tap.
//
// Safety rules, in order of importance:
//   * never write to the device: no Apply, no Save, no calibration, no scan, no erase, no format
//   * one browser + one WebSocket per process
//   * hard minimum gap between two navigations inside a process
//   * abort immediately if a watchdog flag file exists (the device restarted)
//
// Usage: node shoot.js <group> [--gap ms] [--slot n] [--slots n]

const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'ui-tests', 'node_modules', '@playwright', 'test'));

const HOST = 'http://192.168.1.195';
const OUT = path.resolve(__dirname, '..', '..', 'docs', 'assets', 'screenshots');
const STOP = path.join(require('os').tmpdir(), 'yt-stop.flag');

const argv = process.argv.slice(2);
const group = argv[0];
const arg = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? Number(argv[i + 1]) : def;
};
const GAP = arg('gap', 10000);
const SLOT = arg('slot', 0);
const SLOTS = arg('slots', 4);

if (!group) {
  console.error('usage: node shoot.js <group>');
  process.exit(2);
}
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${group}]`, ...a);

function stopped() {
  return fs.existsSync(STOP);
}

// ---------------------------------------------------------------- helpers

async function settle(page, ms = 700) {
  await page.waitForTimeout(ms);
}

// Blur free-text fields so personal notes never reach a published screenshot.
// Applied client-side only; it never writes to the device.
// The settings inputs use `name`, not `id`, so both forms are listed.
async function maskPersonal(page) {
  await page
    .addStyleTag({
      content: `
        #dash-note, .keg-note-text, .keg-beer,
        #capgravityinput, #captimeinput, #cappressure,
        #mqtt_server, #mqtt_user, #mqtt_pass, #mqtt_base,
        #url, #thingspeak-apikey, #brewfather-id, #ubidots-token,
        #brewersfriend-key, #mqtt_mode, #mqtt_beerset, #mqtt_fridgeset,
        input[name="duckdnsDomain"], input[name="duckdnsToken"], input[name="duckdnsInterval"],
        input[name="user"], input[name="pass"],
        #ssid, input[name="ssid"], input[name="pass"],
        #connnected-ssid, a.ssid, .scannednetwork,
        #ip, #gw, #nm, #dns,
        .sysinfo-mac, #sysinfo td:last-child {
          filter: blur(6px) !important;
        }
        .sysinfo-mac-row td, #sysinfo .modal-content td:nth-child(2) {
          filter: blur(6px) !important;
        }
      `,
    })
    .catch(() => {});
}

async function shot(page, name, opts = {}) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, ...opts });
  const kb = Math.round(fs.statSync(file).size / 1024);
  log('saved', name, kb + 'KB');
}

// Crop around an element, with a little breathing room.
async function shotOf(page, selector, name, pad = 12) {
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(250);
  const box = await el.boundingBox();
  if (!box) {
    log('MISS element', selector, '->', name);
    return false;
  }
  const vp = page.viewportSize();
  const x = Math.max(0, Math.floor(box.x - pad));
  const y = Math.max(0, Math.floor(box.y - pad));
  const w = Math.min(vp.width - x, Math.ceil(box.width + pad * 2));
  const h = Math.min(vp.height - y, Math.ceil(box.height + pad * 2));
  await page.screenshot({ path: path.join(OUT, name), clip: { x, y, width: w, height: h } });
  log('saved', name, `${w}x${h}`);
  return true;
}

// Click a segmented control value without pressing Apply.
async function seg(page, group, value) {
  const sel = `[data-g="${group}"] [data-v="${value}"], [data-g="${group}"] input[value="${value}"]`;
  const el = page.locator(sel).first();
  if (await el.count()) await el.click({ force: true }).catch(() => {});
  await page.waitForTimeout(300);
}

async function clickIf(page, selector) {
  const el = page.locator(selector).first();
  if (await el.count()) {
    await el.click({ force: true }).catch(() => {});
    await page.waitForTimeout(350);
    return true;
  }
  return false;
}

async function openDialog(page, selector) {
  const el = page.locator(selector).first();
  if (!(await el.count())) return false;
  const visible = await el.isVisible().catch(() => false);
  if (!visible) return false;
  return true;
}

// ---------------------------------------------------------------- groups

const groups = {};

// ---------------------------------------------------------------- dashboard

groups.dashboard = async (page, ctx, mobile) => {
  await page.goto(HOST + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => typeof window.BChart !== 'undefined', { timeout: 20000 }).catch(() => {});
  await settle(page, 4000); // let the first status and chart arrive
  await maskPersonal(page);
  await settle(page, 300);

  if (!mobile) {
    await shot(page, 'YT-001-dashboard-full.png');
    await shotOf(page, '.stats', 'YT-009-stat-cards.png');
    await shotOf(page, '.card.keg-status-section', 'YT-014-kegs-card.png', 8);
    await shotOf(page, '#gravity-pane', 'YT-017-gravity-card.png', 8);
    await shotOf(page, '.gravity-device-pane', 'YT-018-gravity-device-ispindel.png', 8);
    await shotOf(page, '.dash-note-card', 'YT-021-notes-card.png', 8);
  } else {
    await shot(page, 'YT-004-dashboard-mobile.png', { fullPage: false });
  }
};

groups.dashboard2 = async (page, ctx, mobile) => {
  await page.goto(HOST + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => typeof window.BChart !== 'undefined', { timeout: 20000 }).catch(() => {});
  await settle(page, 5000);
  await maskPersonal(page);
  await settle(page, 300);

  // chart with a hover tooltip
  const chart = page.locator('#div_g').first();
  if (await chart.count()) {
    const b = await chart.boundingBox();
    if (b) {
      await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.5);
      await page.waitForTimeout(500);
    }
    await shotOf(page, '.row2', 'YT-012-chart-tooltip.png', 6);
  }

  // legend toggle: hide one series, capture the dimmed entry
  // The chart chip row only carries aux-temp / gravity / filtersg; the beer and fridge
  // series are toggled from their stat cards. Use the gravity chip: it is the only one
  // whose line is unmistakable on the chart.
  const chips = page.locator('.legend-chips').first();
  const chip = page.locator('.legend-chips [for="gravity"]').first();
  if (await chip.count()) {
    await chip.click({ force: true }).catch(() => {});
    await page.waitForTimeout(900);
    const vis = await page.evaluate(() => {
      const g = window.BChart && BChart.chart;
      if (!g) return 'no chart';
      try { return JSON.stringify(g.visibility()); } catch (e) { return 'n/a'; }
    }).catch(() => 'n/a');
    log('series visibility after chip click:', vis);
    if (chips) await shotOf(page, '.legend-chips', 'YT-013-chart-legend-toggled.png', 6);
    // restore it so the page is left as found
    await chip.click({ force: true }).catch(() => {});
  } else {
    log('gravity chip not found — YT-013 skipped');
  }

  // room label in edit mode (client-side only until blur — never blur with changes)
  const room = page.locator('#room-name').first();
  if (await room.count()) {
    await room.dblclick().catch(() => {});
    await page.waitForTimeout(400);
    await shotOf(page, '.card.stat .room-temp', 'YT-011-room-label-edit.png', 10);
    await page.keyboard.press('Escape').catch(() => {});
  }

  // optional panes column
  await shotOf(page, '.row3', 'YT-022-dashboard-optional-panes.png', 6);
};

// ---------------------------------------------------------------- control

groups.control = async (page, ctx, mobile) => {
  await page.goto(HOST + '/control.htm', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await settle(page, 3500);

  if (mobile) {
    // Phone captures are one figure only; the desktop set is produced at 1440 wide.
    await shot(page, 'YT-005-control-mobile.png');
    return;
  }

  // Current device state is independent mode. Capture that first, untouched.
  await shot(page, 'YT-029-control-independent-fixed.png');

  // PID mode is a client-side selection until Apply is pressed.
  await seg(page, 'method', 'pid');
  await seg(page, 'what', 'beer');
  await seg(page, 'src', 'fixed');
  await settle(page, 700);
  await shot(page, 'YT-023-control-pid-beer-fixed.png');
  await shotOf(page, '#pid-panel', 'YT-033-control-pid-panel.png', 8);

  await seg(page, 'what', 'fridge');
  await settle(page, 500);
  await shot(page, 'YT-024-control-pid-fridge-fixed.png');

  await seg(page, 'src', 'ramp');
  await settle(page, 800);
  await shot(page, 'YT-026-control-pid-fridge-ramp.png');

  await seg(page, 'what', 'beer');
  await settle(page, 800);
  await shot(page, 'YT-025-control-pid-beer-ramp.png');

  const prof = page.locator('#profile-s').first();
  if (await prof.count()) {
    await shotOf(page, '#profile-s', 'YT-027-profile-step-table.png', 8);
  }

  // condition dropdown, opened in a cell
  const condCell = page.locator('#profile_t select, #profile_t [data-k="c"]').first();
  if (await condCell.count()) {
    await condCell.click({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
    await shotOf(page, '#profile-s', 'YT-028-profile-condition-options.png', 8);
    await page.keyboard.press('Escape').catch(() => {});
  }

  // back to independent for its sub-shots
  await seg(page, 'method', 'ind');
  await settle(page, 700);
  await shot(page, 'YT-029-control-independent-fixed.png');
};

groups.control2 = async (page) => {
  await page.goto(HOST + '/control.htm', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await settle(page, 3500);

  await seg(page, 'method', 'pid');
  await seg(page, 'what', 'beer');
  await seg(page, 'src', 'fixed');
  await settle(page, 600);

  // the "control enabled" switch is a pending change until Apply — flipping it is safe
  // #mode-run is visually hidden behind its label; clicking the label is the real gesture.
  const runLabel = page.locator('label[for="mode-run"]').first();
  if (await runLabel.count()) {
    await runLabel.click({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
    const state = await page.locator('#mode-run').first().isChecked().catch(() => null);
    log('control-enabled switch checked =', state);
    const cf = page.locator('.cf').first();
    if (await cf.count()) {
      const b = await cf.boundingBox();
      const note = await page.locator('#apply-note').first().boundingBox().catch(() => null);
      if (b) {
        const bottom = note ? Math.max(note.y + note.height, b.y + b.height) : b.y + b.height;
        await page.screenshot({
          path: path.join(OUT, 'YT-032-control-disabled.png'),
          clip: { x: Math.max(0, b.x - 12), y: Math.max(0, b.y - 12),
                  width: Math.min(1400, b.width + 24), height: Math.min(400, bottom - b.y + 24) },
        });
        log('saved', 'YT-032-control-disabled.png', 'footer crop');
      }
    }
    if (state === false) { await runLabel.click({ force: true }).catch(() => {}); }
  }

  // advanced controls: collapsed then expanded
  const adv = page.locator('details.ctrl-adv').first();
  if (await adv.count()) {
    await shotOf(page, 'details.ctrl-adv', 'YT-033-advanced-controls-collapsed.png', 8);
    await adv.evaluate((el) => { el.open = true; }).catch(() => {});
    await page.waitForTimeout(900);
    await shotOf(page, 'details.ctrl-adv', 'YT-034-advanced-controls-expanded.png', 8);

    for (const [tab, name] of [
      ['gravity', 'YT-035-capping-gravity.png'],
      ['time', 'YT-036-capping-time.png'],
      ['manual', 'YT-037-capping-manual.png'],
    ]) {
      const t = page.locator(`#tab-${tab}-m, [data-tab="${tab}"]`).first();
      if (await t.count()) {
        await t.click({ force: true }).catch(() => {});
        await page.waitForTimeout(500);
        await shotOf(page, '#capper-frame', name, 8);
      }
    }

    // carbonation dialog: opening only, never confirming
    const capperVisible = await page.locator('#capper-frame').first().isVisible().catch(() => false);
    if (!capperVisible) log('no capping actuator — YT-038 skipped');
    else {
      const co2 = page.locator('#capper-frame button').filter({ hasText: /psi|\.\.\./ }).last();
      if (await co2.count()) {
        await co2.click({ force: true }).catch(() => {});
        await page.waitForTimeout(700);
        const dlg = page.locator('#dlg_carbonation');
        if (await dlg.count() && await dlg.isVisible().catch(() => false)) {
          await shot(page, 'YT-038-carbonation-dialog.png');
          // close with the dialog's own cancel button, never with a confirm
          await page.locator('#dlg_carbonation .btn').first().click({ force: true }).catch(() => {});
        } else log('carbonation dialog did not open — YT-038 skipped');
      }
    }

    await adv.evaluate((el) => { el.open = true; }).catch(() => {});
    await page.waitForTimeout(400);
    await shotOf(page, '#ptc-control', 'YT-045-ptc-control.png', 8);
    await shotOf(page, '#humidity-control', 'YT-046-humidity-control.png', 8);
  }

  // easy ramp dialog: open only
  await seg(page, 'method', 'ind');
  await page.waitForTimeout(600);
  if (await clickIf(page, '#easybtn')) {
    await page.waitForTimeout(700);
    await shot(page, 'YT-042-easy-ramp-wizard.png');
    await page.keyboard.press('Escape').catch(() => {});
  }

  // profile list: opens with a POST that only lists files
  if (await clickIf(page, '#loadbtn')) {
    await page.waitForTimeout(1500);
    if (await openDialog(page, '#profile-list-pane')) await shot(page, 'YT-039-profile-list-dialog.png');
  }
};

// ---------------------------------------------------------------- settings

groups.settings = async (page) => {
  await page.goto(HOST + '/config.htm', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await settle(page, 3000);
  await maskPersonal(page);
  await settle(page, 300);

  await maskPersonal(page);
  await page.waitForTimeout(400);
  await shot(page, 'YT-047-settings-system.png');
  await page.locator('#sysconfig').first().scrollIntoViewIfNeeded().catch(() => {});
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.45));
  await page.waitForTimeout(600);
  await shot(page, 'YT-048-settings-network-security.png');

  await shotOf(page, '#pressure-nav-card', 'YT-049-settings-pressure-nav.png', 8);

  // sysinfo is read-only
  if (await clickIf(page, '#sysinfo, [onclick*="sysinfo"]')) {
    await page.waitForTimeout(800);
    if (await openDialog(page, '#sysinfo')) await shot(page, 'YT-052-sysinfo-dialog.png');
  }
  await page.evaluate(() => document.querySelectorAll('.modal').forEach((m) => { m.style.display = 'none'; }));

  // backup dialog: open only, never Save
  if (await clickIf(page, '[onclick*="Backup.init"]')) {
    await page.waitForTimeout(800);
    const dlg = page.locator('#backup-diag');
    if (await dlg.count() && await dlg.isVisible().catch(() => false)) {
      await shot(page, 'YT-053-backup-dialog.png');
    }
  }
  await page.evaluate(() => document.querySelectorAll('.modal').forEach((m) => { m.style.display = 'none'; }));

  // advanced settings: opens with a read-only WS request
  if (await clickIf(page, '#advanced, [onclick*="showAdvanced"]')) {
    await page.waitForTimeout(1800);
    await shot(page, 'YT-055-advanced-settings-top.png');
    await page.evaluate(() => {
      const box = document.querySelector('#advanced');
      if (box) box.scrollTop = box.scrollHeight;
      const inner = document.querySelector('#advanced .modal-content');
      if (inner) inner.scrollTop = inner.scrollHeight;
      const last = document.querySelector('#advanced button:last-of-type');
      if (last) last.scrollIntoView({ block: 'end' });
    });
    await page.waitForTimeout(600);
    await shot(page, 'YT-056-advanced-settings-bottom.png');
  }
};

// ---------------------------------------------------------------- device setup

groups.setup = async (page) => {
  await page.goto(HOST + '/setup.htm', { waitUntil: 'domcontentloaded', timeout: 30000 });

  // The page shows a blocking "Retrieving..." overlay until the device list has been
  // built. Wait for the installed counter to be a real number and the overlay to clear.
  // The counter starts at 0 before the device list arrives; wait for real cards.
  await page
    .waitForFunction(
      () => {
        const cards = document.querySelectorAll('#device-list div.device-container');
        const blocked = document.querySelector('#blockscreen');
        const overlayOn = blocked && getComputedStyle(blocked).display !== 'none';
        return cards.length > 0 && !overlayOn;
      },
      { timeout: 35000 },
    )
    .catch(() => log('WARN device list did not populate'));
  await settle(page, 2500);

  const count = await page.locator('#cnt-inst').first().textContent().catch(() => '?');
  log('installed devices:', (count || '').trim());
  await shot(page, 'YT-058-device-setup-full.png');

  // Cards render inside #device-list. Pick one actuator-ish and one sensor-ish card.
  const cards = page.locator('#device-list div.device-container');
  const n = await cards.count();
  log('device cards found:', n);

  const cropCard = async (el, name) => {
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(500);
    const b = await el.boundingBox();
    if (!b) { log('MISS card', name); return false; }
    await page.screenshot({
      path: path.join(OUT, name),
      clip: { x: Math.max(0, b.x - 10), y: Math.max(0, b.y - 10),
              width: Math.min(1410, b.width + 20), height: Math.min(1200, b.height + 20) },
    });
    log('saved', name);
    return true;
  };

  let act = null, sens = null;
  for (let i = 0; i < n; i++) {
    const c = cards.nth(i);
    const t = (await c.innerText().catch(() => '')) || '';
    if (!act && /heater|cooler|light|fan|actuator|relay|output/i.test(t)) act = c;
    if (!sens && /beer|fridge|room|temp|probe|sensor/i.test(t)) sens = c;
  }
  if (act) await cropCard(act, 'YT-059-device-card-actuator.png');
  else log('no actuator card — YT-059 skipped');
  if (sens) await cropCard(sens, 'YT-060-device-card-sensor.png');
  else log('no sensor card — YT-060 skipped');

  // installed vs detected: the whole Devices section
  const sec = page.locator('section.setup-sec').first();
  if (await sec.count()) {
    await sec.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(400);
    const b = await sec.boundingBox();
    if (b) {
      await page.screenshot({
        path: path.join(OUT, 'YT-063-detected-vs-installed.png'),
        clip: { x: Math.max(0, b.x - 8), y: Math.max(0, b.y - 8),
                width: Math.min(1420, b.width + 16), height: Math.min(1400, b.height + 16) },
      });
      log('saved YT-063-detected-vs-installed.png');
    }
  }

  await shotOf(page, '#scale-devices', 'YT-064-scales-section.png', 8);
  const scaleRow = page.locator('#scale-device-list .scale-device-row').first();
  if (await scaleRow.count()) {
    await scaleRow.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(400);
    const b = await scaleRow.boundingBox();
    if (b) {
      await page.screenshot({
        path: path.join(OUT, 'YT-065-scale-pin-hints.png'),
        clip: { x: Math.max(0, b.x - 10), y: Math.max(0, b.y - 10),
                width: Math.min(1410, b.width + 20), height: Math.min(400, b.height + 20) },
      });
      log('saved YT-065-scale-pin-hints.png');
    }
  }

  // Add-device picker: opens locally, nothing is installed until Apply.
  if (await clickIf(page, '#addbtn')) {
    await page.waitForTimeout(700);
    const picker = page.locator('#add-picker');
    if (await picker.count() && await picker.isVisible().catch(() => false)) {
      await shotOf(page, '#add-picker', 'YT-062-add-device-picker.png', 10);
    } else log('add picker not visible — YT-062 skipped');
    await page.evaluate(() => {
      const p = document.querySelector('#add-picker');
      if (p) p.style.display = 'none';
    });
  }

  // Restore dialog: file picker only.
  if (await clickIf(page, '[onclick*="restore()"]')) {
    await page.waitForTimeout(600);
    const dlg = page.locator('#dlg_restore');
    if (await dlg.count() && await dlg.isVisible().catch(() => false)) {
      await shot(page, 'YT-069-device-restore-dialog.png');
    }
  }
};

// ---------------------------------------------------------------- hydrometer

groups.gravity = async (page, ctx, mobile) => {
  await page.goto(HOST + '/gravity.htm', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await settle(page, 3000);

  if (mobile) {
    await shot(page, 'YT-078-hydrometer-mobile.png');
    return;
  }

  await shot(page, 'YT-071-hydrometer-ispindel.png');

  // selecting a type only switches panes; nothing is sent until Save
  const typeSel = page.locator('#device-type').first();
  if (await typeSel.count()) {
    await typeSel.selectOption('2').catch(() => {});
    await page.waitForTimeout(600);
    await shot(page, 'YT-072-hydrometer-tilt.png');
    await typeSel.selectOption('3').catch(() => {});
    await page.waitForTimeout(600);
    await shot(page, 'YT-073-hydrometer-pill.png');
    await typeSel.selectOption('0').catch(() => {});
    await page.waitForTimeout(600);
    await shot(page, 'YT-077-hydrometer-none.png');
    await typeSel.selectOption('1').catch(() => {});
    await page.waitForTimeout(800);
  }

  await shotOf(page, '.card:has(#cal_formula), #cal_formula', 'YT-079-gravity-known-issue.png', 10);

  // calibration dialog: open only, no points added
  if (await clickIf(page, '#addbutton')) {
    await page.waitForTimeout(800);
    if (await openDialog(page, '#dlg_addcalpoint')) await shot(page, 'YT-075-gravity-calibration-dialog.png');
  }
};

// ---------------------------------------------------------------- logging

groups.logging = async (page, ctx, mobile) => {
  await page.goto(HOST + '/logging.htm', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await settle(page, 3500);
  await maskPersonal(page);
  await settle(page, 300);

  if (mobile) {
    await shot(page, 'YT-092-logs-mobile.png');
    return;
  }

  await shot(page, 'YT-080-logs-idle.png');
  await shotOf(page, '#loglist', 'YT-083-log-list.png', 8);

  // The local log card shows the start form only when nothing is recording.
  const recording = await page.locator('#logstopinput').isVisible().catch(() => false);
  if (!recording) {
    await page.locator('#logname').first().fill('pale-ale-01').catch(() => {});
    await page.waitForTimeout(400);
    await shotOf(page, '.card:has(#logname)', 'YT-081-logs-start-filled.png', 8);
  } else {
    log('a log is already recording — YT-081 and YT-082 skipped (that is the real state)');
  }

  // Expand the optional cards by setting the class directly. Their switches POST on
  // change, so a real click would write to the device.
  const expanded = await page.evaluate(() => {
    const out = { remote: false, mqtt: false };
    const en = document.querySelector('#enabled');
    if (en && typeof syncRemoteLogCard === 'function') {
      en.checked = true;
      syncRemoteLogCard();
      out.remote = true;
    }
    const mo = document.querySelector('#mqtt-open');
    if (mo && typeof syncMqttCard === 'function') {
      mo.checked = true;
      syncMqttCard();
      out.mqtt = true;
    }
    return out;
  });
  log('expanded', JSON.stringify(expanded));
  await maskPersonal(page);
  await page.waitForTimeout(800);

  const remote = page.locator('#remote-log-card').first();
  if (await remote.count() && await remote.isVisible().catch(() => false)) {
    await remote.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(300);
    const sel = page.locator('#service-type').first();
    if (await sel.count()) {
      const pairs = [
        ['generichttp', 'YT-084-remote-logging-generic.png'],
        ['thingspeak', 'YT-085-remote-logging-thingspeak.png'],
        ['ubidots', 'YT-087-remote-logging-ubidots.png'],
        ['brewfather', 'YT-086-remote-logging-brewfather.png'],
        ['brewersfriend', 'YT-088-remote-logging-brewersfriend.png'],
      ];
      for (const [value, name] of pairs) {
        // selectOption fires change, and the service selector only re-renders panes.
        await sel.selectOption(value).catch(() => {});
        await page.evaluate(() => { if (typeof serviceChange === 'function') serviceChange(); }).catch(() => {});
        await page.waitForTimeout(900);
        await maskPersonal(page);
        await page.waitForTimeout(200);
        await shotOf(page, '#remote-log-card', name, 8);
      }
    }
  } else {
    log('remote logging card not expandable — YT-084/085/087/088 skipped');
  }

  const mqtt = page.locator('#mqtt').first();
  if (await mqtt.count()) {
    await mqtt.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(400);
    const collapsed = await mqtt.evaluate((el) => el.classList.contains('is-collapsed'));
    if (collapsed) log('MQTT card did not expand — YT-091 skipped');
    else {
      await maskPersonal(page);
      await page.waitForTimeout(300);
      await shotOf(page, '#mqtt', 'YT-091-mqtt-expanded.png', 8);
    }
  }
};

// ---------------------------------------------------------------- pressure + scale

groups.pressure = async (page) => {
  await page.goto(HOST + '/pressure.htm', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await settle(page, 3000);
  await shot(page, 'YT-094-pressure-page.png');
  if (await clickIf(page, '[onclick*="calibrate"], #calibrate, .btn:has-text("Calibrate")')) {
    await page.waitForTimeout(700);
    if (await openDialog(page, '#dlg_calibrate')) await shot(page, 'YT-095-pressure-cal-step1.png');
  }
};

groups.scale = async (page, ctx, mobile) => {
  await page.goto(HOST + '/scale.htm', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await settle(page, 4000);

  if (mobile) {
    await shot(page, 'YT-110-scale-mobile.png');
    return;
  }

  await shot(page, 'YT-098-scale-main.png');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  // calibration panel (second section) holds the keg fields and the stability limit
  const panels = page.locator('#scale-main section.scale-panel');
  if (await panels.count() >= 2) {
    await shotOf(page, '#scale-main section.scale-panel >> nth=0', 'YT-102-scale-keg-settings.png', 8);
    await shotOf(page, '#scale-main section.scale-panel >> nth=0', 'YT-101-scale-stability-limit.png', 8);
  }
  await shotOf(page, '.scale-history-head', 'YT-104-scale-daily-settings.png', 8);
  await shotOf(page, '#scale-main section.scale-panel >> nth=1', 'YT-103-scale-history-chart.png', 6);

  // sampling row: the interval/hours/start-stop cluster inside the history head
  const sampleState = page.locator('#sample-state').first();
  if (await sampleState.count()) {
    const b = await sampleState.boundingBox();
    const head = await page.locator('.scale-history-head').first().boundingBox();
    if (b && head) {
      await page.screenshot({
        path: path.join(OUT, 'YT-105-scale-sampling.png'),
        clip: { x: Math.max(0, b.x - 420), y: Math.max(0, b.y - 20),
                width: Math.min(1400, b.x + b.width + 20 - Math.max(0, b.x - 420)),
                height: Math.min(200, b.height + 60) },
      });
      log('saved', 'YT-105-scale-sampling.png');
    }
  }

  const corr = page.locator('#correction-formula').first();
  if (await corr.count()) {
    await corr.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(400);
    await shotOf(page, 'section:has(#correction-formula)', 'YT-106-scale-correction-empty.png', 8);

    // invalid formula: the parser refuses client-side, nothing is sent
    await corr.fill('1,5 t');
    await clickIf(page, '#save-correction');
    await page.waitForTimeout(700);
    await shotOf(page, 'section:has(#correction-formula)', 'YT-108-scale-correction-error.png', 8);
    await corr.fill('');
  }

  // second slot may be the uncalibrated one
  const sel = page.locator('#scale-select').first();
  if (await sel.count()) {
    await sel.selectOption('1').catch(() => {});
    await page.waitForTimeout(1200);
    await shot(page, 'YT-109-scale-uncalibrated.png');
    await sel.selectOption('0').catch(() => {});
  }
};

// ---------------------------------------------------------------- OTA + viewer

groups.ota = async (page, ctx) => {
  await page.goto(HOST + ':8008/systemupdate', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await settle(page, 1200);
  await shot(page, 'YT-111-ota-upload.png');
};

groups.viewer = async (page) => {
  const root = path.resolve(__dirname, '..', '..');
  const viewerFile = path.join(root, 'htmljs', 'dist', 'english', 'BPLLogViewer.htm');
  const logFile = path.join(require('os').tmpdir(), 'yt-test-log');
  const scaleFile = path.join(require('os').tmpdir(), 'yt-scale-export.json');
  if (!fs.existsSync(viewerFile)) { log('viewer build missing, skipped'); return; }

  const fileUrl = 'file:///' + viewerFile.replace(/\\/g, '/');

  // Every dialog is closed by its own Cancel button; Escape does not dismiss them and
  // they stack on top of each other.
  const closeAll = async () => {
    await page.evaluate(() => {
      ['#export-dialog', '#cropto-dialog', '#dev-info-dialog', '#tempcorrect-dialog',
       '#tc-graph-dialog', '#scale-tc-dialog', '#polynomialpane', '#input-reference']
        .forEach((id) => {
          const el = document.querySelector(id);
          if (el) el.style.display = 'none';
        });
    }).catch(() => {});
    await page.waitForTimeout(300);
  };

  const openMenu = async () => {
    await page.locator('.menu-button').first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
  };

  const pickMenu = async (label) => {
    await openMenu();
    const a = page.locator('#popupMenu a').filter({ hasText: label }).first();
    if (!(await a.count())) return false;
    await a.click({ force: true }).catch(() => {});
    await page.waitForTimeout(800);
    return true;
  };

  await page.goto(fileUrl);
  await settle(page, 1500);
  await shot(page, 'YT-123-viewer-empty.png');
  if (!fs.existsSync(logFile)) { log('no log file downloaded — stops here'); return; }

  const loadLog = async () => {
    const inp = page.locator('#fileinput').first();
    if (await inp.count()) {
      await inp.setInputFiles(logFile).catch(() => {});
      await page.waitForTimeout(4000);
    }
  };

  await loadLog();
  await shot(page, 'YT-124-viewer-log.png');

  // menu open, with a log loaded (this is the state the guide describes)
  await openMenu();
  await shot(page, 'YT-132-viewer-menu.png');
  await page.locator('.menu-button').first().click({ force: true }).catch(() => {});

  // ---- export dialog
  if (await pickMenu('Export')) {
    const dlg = page.locator('#export-dialog');
    if (await dlg.isVisible().catch(() => false)) await shot(page, 'YT-129-viewer-export.png');
    else log('export dialog did not open');
  }
  await closeAll();

  // ---- crop dialog
  if (await pickMenu('Crop to')) {
    const dlg = page.locator('#cropto-dialog');
    if (await dlg.isVisible().catch(() => false)) await shot(page, 'YT-128-viewer-crop.png');
    else log('crop dialog did not open');
  }
  await closeAll();

  // ---- gravity device info (the calibration pane)
  if (await pickMenu('Gravity Device')) {
    const dlg = page.locator('#dev-info-dialog');
    if (await dlg.isVisible().catch(() => false)) await shot(page, 'YT-125-viewer-calibration.png');
    else log('device info dialog did not open');
  }
  await closeAll();

  // ---- gravity temperature correction, then its graph
  if (await pickMenu('Create Temperature Correction')) {
    const dlg = page.locator('#tempcorrect-dialog');
    if (await dlg.isVisible().catch(() => false)) {
      await shot(page, 'YT-126-viewer-tempcorrection.png');
      const ok = page.locator('#tempcorrect-dialog .btn--primary').first();
      if (await ok.count()) {
        await ok.click({ force: true }).catch(() => {});
        await page.waitForTimeout(3000);
        const g = page.locator('#tc-graph-dialog');
        if (await g.isVisible().catch(() => false)) await shot(page, 'YT-127-viewer-tempcorrection-graph.png');
        else log('correction graph dialog did not open');
      }
    } else log('temperature correction dialog did not open');
  }
  await closeAll();

  // ---- scale mode
  if (!fs.existsSync(scaleFile)) { log('no scale export staged — YT-130/131 skipped'); return; }
  await page.goto(fileUrl);
  await settle(page, 1200);
  const inp2 = page.locator('#fileinput').first();
  await inp2.setInputFiles(scaleFile).catch(() => {});
  await page.waitForTimeout(3500);
  await shot(page, 'YT-130-viewer-scale-mode.png');
  if (await pickMenu('Create Scale Temperature Correction')) {
    await page.waitForTimeout(1200);
    const s = page.locator('#scale-tc-dialog');
    if (await s.isVisible().catch(() => false)) await shot(page, 'YT-131-viewer-scale-tc.png');
    else log('scale correction dialog did not open');
  }
};

// ---------------------------------------------------------------- extra passes

// Settings, corrected: the SSID is a <button>, and every settings figure needs the mask.
groups.settingsB = async (page) => {
  await page.goto(HOST + '/config.htm', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await settle(page, 3000);
  await maskPersonal(page);
  await settle(page, 400);

  await shot(page, 'YT-047-settings-system.png');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.42));
  await page.waitForTimeout(700);
  await maskPersonal(page);
  await settle(page, 300);
  await shot(page, 'YT-048-settings-network-security.png');
  await shotOf(page, '#pressure-nav-card', 'YT-049-settings-pressure-nav.png', 8);

  const openModal = async (selector, name) => {
    if (!(await clickIf(page, selector))) return false;
    await page.waitForTimeout(900);
    await maskPersonal(page);
    await page.waitForTimeout(300);
    await shot(page, name);
    return true;
  };

  await openModal('[onclick*="sysinfo"], #sysinfo', 'YT-052-sysinfo-dialog.png');
  await page.evaluate(() => document.querySelectorAll('.modal').forEach((m) => { m.style.display = 'none'; }));
  await page.waitForTimeout(300);

  await openModal('[onclick*="Backup.init"]', 'YT-053-backup-dialog.png');
  await page.evaluate(() => document.querySelectorAll('.modal').forEach((m) => { m.style.display = 'none'; }));
  await page.waitForTimeout(300);

  await openModal('[onclick*="showAdvanced"]', 'YT-055-advanced-settings-top.png');
  await page.evaluate(() => {
    const box = document.querySelector('#advanced');
    if (box) box.scrollTop = box.scrollHeight;
    const inner = document.querySelector('#advanced .modal-content');
    if (inner) inner.scrollTop = inner.scrollHeight;
  });
  await page.waitForTimeout(700);
  await shot(page, 'YT-056-advanced-settings-bottom.png');
  await page.evaluate(() => document.querySelectorAll('.modal').forEach((m) => { m.style.display = 'none'; }));

  // network dialog: scan results are read-only, nothing is joined
  await openModal('[onclick*="Net.show"]', 'YT-050-network-dialog.png');
  await page.waitForTimeout(2500);
  await maskPersonal(page);
  await page.waitForTimeout(300);
  await shot(page, 'YT-050-network-dialog.png');
  await page.evaluate(() => {
    const p = document.querySelector('#networkselection');
    if (p) p.scrollTop = p.scrollHeight;
  });
  await page.waitForTimeout(600);
  await shot(page, 'YT-051-network-static-ip.png');
};

// Scale extras: the calibrating state, the sampling run, the filled formula.
groups.scaleB = async (page) => {
  await page.goto(HOST + '/scale.htm', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await settle(page, 4000);
  await shot(page, 'YT-098-scale-main.png');
  await shotOf(page, '.scale-history-head', 'YT-104-scale-daily-settings.png', 8);

  // stability limit + sampling row
  await shotOf(page, '#cal-limit', 'YT-101-scale-stability-limit.png', 14);
  await shotOf(page, '#sample-minutes', 'YT-105-scale-sampling.png', 14);

  const corr = page.locator('#correction-formula').first();
  if (await corr.count()) {
    await corr.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(400);
    await corr.fill('-511.2 -16.3 t +77.04 t^2');
    await clickIf(page, '#save-correction');
    await page.waitForTimeout(1200);
    await shotOf(page, 'section:has(#correction-formula)', 'YT-107-scale-correction-filled.png', 8);
    // clear it again so the device is left as found
    await clickIf(page, '#clear-correction');
    await page.waitForTimeout(900);
  }
};

// Pressure page (may render a disabled state if no transducer is configured).
groups.pressureB = async (page) => {
  await page.goto(HOST + '/pressure.htm', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await settle(page, 3000);
  await shot(page, 'YT-094-pressure-page.png');
  if (await clickIf(page, 'button:has-text("Calibrate"), [onclick*="calibrate"]')) {
    await page.waitForTimeout(800);
    const dlg = page.locator('#dlg_calibrate');
    if (await dlg.count() && await dlg.isVisible().catch(() => false)) {
      await shot(page, 'YT-095-pressure-cal-step1.png');
    }
  }
};

// Dashboard empty-state figures that do not disturb the current configuration.
groups.dashboardC = async (page) => {
  await page.goto(HOST + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => typeof window.BChart !== 'undefined', { timeout: 20000 }).catch(() => {});
  await settle(page, 4500);
  await maskPersonal(page);
  await settle(page, 300);

  // a real, current status card
  await shotOf(page, '#status', 'YT-010-status-states.png', 10);

  // notes card with the text masked, exactly as published
  await shotOf(page, '.dash-note-card', 'YT-021-notes-card.png', 8);

  // keg rows: both scales as they are now
  await shotOf(page, '.card.keg-status-section', 'YT-014-kegs-card.png', 8);
};

// ---------------------------------------------------------------- reachable leftovers

// Everything here is read-only or dismiss-only on the device.
groups.leftovers = async (page, ctx, mobile) => {
  if (mobile) {
    await page.goto(HOST + '/control.htm', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await settle(page, 3000);
    await shot(page, 'YT-005-control-mobile.png');
    return;
  }

  // ---- independent mode: ramp source and the predictive heater block
  await page.goto(HOST + '/control.htm', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await settle(page, 3000);
  await seg(page, 'method', 'ind');
  await page.waitForTimeout(600);

  const adv = page.locator('details.ctrl-fold').first();
  if (await adv.count()) {
    await adv.evaluate((el) => { el.open = true; }).catch(() => {});
    await page.waitForTimeout(600);
    await shotOf(page, 'details.ctrl-fold', 'YT-031-predictive-heater.png', 8);
  }

  await seg(page, 'hsrc', 'ramp');
  await page.waitForTimeout(900);
  await shot(page, 'YT-030-control-independent-ramp.png');

  // ---- dialogs that only need opening
  if (await clickIf(page, '#easybtn')) {
    await page.waitForTimeout(800);
    const dlg = page.locator('#dlg_easy');
    if (await dlg.count() && await dlg.isVisible().catch(() => false)) {
      await shot(page, 'YT-042-easy-ramp-wizard.png');
      // dismiss with the cancel button only
      await page.locator('#dlg_easy .btn').first().click({ force: true }).catch(() => {});
    }
  }

  if (await clickIf(page, '#loadbtn')) {
    await page.waitForTimeout(1500);
    const list = page.locator('#profile-list-pane');
    if (await list.count() && await list.isVisible().catch(() => false)) {
      await shot(page, 'YT-039-profile-list-dialog.png');
    } else log('profile list did not open — YT-039 skipped');
  }

  // ---- control: the "no changes to apply" note, without pressing Apply
  await page.goto(HOST + '/control.htm', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await settle(page, 3000);
  await shotOf(page, '.cf', 'YT-121-control-no-changes.png', 10);
};

groups.leftovers2 = async (page) => {
  // ---- device setup: a pin warning, and the remove confirmation (dismissed)
  await page.goto(HOST + '/setup.htm', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(
    () => document.querySelectorAll('#device-list div.device-container').length > 0,
    { timeout: 30000 },
  ).catch(() => {});
  await settle(page, 2500);

  // pick a forbidden pin on the first user-added pin device, capture the warning, revert
  const changed = await page.evaluate(() => {
    const sel = document.querySelector('#device-list select.device-pin-choice');
    if (!sel) return false;
    const before = sel.value;
    const bad = [...sel.options].find((o) => !o.disabled && /^(0|2|5|12|15)$/.test(o.value));
    if (!bad) return false;
    sel.value = bad.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    sel.setAttribute('data-restore', before);
    return true;
  }).catch(() => false);
  if (changed) {
    await page.waitForTimeout(800);
    const card = page.locator('#device-list div.device-container').first();
    if (await card.count()) {
      const b = await card.boundingBox();
      if (b) await page.screenshot({ path: path.join(OUT, 'YT-061-device-pin-warning.png'),
        clip: { x: Math.max(0, b.x - 8), y: Math.max(0, b.y - 8),
                width: Math.min(1410, b.width + 16), height: Math.min(900, b.height + 16) } });
      log('saved YT-061-device-pin-warning.png');
    }
    await page.evaluate(() => {
      const sel = document.querySelector('#device-list select.device-pin-choice');
      if (sel) {
        sel.value = sel.getAttribute('data-restore');
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  } else log('no user-added pin device — YT-061 skipped');

  // remove confirmation: dialog dismissed, nothing removed
  let dismissed = false;
  page.on('dialog', async (d) => { dismissed = true; await d.dismiss(); });
  const rm = page.locator('#device-list .device-remove, .device-container button:has-text("Remove")').first();
  if (await rm.count()) {
    await rm.click({ force: true }).catch(() => {});
    await page.waitForTimeout(1200);
    log('remove dialog dismissed:', dismissed);
  } else log('no removable device — YT-066 skipped');
  await page.removeAllListeners('dialog');

  // ---- EEPROM erase confirmation (dismissed; nothing is erased)
  let erased = false;
  page.on('dialog', async (d) => { erased = true; await d.dismiss(); });
  const eraseBtn = page.locator('button.setup-danger, [onclick="erase()"]').first();
  if (await eraseBtn.count()) {
    await eraseBtn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(1500);
    log('erase dialog shown and dismissed:', erased);
  }
  await page.removeAllListeners('dialog');
};

groups.leftovers3 = async (page) => {
  // ---- logging: the recording state (a log is running right now)
  await page.goto(HOST + '/logging.htm', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await settle(page, 3500);
  await maskPersonal(page);
  await settle(page, 300);
  const rec = await page.locator('#logstopinput').isVisible().catch(() => false);
  if (rec) {
    await shotOf(page, '.card:has(#logstopinput)', 'YT-082-logs-recording.png', 8);
  } else log('no recording session — YT-082 skipped');

  // MQTT collapsed
  const mqtt = page.locator('#mqtt').first();
  if (await mqtt.count()) {
    await mqtt.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(400);
    await shotOf(page, '#mqtt', 'YT-090-mqtt-collapsed.png', 8);
  }

  // format notation popup
  if (await clickIf(page, 'a:has-text("Notations"), .notation, #formatlist')) {
    await page.waitForTimeout(600);
  }
};

// ---------------------------------------------------------------- last reachable set

groups.final1 = async (page) => {
  // ---- backup dialog after a completed backup (only GETs are issued)
  await page.goto(HOST + '/config.htm', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await settle(page, 3000);
  await maskPersonal(page);
  await page.waitForTimeout(300);

  if (await clickIf(page, '[onclick*="Backup.init"]')) {
    await page.waitForTimeout(1000);
    const save = page.locator('#backup-diag button').filter({ hasText: 'Save' }).first();
    if (await save.count()) {
      const dl = page.waitForEvent('download', { timeout: 60000 }).catch(() => null);
      await save.click({ force: true }).catch(() => {});
      const got = await dl;
      log('backup triggered:', got ? 'download started' : 'no download event');
      await page.waitForTimeout(3000);
      await maskPersonal(page);
      await page.waitForTimeout(300);
      await shot(page, 'YT-054-backup-dialog-statuses.png');
    }
  }
  await page.evaluate(() => document.querySelectorAll('.modal').forEach((m) => { m.style.display = 'none'; }));

  // ---- format-notation table on the logging page
  await page.goto(HOST + '/logging.htm', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await settle(page, 3000);
  await maskPersonal(page);
  await page.evaluate(() => {
    const en = document.querySelector('#enabled');
    if (en && typeof syncRemoteLogCard === 'function') { en.checked = true; syncRemoteLogCard(); }
  });
  await page.waitForTimeout(800);
  const note = page.locator('a').filter({ hasText: 'Notations' }).first();
  if (await note.count()) {
    await note.hover().catch(() => {});
    await page.waitForTimeout(600);
    await shotOf(page, '#formatlist', 'YT-089-format-notation.png', 8);
  } else log('notation link not found — YT-089 skipped');
};

groups.final2 = async (page) => {
  // ---- gravity calibration dialog with the coefficient result visible behind it
  await page.goto(HOST + '/gravity.htm', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await settle(page, 3000);
  if (await clickIf(page, '#addbutton')) {
    await page.waitForTimeout(900);
    const dlg = page.locator('#dlg_addcalpoint');
    if (await dlg.count() && await dlg.isVisible().catch(() => false)) {
      // close it with the dialog's own dismiss button, never "OK"
      const cancel = page.locator('#dlg_addcalpoint button').first();
      await cancel.click({ force: true }).catch(() => {});
      await page.waitForTimeout(800);
    }
    await page.evaluate(() => {
      const d = document.querySelector('#dlg_addcalpoint');
      if (d) d.style.display = 'none';
    });
  }
  await settle(page, 500);
  await shot(page, 'YT-076-gravity-calibration-result.png');

  // ---- pressure page state as it is (disabled or enabled)
  await page.goto(HOST + '/pressure.htm', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await settle(page, 3000);
  await shot(page, 'YT-097-pressure-disabled.png');
};

// ---------------------------------------------------------------- batches

// Four batches, one per agent. Each batch is a list of [label, fn, mobile].
const BATCHES = {
  b1: [
    ['dashboard extra', groups.dashboard2, false],
    ['dashboard mobile', groups.dashboard, true],
    ['gravity mobile', groups.gravity, true],
  ],
  b2: [
    ['control', groups.control, false],
    ['control dialogs', groups.control2, false],
  ],
  b3: [
    ['settings', groups.settings, false],
    ['device setup', groups.setup, false],
  ],
  b4: [
    ['hydrometer', groups.gravity, false],
    ['logging', groups.logging, false],
  ],
  b5: [
    ['scale', groups.scale, false],
    ['scale mobile', groups.scale, true],
    ['pressure', groups.pressure, false],
  ],
  mobile: [
    ['dashboard mobile', groups.dashboard, true],
    ['control mobile', groups.control, true],
    ['scale mobile', groups.scale, true],
    ['logs mobile', groups.logging, true],
    ['gravity mobile', groups.gravity, true],
  ],
  b9: [
    ['final1', groups.final1, false],
    ['final2', groups.final2, false],
  ],
  b8: [
    ['leftovers', groups.leftovers, false],
    ['leftovers2', groups.leftovers2, false],
    ['leftovers3', groups.leftovers3, false],
    ['control mobile', groups.control, true],
  ],
  b7: [
    ['settings corrected', groups.settingsB, false],
    ['scale extras', groups.scaleB, false],
    ['pressure', groups.pressureB, false],
    ['dashboard extras', groups.dashboardC, false],
  ],
  b6: [
    ['ota', groups.ota, false],
    ['viewer', groups.viewer, false],
    ['chrome', groups.chrome, false],
    ['scale', groups.scale, false],
  ],
};

// ---------------------------------------------------------------- main

(async () => {
  // A name is valid if it is a batch (b1..b6) or a single group (dashboard, control, ...).
  if (!BATCHES[group] && !groups[group]) {
    console.error('unknown group', group, '— valid:', Object.keys(BATCHES).join(','), Object.keys(groups).join(','));
    process.exit(2);
  }

  // stagger: slot n waits n * (gap / slots) before its first navigation
  const stagger = Math.round((GAP / SLOTS) * SLOT);
  log(`start in ${stagger} ms (gap ${GAP} ms, slot ${SLOT}/${SLOTS})`);
  await sleep(stagger);

  if (stopped()) {
    log('device restarted earlier — aborting');
    process.exit(0);
  }

  const browser = await chromium.launch({ headless: true });
  let ok = 0;
  let failed = 0;

  async function runOne(label, mobile, fn) {
    if (stopped()) {
      log('stop flag set — aborting before', label);
      return;
    }
    const ctx = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      httpCredentials: { username: 'yeast2tap', password: 'yeast2tap' },
      ignoreHTTPSErrors: true,
    });
    const page = await ctx.newPage();
    try {
      await fn(page, ctx, mobile);
      ok++;
    } catch (e) {
      failed++;
      log('FAILED', label, e.message.split('\n')[0]);
    } finally {
      await ctx.close().catch(() => {});
    }
    await sleep(GAP);
  }

  try {
    if (BATCHES[group]) {
      for (const [label, fn, mobile] of BATCHES[group]) {
        await runOne(label, mobile, fn);
      }
    } else if (group === 'dashboard') await runOne('dashboard desktop', false, groups.dashboard);
    else if (group === 'dashboard2') await runOne('dashboard extra', false, groups.dashboard2);
else if (group === 'control') await runOne('control', false, groups.control);
    else if (group === 'control2') await runOne('control dialogs', false, groups.control2);
    else if (group === 'settings') await runOne('settings', false, groups.settings);
    else if (group === 'setup') await runOne('setup', false, groups.setup);
    else if (group === 'gravity') await runOne('gravity', false, groups.gravity);
    else if (group === 'logging') await runOne('logging', false, groups.logging);
    else if (group === 'pressure') await runOne('pressure', false, groups.pressure);
    else if (group === 'scale') await runOne('scale', false, groups.scale);
    else if (group === 'ota') await runOne('ota', false, groups.ota);
    else if (group === 'viewer') await runOne('viewer', false, groups.viewer);
    else if (groups[group]) await runOne(group, false, groups[group]);
  } finally {
    await browser.close().catch(() => {});
  }

  log(`done: ${ok} page passes, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
