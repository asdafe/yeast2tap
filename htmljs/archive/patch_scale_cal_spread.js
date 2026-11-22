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

const FAIL = '(t.calError==="tare"?"Zeroing failed":"Calibration failed")+": the reading changed by more than 1000 raw counts. Wait a moment and try again."';

const STATUS_OLD = 'a=(t.calAction==="tare"?"Zeroing":"Averaging")+" "+(t.calCount||0)+"/"+(t.calTarget||30);';
const STATUS_NEW = 'a=(t.calAction==="tare"?"Zeroing":"Averaging")+" "+(t.calCount||0)+"/"+(t.calTarget||30),f=t.calError?' + FAIL + ':null;';
const STATE_OLD = 'Q("#calibration-state").textContent=n?a:t.calibrated?"Calibrated":"Not calibrated"';
const STATE_NEW = 'Q("#calibration-state").textContent=n?a:f||(t.calibrated?"Calibrated":"Not calibrated")';
const RELOAD_OLD = 'this._calibrating&&!n&&this.load()';
const RELOAD_NEW = 'this._calibrating&&!n&&(f&&alert(f),this.load())';
const RENDER_OLD = 'Q("#calibration-state").textContent=e.calibrated?"Calibrated":"Not calibrated"}';
const RENDER_NEW = 'Q("#calibration-state").textContent=e.calError?' + FAIL.replace(/t\.calError/g, 'e.calError') + ':e.calibrated?"Calibrated":"Not calibrated"}';

function patch(file) {
  let html = fs.readFileSync(file, 'utf8');
  if (html.includes('more than 1000 raw counts')) return;
  for (const [o, n] of [[STATUS_OLD, STATUS_NEW], [STATE_OLD, STATE_NEW], [RELOAD_OLD, RELOAD_NEW], [RENDER_OLD, RENDER_NEW]]) {
    if (count(html, o) !== 1) throw new Error(file + ' anchor ' + count(html, o) + ': ' + o.slice(0, 50));
    html = html.replace(o, () => n);
  }
  fs.writeFileSync(file, html);
}

const root = __dirname;
patch(path.join(root, 'dist', 'english', 'scale.htm'));
patch(path.join(root, 'dist', 'scale.tmpl.htm'));
const gz = zlib.gzipSync(fs.readFileSync(path.join(root, 'dist', 'english', 'scale.htm')));
fs.writeFileSync(path.join(root, 'dist', 'english', 'scale.htm.gz'), gz);
fs.writeFileSync(path.join(root, '..', 'wdoc', 'english_scale_htm.h'), formatHeader('scale_htm_gz', gz));
console.log('patched scale calibration spread guard UI');
