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

const replacements = [
  ['null===t.remainingLiters?"Calibration required":', 'null===t.remainingLiters?t.calibrated?"No keg on scale":"Calibration required":'],
  ['"Stable","Change candidate"][t.state]', '"Stable","Measuring","No signal - check HX711 wiring"][t.state]'],
];

function patch(html, name) {
  if (html.includes('"No keg on scale"')) return null;
  for (const [o, n] of replacements) {
    if (count(html, o) !== 1) throw new Error(name + ' anchor ' + count(html, o) + ': ' + o);
    html = html.replace(o, () => n);
  }
  return html;
}

const root = __dirname;
for (const f of ['dist/english/index.htm', 'dist/english/index_s.htm', 'dist/index.tmpl.htm', 'dist/index_s.tmpl.htm']) {
  const file = path.join(root, f);
  const html = patch(fs.readFileSync(file, 'utf8'), f);
  if (html !== null) fs.writeFileSync(file, html);
}
for (const page of ['index', 'index_s']) {
  const gz = zlib.gzipSync(fs.readFileSync(path.join(root, 'dist', 'english', page + '.htm')));
  fs.writeFileSync(path.join(root, 'dist', 'english', page + '.htm.gz'), gz);
}

// The embedded page carries direct patches that dist does not have, so patch it in place.
const headerFile = path.join(root, '..', 'wdoc', 'english_index_htm.h');
const header = fs.readFileSync(headerFile, 'utf8');
const bytes = Buffer.from(header.match(/\{([\s\S]*?)\};/)[1].split(',').map((s) => s.trim()).filter(Boolean).map((s) => parseInt(s, 16)));
const embedded = patch(zlib.gunzipSync(bytes).toString('utf8'), 'english_index_htm.h');
if (embedded !== null) fs.writeFileSync(headerFile, formatHeader('data_index_htm_gz', zlib.gzipSync(Buffer.from(embedded, 'utf8'), { level: 9 })));
console.log('patched main page keg labels');
