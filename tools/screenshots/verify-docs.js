const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SHOTS = path.join(ROOT, 'docs', 'assets', 'screenshots');
const DOCS = path.join(ROOT, 'documentation');

function walk(d, o = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, o);
    else if (e.name.endsWith('.md')) o.push(p);
  }
  return o;
}

const used = new Set();
for (const f of walk(DOCS)) {
  const t = fs.readFileSync(f, 'utf8');
  for (const m of t.matchAll(/`"(YT-\d{3}-[a-z0-9-]+\.png)"`/g)) used.add(m[1]);
}

const onDisk = fs.readdirSync(SHOTS).filter((f) => f.endsWith('.png'));
const orphans = onDisk.filter((f) => !used.has(f));
console.log('on disk:', onDisk.length, '| referenced:', used.size);
console.log('orphaned images (on disk, never referenced):', orphans.length);
orphans.forEach((o) => console.log('  ' + o));

// internal markdown links still resolve?
const missing = [];
const badAnchor = [];
for (const f of walk(DOCS)) {
  const dir = path.dirname(f);
  const t = fs.readFileSync(f, 'utf8');
  for (const m of t.matchAll(/\[([^\]]*)\]\(([^)]+)\)/g)) {
    const target = m[2];
    if (/^https?:/.test(target)) continue;
    const [file, anchor] = target.split('#');
    if (!file) continue;
    const resolved = path.normalize(path.join(dir, file));
    if (!fs.existsSync(resolved)) { missing.push(`${path.basename(f)} -> ${target}`); continue; }
    if (anchor && resolved.endsWith('.md')) {
      const slug = (s) => s.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
      const heads = [...fs.readFileSync(resolved, 'utf8').matchAll(/^#{1,6}\s+(.*)$/gm)].map((x) => slug(x[1]));
      if (!heads.includes(anchor)) badAnchor.push(`${path.basename(f)} -> ${target}`);
    }
  }
}
console.log('missing internal links:', missing.length);
missing.forEach((m) => console.log('  ' + m));
console.log('bad anchors:', badAnchor.length);
badAnchor.forEach((m) => console.log('  ' + m));

// English-only check: any Turkish left?
let tr = 0;
for (const f of walk(DOCS)) {
  const t = fs.readFileSync(f, 'utf8');
  if (/[çğıöşüÇĞİÖŞÜ]/.test(t)) { tr++; console.log('NON-ASCII-TR?', path.basename(f)); }
}
console.log('files containing Turkish characters:', tr);
