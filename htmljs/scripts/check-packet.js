'use strict';

/*
 * Per-packet gate for the translation work. Each packet owns one fragment file
 * under src/locales/_keys/ and a short list of source files.
 *
 *   node scripts/check-packet.js src/locales/_keys/t1.json control.tmpl.html ...
 *
 * It renders the HEAD version of each file and the current version with
 * (english.json + the fragment) and compares every visible string, so a keyed
 * string that lost its text or was typo'd fails immediately. It also lists any
 * visible literal that is still not covered by a key.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const REPO = path.join(ROOT, '..');
const _ = require(path.join(
  ROOT,
  'node_modules',
  'grunt-multi-lang-site-generator',
  'node_modules',
  'lodash'
));

const [fragmentRel, ...files] = process.argv.slice(2);
if (!fragmentRel || !files.length) {
  console.error('usage: node scripts/check-packet.js <fragment.json> <file>...');
  process.exit(2);
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const english = readJson(path.join(ROOT, 'src', 'locales', 'english.json'));
const fragmentPath = path.resolve(ROOT, fragmentRel);
const fragment = fs.existsSync(fragmentPath) ? readJson(fragmentPath) : {};

const errors = [];
const warnings = [];

// Cross-packet collision check: two packets must not define the same key.
const keysDir = path.join(ROOT, 'src', 'locales', '_keys');
if (fs.existsSync(keysDir)) {
  const seen = new Map();
  for (const f of fs.readdirSync(keysDir).filter((x) => x.endsWith('.json'))) {
    const full = path.join(keysDir, f);
    const data = readJson(full);
    for (const [k, v] of Object.entries(data)) {
      if (seen.has(k) && seen.get(k).value !== v) {
        errors.push(`anahtar çakışması: "${k}" hem ${seen.get(k).file} hem ${f} içinde farklı değerle tanımlı`);
      } else if (!seen.has(k)) seen.set(k, { file: f, value: v });
    }
  }
}

const data = Object.assign({}, english, fragment);

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

function mask(s) {
  return s
    .replace(/<script\b[\s\S]*?<\/script>/gi, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/<style\b[\s\S]*?<\/style>/gi, (m) => m.replace(/[^\n]/g, ' '));
}

const ATTR_RE = /(?:placeholder|title|aria-label|alt)\s*=\s*"([^"]*)"/g;

function normalize(s) {
  const t = s.replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (!/[A-Za-z]/.test(t)) return '';
  if (/^(?:https?:\/\/|www\.)/i.test(t)) return '';
  return t;
}

function visibleText(src) {
  const out = [];
  const re = />([^<>]+)</g;
  const masked = mask(src);
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

const JS_PATTERNS = [
  /(?:textContent|innerText|innerHTML|title|placeholder)\s*=\s*"((?:\\.|[^"\\]){2,400})"/g,
  /\balert\(\s*"((?:\\.|[^"\\]){2,400})"/g,
  /\bconfirm\(\s*"((?:\\.|[^"\\]){2,400})"/g,
];

function jsVisible(src) {
  const out = [];
  for (const re of JS_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
      // innerHTML assignments carry markup; tags are not visible text.
      const t = normalize(m[1].replace(/\\n/g, ' ').replace(/<[^<>]*>/g, ' '));
      if (t) out.push(t);
    }
  }
  return out;
}

function visible(rel, src) {
  return rel.endsWith('.js') ? jsVisible(src) : visibleText(src);
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

const coveredValues = new Set([
  ...Object.values(english).map((v) => normalize(v)),
  ...Object.values(fragment).map((v) => normalize(v)),
]);

for (const rel of files) {
  const abs = path.join(ROOT, 'src', rel);
  if (!fs.existsSync(abs)) {
    errors.push(`${rel}: dosya yok`);
    continue;
  }
  const oldSrc = gitShow(rel);
  const newSrc = fs.readFileSync(abs, 'utf8');

  let beforeSrc = null;
  if (oldSrc !== null) {
    try {
      beforeSrc = _.template(oldSrc, data);
    } catch (e) {
      errors.push(`${rel}: HEAD sürümü render edilemedi (${e.message})`);
    }
  }
  let afterSrc;
  try {
    afterSrc = _.template(newSrc, data);
  } catch (e) {
    errors.push(
      `${rel}: render edilemedi (${e.message}) — muhtemelen anahtar fragment dosyasında yok`
    );
    continue;
  }

  if (beforeSrc !== null) {
    const { lost, added } = multisetDiff(visible(rel, beforeSrc), visible(rel, afterSrc));
    if (lost.length) errors.push(`${rel}: kaybolan metin: ${JSON.stringify(lost.slice(0, 8))}`);
    if (added.length) errors.push(`${rel}: beklenmeyen yeni metin: ${JSON.stringify(added.slice(0, 8))}`);
  }

  for (const t of visible(rel, afterSrc)) {
    if (coveredValues.has(t)) continue;
    warnings.push(`${rel}: anahtarlanmamış görünür metin: ${JSON.stringify(t)}`);
  }
}

for (const w of warnings) console.warn('  ! ' + w);
if (errors.length) {
  console.error(`\n${files.join(', ')}: ${errors.length} hata`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`${files.join(', ')}: parite tamam${warnings.length ? `, ${warnings.length} metin anahtarsız` : ''}`);
