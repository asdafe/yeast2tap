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

const SVG = '"http://www.w3.org/2000/svg"';
const SHAPE = '"M25 15h50l8 15v85l-8 20H25l-8-20V30z"';
const replacements = [
  [
    'a.setAttribute("y",String(125-.9*i)),a.setAttribute("width","70"),a.setAttribute("height",String(.9*i)),a.setAttribute("class","keg-liquid");',
    'a.setAttribute("y",String(135-1.2*i)),a.setAttribute("width","70"),a.setAttribute("height",String(1.2*i)),a.setAttribute("class","keg-liquid"),a.setAttribute("clip-path","url(#keg-clip-"+t.id+")");',
  ],
  [
    'n.appendChild(a),n.appendChild(r),n.appendChild(o);',
    'n.appendChild(function(){var e=document.createElementNS(' + SVG + ',"clipPath"),p=document.createElementNS(' + SVG + ',"path");' +
      'return e.setAttribute("id","keg-clip-"+t.id),p.setAttribute("d",' + SHAPE + '),e.appendChild(p),e}()),n.appendChild(a),n.appendChild(r),n.appendChild(o);',
  ],
];

function patch(html, name) {
  if (html.includes('keg-clip-')) return null;
  for (const [o, n] of replacements) {
    if (count(html, o) !== 1) throw new Error(name + ' anchor ' + count(html, o) + ': ' + o.slice(0, 60));
    html = html.replace(o, () => n);
  }
  return html;
}

const root = __dirname;
for (const f of ['dist/english/index.htm', 'dist/english/index_s.htm', 'dist/index.tmpl.htm', 'dist/index_s.tmpl.htm']) {
  const file = path.join(root, f);
  const html = patch(fs.readFileSync(file, 'utf8'), f);
  if (html !== null) fs.writeFileSync(file, html);
}
for (const page of ['index', 'index_s']) {
  const gz = zlib.gzipSync(fs.readFileSync(path.join(root, 'dist', 'english', page + '.htm')));
  fs.writeFileSync(path.join(root, 'dist', 'english', page + '.htm.gz'), gz);
}

// The embedded page carries direct patches that dist does not have, so patch it in place.
const headerFile = path.join(root, '..', 'wdoc', 'english_index_htm.h');
const header = fs.readFileSync(headerFile, 'utf8');
const bytes = Buffer.from(header.match(/\{([\s\S]*?)\};/)[1].split(',').map((s) => s.trim()).filter(Boolean).map((s) => parseInt(s, 16)));
const embedded = patch(zlib.gunzipSync(bytes).toString('utf8'), 'english_index_htm.h');
if (embedded !== null) fs.writeFileSync(headerFile, formatHeader('data_index_htm_gz', zlib.gzipSync(Buffer.from(embedded, 'utf8'), { level: 9 })));
console.log('patched main page keg fill');
