import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEmbeddedAssets, parseHeader } from './embedded-assets.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

test('loads the real shared.js gzip bytes and declared length', () => {
  const assets = loadEmbeddedAssets(repoRoot);
  const shared = assets.get('/shared.js');
  assert.ok(shared, '/shared.js asset missing');
  assert.equal(shared.mime, 'application/javascript');
  assert.equal(shared.bytes.length, shared.declaredLength);
  assert.equal(shared.bytes.subarray(0, 2).toString('hex'), '1f8b');
});

test('loads every embedded page route', () => {
  const assets = loadEmbeddedAssets(repoRoot);
  for (const route of [
    '/',
    '/index.htm',
    '/control.htm',
    '/setup.htm',
    '/logging.htm',
    '/gravity.htm',
    '/config.htm',
    '/pressure.htm',
    '/scale.htm',
    '/shared.js',
    '/bwf.js',
    '/dygraph.min.js',
  ]) {
    const asset = assets.get(route);
    assert.ok(asset, `${route} missing`);
    assert.equal(asset.bytes.length, asset.declaredLength, `${route} length mismatch`);
  }
});

test('rejects a header whose declared length does not match the bytes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'y2t-asset-'));
  const file = path.join(dir, 'broken.h');
  fs.writeFileSync(
    file,
    'const unsigned char broken_gz[] PROGMEM = {\n  0x1f, 0x8b, 0x08,\n};\nunsigned int broken_gz_len = 9;\n',
  );
  assert.throws(() => parseHeader(file), /malformed/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('rejects a missing header file', () => {
  assert.throws(() => parseHeader(path.join(os.tmpdir(), 'y2t-does-not-exist.h')), /cannot read/i);
});
