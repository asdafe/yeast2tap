'use strict';
// Creates/refreshes a locale file from english.json, keeping the same key order.
// Usage: node scripts/make-locale.js turkish tr
const fs = require('fs');
const path = require('path');

const [name, lang] = process.argv.slice(2);
if (!name || !lang) {
  console.error('usage: node scripts/make-locale.js <name> <html-lang>');
  process.exit(1);
}

const DIR = path.join(__dirname, '..', 'src', 'locales');
const english = JSON.parse(fs.readFileSync(path.join(DIR, 'english.json'), 'utf8'));
const out = {};
for (const [k, v] of Object.entries(english)) out[k] = v;
out.page_lang = lang;

fs.writeFileSync(path.join(DIR, name + '.json'), JSON.stringify(out, null, 4) + '\n');
console.log(`${name}.json yazıldı (${Object.keys(out).length} anahtar, page_lang=${lang})`);
