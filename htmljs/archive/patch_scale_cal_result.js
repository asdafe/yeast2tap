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

const RENDER_OLD = 'Q("#calibration-state").textContent=e.calError?(e.calError==="tare"?"Zeroing failed":"Calibration failed")+": the reading changed by more than 1000 raw counts. Wait a moment and try again.":e.calibrated?"Calibrated":"Not calibrated"}';
const RENDER_NEW = 'Q("#calibration-state").textContent=this.calLabel(e)}';

const BLOCK_START = 'tare:function(){this.command({action:"tare",id:this.selectedId})},';
const BLOCK_END = 'this._calibrating&&!n&&(f&&alert(f),this.load()),this._calibrating=n},';

const BLOCK_NEW = [
  'calLabel:function(e){return e&&e.calibrating?(e.calAction==="tare"?"Zeroing":"Averaging")+" "+(e.calCount||0)+"/"+(e.calTarget||30)',
  ':e&&e.calError?(e.calError==="tare"?"Zeroing failed":"Calibration failed")+": the reading changed by more than 1000 raw counts. Wait a moment and try again."',
  ':e&&e.calResult?(e.calResult==="tare"?"Zeroed":"Calibrated")+", std dev "+this.countsText(e,e.calStdDev)',
  ':e&&e.calibrated?"Calibrated":"Not calibrated"},',
  'countsText:function(e,t){var a=Number(t||0).toFixed(1)+" raw counts",n=Math.abs(e.calFactor||0);return n>1e-6&&(a+=" ("+(t/n).toFixed(1)+" g)"),a},',
  'calSummary:function(e){if(e.calError)return this.calLabel(e);if(!e.calResult)return"The scale did not finish averaging. Check the HX711 wiring and try again.";',
  'var t=["tare"===e.calResult?"Zero completed successfully.":"Calibration completed successfully."];',
  't.push("Average: "+e.calMean+" raw counts");"factor"===e.calResult&&t.push("Factor: "+Number(e.calFactor).toFixed(3)+" raw counts per gram");',
  't.push("Standard deviation: "+this.countsText(e,e.calStdDev));t.push("Spread (max - min): "+this.countsText(e,e.calSpread));',
  't.push("Samples: "+(e.calTarget||30));return t.join("\\n")},',
  'tare:function(){this.runCalibration({action:"tare",id:this.selectedId})},',
  'calibrate:function(){this.runCalibration({action:"calibrate",id:this.selectedId,knownWeightGrams:parseFloat(Q("#known-weight").value)})},',
  'runCalibration:function(e){var t=this,a=this.selectedId;Q("#tare-button").disabled=!0,Q("#calibrate-button").disabled=!0,',
  'Q("#calibration-state").textContent="tare"===e.action?"Zeroing...":"Averaging...",',
  's_ajax({url:"/scale",m:"POST",data:"data="+encodeURIComponent(JSON.stringify(e)),success:function(){t.pollCalibration(a,Date.now())},',
  'fail:function(e){alert("Scale request failed: "+e),t.load()}})},',
  'pollCalibration:function(n,s){var i=this;setTimeout(function(){s_ajax({url:"/scale",m:"GET",success:function(e){',
  'var t=JSON.parse(e),a=t.scales&&t.scales[n];if(!a)return i.load();n===i.selectedId&&i.updateStatus(t);',
  'if(a.calibrating&&Date.now()-s<3e4)return i.pollCalibration(n,s);alert(i.calSummary(a)),i.load()},',
  'fail:function(){Date.now()-s<3e4?i.pollCalibration(n,s):i.load()}})},500)},',
  'confirmKegChange:function(){this.command({action:"kegChange",id:this.selectedId})},',
  'command:function(e){var t=this;this.post(e,null,function(){t.load()})},',
  'post:function(e,t,a){var s=this;s_ajax({url:"/scale",m:"POST",data:"data="+encodeURIComponent(JSON.stringify(e)),success:function(){t&&alert(t),a?a():s.load()},fail:function(e){alert("Scale request failed: "+e)}})},',
  'updateStatus:function(e){var t=e.scales&&e.scales[this.selectedId];if(!t)return;var n=!!t.calibrating;',
  'Q("#gross-weight").textContent=!n&&t.calibrated&&null!==t.grossGrams?Number(t.grossGrams).toFixed(0)+" g":Number(t.rawCounts||0)+" raw counts",',
  'Q("#scale-state").textContent=n?this.calLabel(t):["Disabled","No keg","Settling","Stable","Change candidate"][t.state]||"Unknown",',
  'Q("#keg-temperature").textContent=null===t.temperatureC?"--":Number(t.temperatureC).toFixed(1)+" C",',
  'Q("#calibration-state").textContent=this.calLabel(t),Q("#tare-button").disabled=n,Q("#calibrate-button").disabled=n},',
].join('');

function patch(file) {
  let html = fs.readFileSync(file, 'utf8');
  if (html.includes('Zero completed successfully.')) return;
  if (count(html, RENDER_OLD) !== 1) throw new Error(file + ' render ' + count(html, RENDER_OLD));
  html = html.replace(RENDER_OLD, () => RENDER_NEW);
  if (count(html, BLOCK_START) !== 1 || count(html, BLOCK_END) !== 1) throw new Error(file + ' block anchors');
  const s = html.indexOf(BLOCK_START);
  const e = html.indexOf(BLOCK_END) + BLOCK_END.length;
  html = html.slice(0, s) + BLOCK_NEW + html.slice(e);
  fs.writeFileSync(file, html);
}

const root = __dirname;
patch(path.join(root, 'dist', 'english', 'scale.htm'));
patch(path.join(root, 'dist', 'scale.tmpl.htm'));
const gz = zlib.gzipSync(fs.readFileSync(path.join(root, 'dist', 'english', 'scale.htm')));
fs.writeFileSync(path.join(root, 'dist', 'english', 'scale.htm.gz'), gz);
fs.writeFileSync(path.join(root, '..', 'wdoc', 'english_scale_htm.h'), formatHeader('scale_htm_gz', gz));
console.log('patched scale calibration result UI');
