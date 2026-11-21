'use strict';

/*
 * i18n gate. Run after `grunt i18n` (npm run embed does it for you).
 *
 * What it checks
 *  1. Every locale file has exactly the same key set as english.json, and every
 *     value is a string. A missing key does NOT fail the build on its own:
 *     grunt-multi-lang-site-generator merges options.data across languages, so a
 *     key missing from a later locale silently renders the previous language's
 *     text. This check turns that into a build error.
 *  2. Every <%= key %> used in a template exists in english.json.
 *  3. No built page still contains a raw <%= %> marker.
 *  4. Parity: for every in-scope source file, the visible text of the file as it
 *     is at HEAD (all literals) equals the visible text of the current file
 *     rendered with english.json. This is what catches a keyed string that got
 *     typo'd, an attribute that lost its value, or text that was dropped.
 *  5. Nothing user-visible is left as a hardcoded literal in an in-scope file,
 *     unless it is listed in scripts/i18n-keep.txt.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const LOCALES = path.join(ROOT, 'src', 'locales');
const DIST = path.join(ROOT, 'dist');
const REPO = path.join(ROOT, '..');

// lodash 2.2.1, the same one the grunt generator uses, so <% %> behaves identically.
const _ = require(path.join(
  ROOT,
  'node_modules',
  'grunt-multi-lang-site-generator',
  'node_modules',
  'lodash'
));

const SCOPE = [
  'index.tmpl.html',
  'control.tmpl.html',
  'setup.tmpl.html',
  'logging.tmpl.html',
  'config.tmpl.html',
  'gravity.tmpl.html',
  'gravity_e32.tmpl.html',
  'pressure.tmpl.html',
  'scale.tmpl.html',
  'partials/header.html',
  'partials/footer.html',
  'partials/dash-body.html',
  'partials/theme-init.html',
  'js/script.js',
  'js/script-control.js',
  'js/script-scale.js',
  'js/script-setup.js',
  'js/script-logging.js',
  'js/script-config.js',
  'js/script-gravity.js',
  'js/script-gravity-e32.js',
  'js/script-pressure.js',
  'js/backup.js',
  'js/mqtt.js',
  'js/ptc.js',
  'js/capper.js',
];

const errors = [];
const warnings = [];

function fail(msg) {
  errors.push(msg);
}

function englishKeys() {
  return JSON.parse(fs.readFileSync(path.join(LOCALES, 'english.json'), 'utf8'));
}

// --- 1. locale key parity ------------------------------------------------

function checkLocales() {
  const english = englishKeys();
  const englishKeysList = Object.keys(english);
  const files = fs
    .readdirSync(LOCALES)
    .filter((f) => f.endsWith('.json') && f !== 'english.json');

  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(LOCALES, file), 'utf8'));
    const keys = Object.keys(data);
    const missing = englishKeysList.filter((k) => !(k in data));
    const extra = keys.filter((k) => !(k in english));
    if (missing.length) {
      fail(`${file}: ${missing.length} anahtar eksik (ör. ${missing.slice(0, 5).join(', ')})`);
    }
    if (extra.length) {
      fail(`${file}: ${extra.length} anahtar english.json'da yok (ör. ${extra.slice(0, 5).join(', ')})`);
    }
    for (const k of keys) {
      if (typeof data[k] !== 'string') {
        fail(`${file}: "${k}" değeri string değil (${typeof data[k]})`);
      }
    }
  }

  if (typeof english.page_lang !== 'string' || !english.page_lang) {
    fail('english.json: page_lang eksik');
  }
  for (const k of englishKeysList) {
    if (typeof english[k] !== 'string') fail(`english.json: "${k}" değeri string değil`);
  }
}

// --- 2. placeholders used in sources ------------------------------------

const KEY_RE = /<%=\s*([A-Za-z0-9_]+)\s*%>/g;

function checkPlaceholders() {
  const english = englishKeys();
  const files = [];
  walk(path.join(ROOT, 'src'), /\.(html|js)$/, files);
  for (const file of files) {
    const rel = relPosix(file);
    if (/vendor|dygraph|archive/.test(rel)) continue;
    const text = fs.readFileSync(file, 'utf8');
    let m;
    while ((m = KEY_RE.exec(text)) !== null) {
      if (!(m[1] in english)) fail(`${rel}: <%= ${m[1]} %> english.json'da yok`);
    }
    KEY_RE.lastIndex = 0;
  }
}

function walk(dir, ext, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'build' || e.name === 'archive') continue;
      walk(p, ext, acc);
    } else if (ext.test(e.name)) acc.push(p);
  }
}

function relPosix(p) {
  return path.relative(ROOT, p).replace(/\\/g, '/');
}

// --- 3. built pages -----------------------------------------------------

function checkDist() {
  if (!fs.existsSync(DIST)) {
    warnings.push('dist/ yok; üretilmiş sayfa kontrolü atlandı (grunt i18n çalıştırın)');
    return;
  }
  for (const lang of fs.readdirSync(DIST, { withFileTypes: true })) {
    if (!lang.isDirectory()) continue;
    for (const f of fs.readdirSync(path.join(DIST, lang.name))) {
      if (!f.endsWith('.htm')) continue;
      const text = fs.readFileSync(path.join(DIST, lang.name, f), 'utf8');
      if (text.includes('<%')) {
        fail(`dist/${lang.name}/${f}: derlenmemiş <%= %> işareti kaldı`);
      }
    }
  }
}

// --- text extraction (shared by parity + leftover checks) ---------------

const ATTR_RE = /(?:placeholder|title|aria-label|alt)\s*=\s*"([^"]*)"/g;

function maskScriptsAndStyles(src) {
  return src
    .replace(/<script\b[\s\S]*?<\/script>/gi, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/<style\b[\s\S]*?<\/style>/gi, (m) => m.replace(/[^\n]/g, ' '));
}

function visibleText(src) {
  const masked = maskScriptsAndStyles(src);
  const out = [];
  const re = />([^<>]+)</g;
  let m;
  while ((m = re.exec(masked)) !== null) {
    const t = normalize(m[1]);
    if (t) out.push(t);
  }
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(src)) !== null) {
    const t = normalize(m[1]);
    if (t) out.push(t);
  }
  return out;
}

function normalize(s) {
  const t = s.replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (!/[A-Za-z]/.test(t)) return '';
  if (/^(?:https?:\/\/|www\.)/i.test(t)) return '';
  return t;
}

// JS files: user-visible string literals only.
const JS_PATTERNS = [
  /(?:textContent|innerText|innerHTML|title|placeholder)\s*=\s*"((?:\\.|[^"\\]){2,240})"/g,
  /\balert\(\s*"((?:\\.|[^"\\]){2,240})"/g,
  /\bconfirm\(\s*"((?:\\.|[^"\\]){2,240})"/g,
];

function jsVisible(src) {
  const out = [];
  for (const re of JS_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
      // A literal may hold "\n\n" between a question and its explanation. Each
      // line is separate visible text (and comes from a separate locale key),
      // so emit them one by one; tags in an innerHTML assignment are not text.
      for (const part of m[1].split(/\\n/)) {
        const t = normalize(part.replace(/<[^<>]*>/g, ' '));
        if (t) out.push(t);
      }
    }
  }
  return out;
}

function visible(rel, src) {
  return rel.endsWith('.js') ? jsVisible(src) : visibleText(src);
}

// A page whose inline script does not parse is broken in every language, and
// the minifier can do that to a template (it rewrites object keys). Compiling
// every inline script here turns a silent blank page into a build error.
function checkInlineScripts() {
  if (!fs.existsSync(DIST)) return;
  for (const lang of fs.readdirSync(DIST, { withFileTypes: true })) {
    if (!lang.isDirectory()) continue;
    for (const f of fs.readdirSync(path.join(DIST, lang.name))) {
      if (!f.endsWith('.htm')) continue;
      const html = fs.readFileSync(path.join(DIST, lang.name, f), 'utf8');
      const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
      let m;
      let i = 0;
      while ((m = re.exec(html)) !== null) {
        const body = m[1];
        if (!body.trim()) continue;
        try {
          // eslint-disable-next-line no-new-func
          new Function(body);
        } catch (e) {
          fail(`dist/${lang.name}/${f}: ${i}. satır içi betik ayrıştırılamıyor (${e.message})`);
        }
        i++;
      }
    }
  }
}

// --- 4. parity against HEAD --------------------------------------------

function gitShow(rel) {
  try {
    return execFileSync('git', ['show', `HEAD:htmljs/src/${rel}`], {
      cwd: REPO,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (e) {
    return null;
  }
}

function multisetDiff(before, after) {
  const count = new Map();
  for (const s of before) count.set(s, (count.get(s) || 0) + 1);
  for (const s of after) count.set(s, (count.get(s) || 0) - 1);
  const lost = [];
  const added = [];
  for (const [s, n] of count) {
    if (n > 0) lost.push(s);
    else if (n < 0) added.push(s);
  }
  return { lost, added };
}

function checkParity() {
  const english = englishKeys();
  // The baseline is the last commit. An intentional wording change therefore
  // shows up as a difference; pass --skip-parity when the change is deliberate
  // and the diff has been read by hand.
  if (process.argv.includes('--skip-parity')) {
    warnings.push('parite kontrolü atlandı (--skip-parity): metin değişikliği elle doğrulanmalı');
    return;
  }
  for (const rel of SCOPE) {
    const abs = path.join(ROOT, 'src', rel);
    if (!fs.existsSync(abs)) continue;
    const oldSrc = gitShow(rel);
    if (oldSrc === null) continue;
    const newSrc = fs.readFileSync(abs, 'utf8');

    let beforeSrc;
    let afterSrc;
    try {
      beforeSrc = _.template(oldSrc, english);
    } catch (e) {
      fail(`${rel}: HEAD sürümü english.json ile render edilemedi (${e.message})`);
      continue;
    }
    try {
      afterSrc = _.template(newSrc, english);
    } catch (e) {
      fail(`${rel}: english.json ile render edilemedi (${e.message})`);
      continue;
    }

    // Both sides are rendered with the same english.json, so this compares the
    // page the user saw before the change with the page they see now.
    const before = visible(rel, beforeSrc);
    const after = visible(rel, afterSrc);
    const { lost, added } = multisetDiff(before, after);
    if (lost.length) {
      fail(`${rel}: HEAD'de olup yeni hâlde görünmeyen metin: ${JSON.stringify(lost.slice(0, 6))}`);
    }
    if (added.length) {
      fail(`${rel}: yeni hâlde beliren beklenmeyen metin: ${JSON.stringify(added.slice(0, 6))}`);
    }
  }
}

// Existing English values must not change: they are the reference the parity
// check above compares against, and a changed value would silently alter a page
// that was already translated.
function checkEnglishStability() {
  if (process.argv.includes('--skip-parity')) {
    warnings.push('İngilizce değer sabitliği atlandı (--skip-parity): değer değişikliği elle doğrulanmalı');
    return;
  }
  const headRaw = execFileSync('git', ['show', 'HEAD:htmljs/src/locales/english.json'], {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const head = JSON.parse(headRaw);
  const now = englishKeys();
  for (const [k, v] of Object.entries(head)) {
    if (!(k in now)) fail(`english.json: "${k}" silinmiş`);
    else if (now[k] !== v) fail(`english.json: "${k}" değeri değiştirilmiş`);
  }
}

// --- 5. leftover literals ----------------------------------------------

function loadKeep() {
  const file = path.join(__dirname, 'i18n-keep.txt');
  if (!fs.existsSync(file)) return new Set();
  return new Set(
    fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
  );
}

function checkLeftovers() {
  const keep = loadKeep();
  const english = englishKeys();
  const englishValues = new Set(Object.values(english).map((v) => normalize(v)));
  const report = (msg) => (process.env.I18N_ALLOW_LEFTOVERS ? warnings.push(msg) : fail(msg));

  for (const rel of SCOPE) {
    const abs = path.join(ROOT, 'src', rel);
    if (!fs.existsSync(abs)) continue;
    let rendered;
    try {
      rendered = _.template(fs.readFileSync(abs, 'utf8'), english);
    } catch (e) {
      continue; // reported by checkParity
    }
    for (const t of visible(rel, rendered)) {
      if (keep.has(t)) continue;
      if (englishValues.has(t)) continue;
      report(`${rel}: çevrilmemiş görünür metin: ${JSON.stringify(t)}`);
    }
  }
}

// --- main ---------------------------------------------------------------

checkLocales();
if (!errors.length) {
  checkEnglishStability();
  checkPlaceholders();
  checkDist();
  checkInlineScripts();
  checkParity();
  checkLeftovers();
}

for (const w of warnings) console.warn('uyarı: ' + w);
if (errors.length) {
  console.error(`\ni18n denetimi başarısız (${errors.length}):`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('i18n denetimi geçti.');
