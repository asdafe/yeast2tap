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

const NS = '"http://www.w3.org/2000/svg"';
const SHAPE = '"M25 15h50l8 15v85l-8 20H25l-8-20V30z"';
const replacements = [
  [
    'n.classList.add("corny-keg");var a=document.createElementNS(' + NS + ',"rect");a.setAttribute("x","15"),a.setAttribute("y",String(135-1.2*i)),a.setAttribute("width","70"),a.setAttribute("height",String(1.2*i)),a.setAttribute("class","keg-liquid"),a.setAttribute("clip-path","url(#keg-clip-"+t.id+")");var r=document.createElementNS(' + NS + ',"path");r.setAttribute("d",' + SHAPE + '),r.setAttribute("class","keg-outline");var o=document.createElementNS(' + NS + ',"rect");o.setAttribute("x","39"),o.setAttribute("y","5"),o.setAttribute("width","22"),o.setAttribute("height","12"),o.setAttribute("rx","3"),o.setAttribute("class","keg-neck"),n.appendChild(function(){var e=document.createElementNS(' + NS + ',"clipPath"),p=document.createElementNS(' + NS + ',"path");return e.setAttribute("id","keg-clip-"+t.id),p.setAttribute("d",' + SHAPE + '),e.appendChild(p),e}()),n.appendChild(a),n.appendChild(r),n.appendChild(o);',
    'n.classList.add("corny-keg");var a=document.createElementNS(' + NS + ',"path");a.setAttribute("d",' + SHAPE + '),a.setAttribute("class","keg-liquid"),a.setAttribute("clip-path","url(#keg-clip-"+t.id+")");var r=document.createElementNS(' + NS + ',"path");r.setAttribute("d",' + SHAPE + '),r.setAttribute("class","keg-outline"),r.setAttribute("fill","none");var o=document.createElementNS(' + NS + ',"rect");o.setAttribute("x","39"),o.setAttribute("y","5"),o.setAttribute("width","22"),o.setAttribute("height","12"),o.setAttribute("rx","3"),o.setAttribute("class","keg-neck"),n.appendChild(function(){var e=document.createElementNS(' + NS + ',"defs"),c=document.createElementNS(' + NS + ',"clipPath"),p=document.createElementNS(' + NS + ',"rect");return c.setAttribute("id","keg-clip-"+t.id),p.setAttribute("x","15"),p.setAttribute("y",String(135-1.2*i)),p.setAttribute("width","70"),p.setAttribute("height",String(1.2*i)),c.appendChild(p),e.appendChild(c),e}()),n.appendChild(a),n.appendChild(r),n.appendChild(o);',
  ],
  ['.keg-outline{fill:rgba(255,255,255,.35);', '.keg-outline{fill:none;'],
];

function patch(html, name) {
  if (html.includes('r.setAttribute("fill","none")')) return null;
  for (const [o, n] of replacements) {
    if (count(html, o) !== 1) throw new Error(name + ' anchor ' + count(html, o) + ': ' + o.slice(0, 70));
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

const headerFile = path.join(root, '..', 'wdoc', 'english_index_htm.h');
const header = fs.readFileSync(headerFile, 'utf8');
const bytes = Buffer.from(header.match(/\{([\s\S]*?)\};/)[1].split(',').map((s) => s.trim()).filter(Boolean).map((s) => parseInt(s, 16)));
const embedded = patch(zlib.gunzipSync(bytes).toString('utf8'), 'english_index_htm.h');
if (embedded !== null) fs.writeFileSync(headerFile, formatHeader('data_index_htm_gz', zlib.gzipSync(Buffer.from(embedded, 'utf8'), { level: 9 })));
console.log('patched keg fill flush');
