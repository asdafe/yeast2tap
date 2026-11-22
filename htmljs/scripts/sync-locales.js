'use strict';

/*
 * Adds every key that english.json has but a locale is missing, using the English
 * value. Keeps english.json's key order in every file. Existing translations are
 * never touched. Run it after adding keys, before `grunt i18n`.
 */

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'src', 'locales');
const english = JSON.parse(fs.readFileSync(path.join(DIR, 'english.json'), 'utf8'));
const order = Object.keys(english);

let changed = 0;
for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.json') && f !== 'english.json')) {
  const abs = path.join(DIR, file);
  const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const out = {};
  let added = 0;
  for (const key of order) {
    if (typeof data[key] === 'string') out[key] = data[key];
    else {
      out[key] = english[key];
      added++;
    }
  }
  const dropped = Object.keys(data).filter((k) => !(k in english));
  if (dropped.length) {
    console.warn(`${file}: english.json'da olmayan ${dropped.length} anahtar atıldı: ${dropped.join(', ')}`);
  }
  fs.writeFileSync(abs, JSON.stringify(out, null, 4) + '\n');
  if (added || dropped.length) {
    console.log(`${file}: +${added} anahtar`);
    changed++;
  }
}
console.log(changed ? `${changed} dosya güncellendi` : 'tüm diller güncel');
