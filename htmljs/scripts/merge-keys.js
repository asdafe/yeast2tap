'use strict';
// Merge the per-packet fragments under src/locales/_keys/ into english.json.
// Keys are appended before "__end__"; existing values are never touched.
const fs = require('fs');
const path = require('path');

const LOCALES = path.join(__dirname, '..', 'src', 'locales');
const KEYS = path.join(LOCALES, '_keys');

const englishPath = path.join(LOCALES, 'english.json');
const english = JSON.parse(fs.readFileSync(englishPath, 'utf8'));

// JSON.parse silently keeps the last duplicate, so look for them in the text.
function findDuplicateKeys(text) {
  const seen = new Map();
  const dups = [];
  const re = /"([^"\\]+)"\s*:/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const k = m[1];
    const lower = k.toLowerCase();
    if (seen.has(lower) && seen.get(lower) !== k) dups.push(`büyük/küçük harf çakışması: ${seen.get(lower)} / ${k}`);
    else if (seen.has(lower)) dups.push(`tekrarlanan anahtar: ${k}`);
    else seen.set(lower, k);
  }
  return dups;
}

const files = fs.existsSync(KEYS)
  ? fs.readdirSync(KEYS).filter((f) => f.endsWith('.json')).sort()
  : [];
if (!files.length) {
  console.log('src/locales/_keys/ boş veya yok: birleştirilecek anahtar yok.');
  process.exit(0);
}
let problems = 0;
const merged = {};

for (const file of files) {
  const text = fs.readFileSync(path.join(KEYS, file), 'utf8');
  const dups = findDuplicateKeys(text);
  if (dups.length) {
    console.log(`${file}:`);
    for (const d of dups) console.log('  ' + d);
    problems += dups.length;
  }
  const data = JSON.parse(text);
  for (const [k, v] of Object.entries(data)) {
    if (typeof v !== 'string') {
      console.log(`${file}: ${k} string değil`);
      problems++;
      continue;
    }
    if (k in english) {
      if (english[k] !== v) {
        console.log(`${file}: ${k} english.json'da farklı değerle var: ${JSON.stringify(english[k])} != ${JSON.stringify(v)}`);
        problems++;
      }
      continue;
    }
    if (k in merged) {
      if (merged[k] !== v) {
        console.log(`${file}: ${k} başka pakette farklı değerle tanımlı`);
        problems++;
      }
      continue;
    }
    merged[k] = v;
  }
}

console.log(`\n${Object.keys(merged).length} yeni anahtar, ${problems} sorun`);

if (process.argv.includes('--write')) {
  const out = {};
  for (const [k, v] of Object.entries(english)) {
    if (k === '__end__') {
      for (const [nk, nv] of Object.entries(merged)) out[nk] = nv;
    }
    out[k] = v;
  }
  fs.writeFileSync(englishPath, JSON.stringify(out, null, 4) + '\n');
  console.log('english.json yazıldı');
}
if (problems) process.exit(1);
