// Patch wdoc config/setup pages: full settings backup & restore.
// Adds to System backup: control constants (cc), control settings (cs), scale, parasite (ptc),
// humidity (rh), beer profile; fixes device backup fields (a,x,j,s,d,n).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const langs = ['english', 'spanish', 'slovak', 'portuguese-br', 'norwegian', 'italian', 'chinese'];
const wdocDir = path.join(__dirname, '..', 'wdoc');

function parseHeader(text) {
  const m = text.match(/const unsigned char (\w+)\[\] PROGMEM = \{([\s\S]*?)\};/);
  if (!m) throw new Error('array not found');
  return {
    name: m[1],
    bytes: Buffer.from(m[2].split(',').map((s) => s.trim()).filter(Boolean).map((s) => parseInt(s, 16))),
  };
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
function replaceOnce(t, oldS, newS, label) {
  const c = count(t, oldS);
  if (c !== 1) throw new Error(`${label}: anchor count ${c}`);
  return t.replace(oldS, () => newS);
}
function replaceBetween(t, startS, endS, newMid, label) {
  if (count(t, startS) !== 1) throw new Error(`${label}: start count ${count(t, startS)}`);
  const s = t.indexOf(startS);
  const e = t.indexOf(endS, s);
  if (e < 0) throw new Error(`${label}: end not found`);
  return t.slice(0, s) + newMid + t.slice(e);
}

const SETTINGS_OLD =
  'Settings=[{lb:"gdc",url:"/gdc?data",wurl:"/gdc",f:"json"},{lb:"rlog",url:"/log?data=1",wurl:"/log",f:"x-www-form-urlencoded"},' +
  '{lb:"pressure",url:"/psi",wurl:"/psi",f:"x-www-form-urlencoded"},{lb:"mqtt",url:"/mqtt",wurl:"/mqtt",f:"x-www-form-urlencoded"},' +
  '{lb:"syscfg",url:"/config?cfg=1",wurl:"/config?nb=1",f:"x-www-form-urlencoded"}];';
const SETTINGS_NEW =
  'Settings=[{lb:"cc",ws:"c",wk:"C",f:"json"},{lb:"gdc",url:"/gdc?data",wurl:"/gdc",f:"json"},' +
  '{lb:"rlog",url:"/log?data=1",wurl:"/log",f:"x-www-form-urlencoded"},' +
  '{lb:"pressure",url:"/psi",wurl:"/psi",f:"x-www-form-urlencoded"},{lb:"mqtt",url:"/mqtt",wurl:"/mqtt",f:"x-www-form-urlencoded"},' +
  '{lb:"scale",url:"/scale",wurl:"/scale",f:"x-www-form-urlencoded"},' +
  '{lb:"ptc",url:"/ptc",wurl:"/ptc",f:"x-www-form-urlencoded",pn:"c"},' +
  '{lb:"rh",url:"/rh",wurl:"/rh",f:"x-www-form-urlencoded",rh:1},' +
  '{lb:"profile",url:"/tschedule",wurl:"/tschedule",f:"x-www-form-urlencoded"},' +
  '{lb:"cs",ws:"s",wk:"S",f:"json"},' +
  '{lb:"syscfg",url:"/config?cfg=1",wurl:"/config?nb=1",f:"x-www-form-urlencoded"}];';

const CONVERT_NEW =
  'convertDev:function(e){for(var n=[],t=0;t<e.length;t++){var a=e[t],o={i:a.i,c:a.c,b:a.b,f:a.f,h:a.h,p:a.p};' +
  '["a","x","j","s","d","n"].forEach(function(k){void 0!==a[k]&&(o[k]=a[k])}),n.push(o)}return n},' +
  // control constants/settings go through the controller websocket ("c"/"s" read, "j{}" write)
  'wsGet:function(S,cb){var done=!1,prev=BWF.handlers[S.wk],tm;' +
  'function fin(r){done||(done=!0,clearTimeout(tm),void 0===prev?delete BWF.handlers[S.wk]:BWF.on(S.wk,prev),cb(r))}' +
  '0!=BWF.status()?cb(!1):(BWF.on(S.wk,function(c){fin(JSON.stringify(c))}),tm=setTimeout(function(){fin(!1)},3e3),BWF.send(S.ws))},' +
  'wsPut:function(S,d,cb){if(0!=BWF.status())return void cb(!1);var k=Object.keys(d),i=0;' +
  '(function nx(){if(i>=k.length)return void setTimeout(function(){cb(!0)},500);' +
  'for(var o={},c=0;i<k.length&&c<6;i++,c++)o[k[i]]=d[k[i]];BWF.send("j"+JSON.stringify(o)),setTimeout(nx,150)})()},';

const GET_OLD = 'function(e,n){s_ajax({url:Settings[e].url,m:"GET",success:function(e){n(e)},fail:function(){n(!1)}})}';
const GET_NEW = 'function(e,n){var S=Settings[e];S.ws?Backup.wsGet(S,n):s_ajax({url:S.url,m:"GET",success:function(e){n(e)},fail:function(){n(!1)}})}';

const RESTORE_NEW =
  'restoreCfg:function(){Backup.processCfg(0,function(e,n){var S=Settings[e],d=window.data[S.lb];' +
  'if(void 0===d)return void n(-1);if(S.ws)return void Backup.wsPut(S,d,n);' +
  'var t=JSON.stringify(d);t=S.rh?"m="+d.m+"&t="+d.t:"json"==S.f?t:(S.pn||"data")+"="+encodeURIComponent(t);' +
  's_ajax({url:S.wurl,m:"POST",data:t,mime:"application/"+S.f,success:function(e){n(e)},fail:function(){n(!1)}})},' +
  'function(e,n){mark(e,-1===n?"notavailable":!1!==n?"uploaded":"uploadfailed")},function(){unprompt()})}';

const ROW_ANCHOR = '<span class=syscfg-status></span></li>';
const li = (label, cls) => `<li layout horizontal main-justified><span>${label}</span><span class=${cls}-status></span></li>`;
const ROWS_NEW = ROW_ANCHOR +
  li('Control constants', 'cc') + li('Control mode/targets', 'cs') + li('Scale', 'scale') +
  li('Parasite control', 'ptc') + li('Humidity control', 'rh') + li('Beer profile', 'profile');

const SETUP_OLD = '["a","x","j","s"].forEach(function(e){void 0!==t[e]&&(i[e]=t[e])})';
const SETUP_NEW = '["a","x","j","s","d","n"].forEach(function(e){void 0!==t[e]&&(i[e]=t[e])})';

function patchConfig(html, label) {
  if (html.includes('wsGet:function')) return html; // already patched
  let t = html;
  t = replaceOnce(t, SETTINGS_OLD, SETTINGS_NEW, label + ' Settings');
  t = replaceBetween(t, 'convertDev:function(e){', 'conBWF:function', CONVERT_NEW, label + ' convertDev');
  t = replaceOnce(t, GET_OLD, GET_NEW, label + ' get');
  t = replaceBetween(t, 'restoreCfg:function(){', ',dataLoaded:function', RESTORE_NEW, label + ' restoreCfg');
  t = replaceOnce(t, ROW_ANCHOR, ROWS_NEW, label + ' rows');
  return t;
}
function patchSetup(html, label) {
  if (html.includes(SETUP_NEW)) return html;
  return replaceOnce(html, SETUP_OLD, SETUP_NEW, label + ' setup');
}

const vm = require('vm');
function checkScripts(html, label) {
  const re = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g;
  let m, n = 0;
  while ((m = re.exec(html))) { n++; new vm.Script(m[1]); }
  console.log(`${label}: ${n} scripts OK`);
}

for (const lang of langs) {
  for (const [page, fn] of [['config', patchConfig], ['setup', patchSetup]]) {
    const file = path.join(wdocDir, `${lang}_${page}_htm.h`);
    const { name, bytes } = parseHeader(fs.readFileSync(file, 'utf8'));
    const html = zlib.gunzipSync(bytes).toString('utf8');
    const out = fn(html, `${lang}/${page}`);
    if (out === html) { console.log(`${lang}/${page}: unchanged`); continue; }
    checkScripts(out, `${lang}/${page}`);
    const gz = zlib.gzipSync(Buffer.from(out, 'utf8'), { level: 9 });
    fs.writeFileSync(file, formatHeader(name, gz));
    console.log(`${lang}/${page}: ${html.length} -> ${out.length}, gz ${gz.length}`);
  }
}
