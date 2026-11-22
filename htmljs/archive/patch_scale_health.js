const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function count(t, s) { return t.split(s).length - 1; }
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
function apply(file, marker, replacements) {
  let html = fs.readFileSync(file, 'utf8');
  if (html.includes(marker)) return;
  for (const [o, n] of replacements) {
    if (count(html, o) !== 1) throw new Error(file + ' anchor ' + count(html, o) + ': ' + o.slice(0, 60));
    html = html.replace(o, () => n);
  }
  fs.writeFileSync(file, html);
}

const NO_SIGNAL = '"No signal - check HX711 wiring"';

const scaleReplacements = [
  [
    'e.action="settings",e.use=',
    'e.action="settings",e.scales.forEach(function(e){delete e.calibrated,delete e.zeroOffset,delete e.calibrationFactor}),e.use=',
  ],
  [
    '+": the load changed during averaging. Wait a moment and try again.":e&&e.calResult?',
    '+": "+({noLoad:"the known weight barely changed the reading. Place the weight on the platform and try again.",' +
      'notZeroed:"zero the empty platform first.",timeout:"the scale stopped sending readings. Check the HX711 wiring and try again."}' +
      '[e.calErrorReason]||"the load changed during averaging. Wait a moment and try again."):e&&e.calResult?',
  ],
  [
    'e.calError?(t.push(this.calLabel(e)),t.push("Nothing was saved. If the scale was still and only noisy, raise the stability limit.")):',
    'if(e.calError&&void 0===e.calMean)return this.calLabel(e);e.calError?(t.push(this.calLabel(e)),' +
      't.push("noLoad"===e.calErrorReason?"Nothing was saved.":"Nothing was saved. If the scale was still and only noisy, raise the stability limit.")):',
  ],
  ['"Change candidate"][t.state]', '"Change candidate",' + NO_SIGNAL + '][t.state]'],
];

const setupReplacements = [
  ['textContent=e.configured?e.calibrating?', 'textContent=e.configured?5===e.state?' + NO_SIGNAL + ':e.calibrating?'],
  ['textContent=n.configured?t.use?n.calibrating?', 'textContent=n.configured?t.use?5===n.state?' + NO_SIGNAL + ':n.calibrating?'],
  ['calibrated:!!n.calibrated,zeroOffset:n.zeroOffset||0,calibrationFactor:n.calibrationFactor||0,', ''],
];

const root = __dirname;
for (const f of ['dist/english/scale.htm', 'dist/scale.tmpl.htm']) apply(path.join(root, f), 'notZeroed:"zero the empty', scaleReplacements);
for (const f of ['dist/english/setup.htm', 'dist/setup.tmpl.htm']) apply(path.join(root, f), '5===e.state?' + NO_SIGNAL, setupReplacements);

for (const [page, name] of [['scale', 'scale_htm_gz'], ['setup', 'setup_htm_gz']]) {
  const gz = zlib.gzipSync(fs.readFileSync(path.join(root, 'dist', 'english', page + '.htm')));
  fs.writeFileSync(path.join(root, 'dist', 'english', page + '.htm.gz'), gz);
  fs.writeFileSync(path.join(root, '..', 'wdoc', 'english_' + page + '_htm.h'), formatHeader(name, gz));
}
console.log('patched scale health/calibration guard UI');
