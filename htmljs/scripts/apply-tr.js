'use strict';

/*
 * Applies the Turkish translation fragments in src/locales/_tr/ to
 * turkish.json. Only turkish.json is written; english.json and the other
 * locales are untouched.
 *
 *   node scripts/apply-tr.js [--write]
 *
 * The consistency pass at the end normalises terms that the packet translators
 * chose differently, so one word means one thing across the interface.
 */

const fs = require('fs');
const path = require('path');

const LOCALES = path.join(__dirname, '..', 'src', 'locales');
const TR_DIR = path.join(LOCALES, '_tr');
const write = process.argv.includes('--write');

const english = JSON.parse(fs.readFileSync(path.join(LOCALES, 'english.json'), 'utf8'));
const turkishPath = path.join(LOCALES, 'turkish.json');
const turkish = JSON.parse(fs.readFileSync(turkishPath, 'utf8'));

// Term normalisation. Longest first so "Denetleyici" wins over "Denetleyic".
const REPLACE = [
  ['Denetleyici', 'Kontrolcü'],
  ['denetleyici', 'kontrolcü'],
  ['Denetleyicinin', 'Kontrolcünün'],
  ['denetleyicinin', 'kontrolcünün'],
  ['Denetleyiciye', 'Kontrolcüye'],
  ['denetleyiciye', 'kontrolcüye'],
  ['Denetleyicide', 'Kontrolcüde'],
  ['denetleyicide', 'kontrolcüde'],
  ['Denetleyiciden', 'Kontrolcüden'],
  ['denetleyiciden', 'kontrolcüden'],
  ['Jeton', 'Token'],
  ['jeton', 'token'],
  ['Glycol', 'Glikol'],
  ['glycol', 'glikol'],
  ['Ortam Nem', 'Oda Nem'],
  ['Ortam nem', 'Oda nem'],
  ['Ortam Sıcaklığı', 'Oda Sıcaklığı'],
  ['Ortam sıcaklığı', 'Oda sıcaklığı'],
  ['Spunding', 'Kapatma'],
];

let applied = 0;
let changed = 0;
let unchanged = 0;

for (const file of fs.existsSync(TR_DIR) ? fs.readdirSync(TR_DIR).filter((f) => f.endsWith('.json')) : []) {
  const data = JSON.parse(fs.readFileSync(path.join(TR_DIR, file), 'utf8'));
  for (const [k, v] of Object.entries(data)) {
    if (!(k in english)) {
      console.log(`${file}: ${k} english.json'da yok, atlandı`);
      continue;
    }
    if (typeof v !== 'string' || !v.trim()) continue;
    if (v === english[k] && !/[çğıİöşü]/.test(v)) {
      // Pure token or deliberately untranslated short value.
    }
    turkish[k] = v;
    applied++;
  }
}

for (const k of Object.keys(turkish)) {
  const before = turkish[k];
  let after = before;
  for (const [from, to] of REPLACE) after = after.split(from).join(to);
  if (after !== before) {
    turkish[k] = after;
    changed++;
  }
}

// page_lang must stay "tr" no matter what a fragment says.
turkish.page_lang = 'tr';

// Every key must exist; anything the fragments did not cover keeps English so
// the page never shows a raw placeholder.
let missing = 0;
const ordered = {};
for (const k of Object.keys(english)) {
  if (typeof turkish[k] === 'string') ordered[k] = turkish[k];
  else {
    ordered[k] = english[k];
    missing++;
  }
}

const untranslated = Object.keys(ordered).filter(
  (k) => ordered[k] === english[k] && /[A-Za-z]{4}/.test(english[k])
);

console.log(`uygulanan: ${applied}, terim düzeltmesi: ${changed}, eksik (İngilizce kalan): ${missing}`);
console.log(`çevrilmemiş uzun değer: ${untranslated.length}`);
if (untranslated.length) console.log('  ' + untranslated.slice(0, 15).join(', '));

if (write) {
  fs.writeFileSync(turkishPath, JSON.stringify(ordered, null, 4) + '\n');
  console.log('turkish.json yazıldı (' + Object.keys(ordered).length + ' anahtar)');
}
