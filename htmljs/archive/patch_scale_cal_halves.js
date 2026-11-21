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
  [
    '<span id=calibration-state>Not calibrated</span></div>',
    '<span id=calibration-state>Not calibrated</span></div>' +
      '<div class=scale-fields><label>Stability limit (raw counts)<input id=cal-limit type=number min=1 step=1></label>' +
      '<button class=btn id=save-cal-limit>Save limit</button><span id=cal-limit-grams class=scale-note></span></div>' +
      '<p class=scale-help>Zero and Calculate factor compare the average of the first 15 readings with the last 15. ' +
      'If they differ by more than this limit, the load changed during averaging and nothing is saved. ' +
      'Raise it if a still but noisy scale keeps failing; lower it to catch smaller changes.</p>',
  ],
  [
    'Q("#save-keg").onclick=this.saveKeg.bind(this),',
    'Q("#save-keg").onclick=this.saveKeg.bind(this),Q("#save-cal-limit").onclick=this.saveCalLimit.bind(this),Q("#cal-limit").oninput=this.showLimitGrams.bind(this),',
  ],
  [
    'Q("#calibration-state").textContent=this.calLabel(e)}',
    'Q("#calibration-state").textContent=this.calLabel(e),Q("#cal-limit").value=e.calibrationLimitCounts||1e3,this.showLimitGrams()},' +
      'showLimitGrams:function(){var e=this.currentScale(),t=Math.abs(e.calibrationFactor||0),a=parseFloat(Q("#cal-limit").value)||0;' +
      'Q("#cal-limit-grams").textContent=e.calibrated&&t>1e-6?"about "+(a/t).toFixed(1)+" g":""},' +
      'saveCalLimit:function(){var e=parseInt(Q("#cal-limit").value,10);if(!(e>=1&&e<=8388607))return alert("Enter a limit between 1 and 8388607 raw counts.");' +
      'this.currentScale().calibrationLimitCounts=e,this.saveUse()}',
  ],
  [
    '": the reading changed by more than 1000 raw counts. Wait a moment and try again."',
    '": the load changed during averaging. Wait a moment and try again."',
  ],
];

const SUMMARY_START = 'calSummary:function(e){';
const SUMMARY_END = 'tare:function(){this.runCalibration';
const SUMMARY_NEW =
  'calSummary:function(e){if(!e.calResult&&!e.calError)return"The scale did not finish averaging. Check the HX711 wiring and try again.";var t=[];' +
  'e.calError?(t.push(this.calLabel(e)),t.push("Nothing was saved. If the scale was still and only noisy, raise the stability limit.")):' +
  '(t.push("tare"===e.calResult?"Zero completed successfully.":"Calibration completed successfully."),t.push("Average: "+e.calMean+" raw counts"),' +
  '"factor"===e.calResult&&t.push("Factor: "+Number(e.calFactor).toFixed(3)+" raw counts per gram"));' +
  't.push("First 15 vs last 15 average: "+this.countsText(e,e.calHalfDiff)+", limit "+this.countsText(e,e.calLimit));' +
  't.push("Standard deviation: "+this.countsText(e,e.calStdDev));t.push("Spread (max - min): "+this.countsText(e,e.calSpread));' +
  't.push("Samples: "+(e.calTarget||30));return t.join("\\n")},';

function patch(file) {
  let html = fs.readFileSync(file, 'utf8');
  if (html.includes('First 15 vs last 15 average')) return;
  for (const [o, n] of replacements) {
    if (count(html, o) !== 1) throw new Error(file + ' anchor ' + count(html, o) + ': ' + o.slice(0, 60));
    html = html.replace(o, () => n);
  }
  if (count(html, SUMMARY_START) !== 1 || count(html, SUMMARY_END) !== 1) throw new Error(file + ' summary anchors');
  const s = html.indexOf(SUMMARY_START);
  const e = html.indexOf(SUMMARY_END);
  html = html.slice(0, s) + SUMMARY_NEW + html.slice(e);
  fs.writeFileSync(file, html);
}

const root = __dirname;
patch(path.join(root, 'dist', 'english', 'scale.htm'));
patch(path.join(root, 'dist', 'scale.tmpl.htm'));
const gz = zlib.gzipSync(fs.readFileSync(path.join(root, 'dist', 'english', 'scale.htm')));
fs.writeFileSync(path.join(root, 'dist', 'english', 'scale.htm.gz'), gz);
fs.writeFileSync(path.join(root, '..', 'wdoc', 'english_scale_htm.h'), formatHeader('scale_htm_gz', gz));
console.log('patched scale calibration halves limit UI');
