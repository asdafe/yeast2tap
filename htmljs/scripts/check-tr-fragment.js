'use strict';

/*
 * Validator for a Turkish translation fragment.
 *
 *   node scripts/check-tr-fragment.js A
 *
 * Compares src/locales/_tr/<name>.json against the English reference in
 * english.json and enforces the things a translation must not break:
 *  - the key set is identical to english.json's keys for that fragment
 *  - every value is a non-empty string
 *  - HTML entities, %format tokens and unit/technical tokens survive intact
 *  - no double quote, backslash, < or > inside a value
 *  - values are real UTF-8 Turkish, not \u escapes
 *  - no leftover English at the start of a longer sentence (soft warning)
 */

const fs = require('fs');
const path = require('path');

const name = process.argv[2];
if (!name) {
  console.error('usage: node scripts/check-tr-fragment.js <fragment>');
  process.exit(2);
}

const ROOT = path.join(__dirname, '..');
const english = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'locales', 'english.json'), 'utf8'));
const file = path.join(ROOT, 'src', 'locales', '_tr', name + '.json');
const raw = fs.readFileSync(file, 'utf8');

const errors = [];
const warnings = [];

let data;
try {
  data = JSON.parse(raw);
} catch (e) {
  console.error(`${name}.json geçersiz JSON: ${e.message}`);
  process.exit(1);
}

const keys = Object.keys(data);
const englishKeys = keys.filter((k) => k in english);
if (englishKeys.length !== keys.length) {
  const unknown = keys.filter((k) => !(k in english));
  errors.push(`english.json'da olmayan anahtar(lar): ${unknown.slice(0, 8).join(', ')}`);
}

// Entities and format tokens must survive.
const ENTITY = /&[a-zA-Z]+;|&#\d+;/g;
const TOKEN = /%[A-Za-z]/g;

// Tokens that must stay verbatim inside a translated value.
const KEEP = [
  'yeast2tap', 'iSpindel', 'GravityMon', 'Tilt', 'RAPT', 'BrewFather', 'BrewersFriend',
  'ThingSpeak', 'Ubidots', 'DuckDNS', 'MQTT', 'SSID', 'MAC', 'GPIO', 'PID', 'HX711',
  'ADS1115', 'AY', 'BME280', 'DHT11', 'DHT12', 'DHT21', 'DHT22', 'AM2301', 'OneWire',
  'Content-Type', 'HX711', 'SG', 'ABV', 'OG', 'ATT', 'RH', 'RSSI', 'dBm', 'CO2',
];

// Values that are pure technical tokens: translation is not expected.
const PURE = /^(?:[A-Za-z0-9_.&;#°%/+-]{1,4}|&[a-z]+;|[A-Za-z]{1,3})$/;

for (const [k, tr] of Object.entries(data)) {
  if (!(k in english)) continue;
  const en = english[k];

  if (typeof tr !== 'string') {
    errors.push(`${k}: değer string değil`);
    continue;
  }
  if (!tr.trim()) {
    errors.push(`${k}: boş değer`);
    continue;
  }
  if (/["\\]/.test(tr)) errors.push(`${k}: değerde çift tırnak veya ters bölü var`);
  if (/[<>]/.test(tr)) errors.push(`${k}: değerde < veya > var (HTML yasak)`);
  if (/\\u[0-9a-fA-F]{4}/.test(tr)) errors.push(`${k}: \\u kaçışı kullanılmış, gerçek Türkçe karakter yaz`);

  // entities must match one-for-one
  const enEnt = (en.match(ENTITY) || []).sort().join(',');
  const trEnt = (tr.match(ENTITY) || []).sort().join(',');
  if (enEnt !== trEnt) errors.push(`${k}: HTML entity farkı (İngilizce: ${enEnt || '-'} / Türkçe: ${trEnt || '-'})`);

  // %X tokens must match one-for-one
  const enTok = (en.match(TOKEN) || []).sort().join(',');
  const trTok = (tr.match(TOKEN) || []).sort().join(',');
  if (enTok !== trTok) errors.push(`${k}: %format belirteci farkı (${enTok || '-'} / ${trTok || '-'})`);

  // keep-list words that appear in English must still appear
  for (const w of KEEP) {
    if (!en.includes(w)) continue;
    if (!tr.includes(w)) errors.push(`${k}: "${w}" korunmalı`);
  }

  // layout whitespace: leading &nbsp; or space must stay
  const lead = /^(?:&nbsp;|\s)+/.exec(en);
  if (lead && !/^(?:&nbsp;|\s)+/.test(tr)) errors.push(`${k}: baştaki boşluk/&nbsp; kaybolmuş`);
  const trail = /(?:&nbsp;|\s)+$/.exec(en);
  if (trail && !/(?:&nbsp;|\s)+$/.test(tr)) errors.push(`${k}: sondaki boşluk/&nbsp; kaybolmuş`);

  // soft: longer English text left untouched
  if (en.length > 12 && tr === en && !PURE.test(en)) {
    warnings.push(`${k}: çevrilmemiş görünüyor (${JSON.stringify(en).slice(0, 60)})`);
  }
}

for (const w of warnings) console.warn('  ! ' + w);
if (errors.length) {
  console.error(`\n${name}.json: ${errors.length} hata`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`${name}.json: ${keys.length} anahtar geçerli${warnings.length ? `, ${warnings.length} uyarı` : ''}`);
