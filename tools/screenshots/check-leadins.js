const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DOCS = path.join(ROOT, 'documentation');

function walk(d, o = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, o);
    else if (e.name.endsWith('.md')) o.push(p);
  }
  return o;
}

// A paragraph that ends in ":" must be followed by a list, table, code block or figure.
let n = 0;
for (const f of walk(DOCS)) {
  const L = fs.readFileSync(f, 'utf8').split('\n');
  for (let i = 0; i < L.length; i++) {
    const s = L[i].trim();
    if (!s.endsWith(':') || s.startsWith('|') || s.startsWith('#') || s.length < 12) continue;
    let j = i + 1;
    while (j < L.length && L[j].trim() === '') j++;
    const nx = (L[j] || '').trim();
    const ok =
      nx.startsWith('|') ||
      /^[-*]\s/.test(nx) ||
      /^\d+\.\s/.test(nx) ||
      nx.startsWith('**Figure:**') ||
      nx.startsWith('```');
    if (!ok) {
      n++;
      console.log(`${path.basename(f)}:${i + 1} :: ${s.slice(0, 70)}`);
    }
  }
}
console.log('dangling lead-ins:', n);
