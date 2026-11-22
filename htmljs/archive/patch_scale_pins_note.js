// Patch wdoc english setup: scale wiring note (GPIO 25/26/27/33) and unlocked pin list.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const vm = require('vm');

const file = path.join(__dirname, '..', 'wdoc', 'english_setup_htm.h');

function parseHeader(text) {
  const m = text.match(/const unsigned char (\w+)\[\] PROGMEM = \{([\s\S]*?)\};/);
  return { name: m[1], bytes: Buffer.from(m[2].split(',').map((s) => s.trim()).filter(Boolean).map((s) => parseInt(s, 16))) };
}
function formatHeader(name, buf) {
  const lines = [`const unsigned char ${name}[] PROGMEM = {`];
  for (let i = 0; i < buf.length; i += 12) {
    const chunk = [];
    for (let j = i; j < Math.min(i + 12, buf.length); j++) chunk.push('0x' + buf[j].toString(16).padStart(2, '0'));
    lines.push('  ' + chunk.join(', ') + (i + 12 < buf.length ? ',' : ''));
  }
  lines.push('};', `unsigned int ${name}_len = ${buf.length};`, '');
  return lines.join('\n');
}
function count(t, s) { return t.split(s).length - 1; }

const RESERVED_OLD = '23:!0,25:!0,26:!0,27:!0,32:!0,33:!0,34:!0,36:!0}';
const RESERVED_NEW = '23:!0,32:!0,34:!0,36:!0}';
const NOTE_START = '<p>Suggested on the default ESP32 map';
const NOTE_NEW =
  '<p><strong>Wiring plan: 2 x HX711 (rotary encoder is disabled in this build)</strong></p><ul>' +
  '<li>GPIO 25 - HX711 #1 DT (scale 1 data input)</li><li>GPIO 26 - HX711 #1 SCK (scale 1 clock output)</li>' +
  '<li>GPIO 27 - HX711 #2 DT (scale 2 data input)</li><li>GPIO 33 - HX711 #2 SCK (scale 2 clock output)</li></ul>' +
  '<p>Power each HX711 from 3.3 V (ESP32 inputs are not 5 V tolerant) and join all grounds. Select the same GPIOs below. ' +
  'Do not use these pins for relays or a rotary encoder.</p>';

const { name, bytes } = parseHeader(fs.readFileSync(file, 'utf8'));
let html = zlib.gunzipSync(bytes).toString('utf8');
if (html.includes('Wiring plan: 2 x HX711')) { console.log('already patched'); process.exit(0); }
if (count(html, RESERVED_OLD) !== 1) throw new Error('reserved anchor ' + count(html, RESERVED_OLD));
html = html.replace(RESERVED_OLD, () => RESERVED_NEW);
if (count(html, NOTE_START) !== 1) throw new Error('note anchor ' + count(html, NOTE_START));
const s = html.indexOf(NOTE_START), e = html.indexOf('</p>', s) + 4;
html = html.slice(0, s) + NOTE_NEW + html.slice(e);
const re = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g; let m; while ((m = re.exec(html))) new vm.Script(m[1]);
const gz = zlib.gzipSync(Buffer.from(html, 'utf8'), { level: 9 });
fs.writeFileSync(file, formatHeader(name, gz));
console.log('patched, gz', gz.length);
