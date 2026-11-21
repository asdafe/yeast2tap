'use strict';

/*
 * The firmware serves the `_s` dashboard and control pages: they reference the
 * shared /dygraph.min.js asset instead of the copy inlined from
 * js/dygraph-2.2.1/. The two files are otherwise identical, so the `_s` files are
 * generated here instead of being maintained by hand.
 *
 * Run it before `grunt i18n`; `npm run embed` does that for you.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

const SRC_TAG = '<script type="text/javascript" src="js/dygraph-2.2.1/dygraph.min.js"></script>';
const SHARED_TAG = '<script type="text/javascript" src="/dygraph.min.js" ignore></script>';

const PAIRS = [
  ['index.tmpl.html', 'index_s.tmpl.html'],
  ['control.tmpl.html', 'control_s.tmpl.html'],
];

for (const [from, to] of PAIRS) {
  const srcPath = path.join(SRC, from);
  const destPath = path.join(SRC, to);
  const src = fs.readFileSync(srcPath, 'utf8');

  if (src.indexOf(SRC_TAG) === -1) {
    throw new Error(`${from}: dygraph script satırı bulunamadı, sync-variants güncellenmeli`);
  }
  const out = src.split(SRC_TAG).join(SHARED_TAG);
  if (out.indexOf('/dygraph.min.js') === -1) {
    throw new Error(`${to}: paylaşılan dygraph yolu yazılamadı`);
  }

  const previous = fs.existsSync(destPath) ? fs.readFileSync(destPath, 'utf8') : null;
  if (previous === out) {
    console.log(`${to}: değişmedi`);
    continue;
  }
  fs.writeFileSync(destPath, out);
  console.log(`${to}: ${from} dosyasından üretildi`);
}
