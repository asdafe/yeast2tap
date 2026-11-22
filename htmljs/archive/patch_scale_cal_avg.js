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
function gzipFile(src, dst) {
  fs.writeFileSync(dst, zlib.gzipSync(fs.readFileSync(src)));
}

const SCALE_STATUS_OLD = 'updateStatus:function(e){var t=e.scales&&e.scales[this.selectedId];t&&(Q("#gross-weight").textContent=t.calibrated&&null!==t.grossGrams?Number(t.grossGrams).toFixed(0)+" g":Number(t.rawCounts||0)+" raw counts",Q("#scale-state").textContent=["Disabled","No keg","Settling","Stable","Change candidate"][t.state]||"Unknown",Q("#keg-temperature").textContent=null===t.temperatureC?"--":Number(t.temperatureC).toFixed(1)+" C",Q("#calibration-state").textContent=t.calibrated?"Calibrated":"Not calibrated")}';
const SCALE_STATUS_NEW = 'updateStatus:function(e){var t=e.scales&&e.scales[this.selectedId];if(!t)return;var n=!!t.calibrating,a=(t.calAction==="tare"?"Zeroing":"Averaging")+" "+(t.calCount||0)+"/"+(t.calTarget||30);Q("#gross-weight").textContent=!n&&t.calibrated&&null!==t.grossGrams?Number(t.grossGrams).toFixed(0)+" g":Number(t.rawCounts||0)+" raw counts",Q("#scale-state").textContent=n?a:["Disabled","No keg","Settling","Stable","Change candidate"][t.state]||"Unknown",Q("#keg-temperature").textContent=null===t.temperatureC?"--":Number(t.temperatureC).toFixed(1)+" C",Q("#calibration-state").textContent=n?a:t.calibrated?"Calibrated":"Not calibrated",Q("#tare-button").disabled=n,Q("#calibrate-button").disabled=n,this._calibrating&&!n&&this.load(),this._calibrating=n}';
const SCALE_HELP_OLD = 'Leave the platform empty and select Zero. Place a known weight on the platform, enter its mass and calculate the factor. Verify with a second known weight. Empty keg mass is separate from platform zero.';
const SCALE_HELP_NEW = 'Leave the platform empty and select Zero; the controller averages 30 raw readings and does not wait for a perfectly still value. Place a known weight on the platform, enter its mass and calculate the factor the same way. Verify with a second known weight. Empty keg mass is separate from platform zero.';
const SETUP_RENDER_OLD = 'n.querySelector(".scale-live-value").textContent=e.configured?e.stable?e.calibrated?Number(e.grossGrams).toFixed(0)+" g stable":Number(e.rawCounts)+" raw counts":"Waiting for stable reading":"Not configured"';
const SETUP_RENDER_NEW = 'n.querySelector(".scale-live-value").textContent=e.configured?e.calibrating?(e.calAction==="tare"?"Zeroing ":"Averaging ")+(e.calCount||0)+"/"+(e.calTarget||30):e.calibrated&&null!=e.grossGrams?Number(e.grossGrams).toFixed(0)+" g":Number(e.rawCounts||0)+" raw counts":"Not configured"';
const SETUP_REFRESH_OLD = 'e.querySelector(".scale-live-value").textContent=n.configured?t.use?n.stable?n.calibrated?Number(n.grossGrams).toFixed(0)+" g stable":Number(n.rawCounts)+" raw counts":"Waiting for stable reading":"Scale disabled":"Not configured"';
const SETUP_REFRESH_NEW = 'e.querySelector(".scale-live-value").textContent=n.configured?t.use?n.calibrating?(n.calAction==="tare"?"Zeroing ":"Averaging ")+(n.calCount||0)+"/"+(n.calTarget||30):n.calibrated&&null!=n.grossGrams?Number(n.grossGrams).toFixed(0)+" g":Number(n.rawCounts||0)+" raw counts":"Scale disabled":"Not configured"';

function patchScale(file) {
  let html = fs.readFileSync(file, 'utf8');
  if (html.includes('averages 30 raw readings')) return false;
  if (count(html, SCALE_STATUS_OLD) !== 1) throw new Error(file + ' status ' + count(html, SCALE_STATUS_OLD));
  if (count(html, SCALE_HELP_OLD) !== 1) throw new Error(file + ' help ' + count(html, SCALE_HELP_OLD));
  html = html.replace(SCALE_STATUS_OLD, SCALE_STATUS_NEW).replace(SCALE_HELP_OLD, SCALE_HELP_NEW);
  fs.writeFileSync(file, html);
  return true;
}
function patchSetup(file) {
  let html = fs.readFileSync(file, 'utf8');
  if (html.includes('calAction==="tare"?"Zeroing "')) return false;
  if (count(html, SETUP_RENDER_OLD) !== 1) throw new Error(file + ' render ' + count(html, SETUP_RENDER_OLD));
  if (count(html, SETUP_REFRESH_OLD) !== 1) throw new Error(file + ' refresh ' + count(html, SETUP_REFRESH_OLD));
  html = html.replace(SETUP_RENDER_OLD, SETUP_RENDER_NEW).replace(SETUP_REFRESH_OLD, SETUP_REFRESH_NEW);
  fs.writeFileSync(file, html);
  return true;
}

const root = path.join(__dirname);
patchScale(path.join(root, 'dist', 'english', 'scale.htm'));
patchScale(path.join(root, 'dist', 'scale.tmpl.htm'));
patchSetup(path.join(root, 'dist', 'english', 'setup.htm'));
patchSetup(path.join(root, 'dist', 'setup.tmpl.htm'));

gzipFile(path.join(root, 'dist', 'english', 'scale.htm'), path.join(root, 'dist', 'english', 'scale.htm.gz'));
gzipFile(path.join(root, 'dist', 'english', 'setup.htm'), path.join(root, 'dist', 'english', 'setup.htm.gz'));
fs.writeFileSync(path.join(root, '..', 'wdoc', 'english_scale_htm.h'), formatHeader('scale_htm_gz', fs.readFileSync(path.join(root, 'dist', 'english', 'scale.htm.gz'))));
fs.writeFileSync(path.join(root, '..', 'wdoc', 'english_setup_htm.h'), formatHeader('setup_htm_gz', fs.readFileSync(path.join(root, 'dist', 'english', 'setup.htm.gz'))));
console.log('patched scale calibration averaging UI');
