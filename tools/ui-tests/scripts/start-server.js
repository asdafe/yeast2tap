import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { startServer } from '../server/server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const port = Number(process.env.UI_TEST_PORT || 4173);

const { url, close } = await startServer({ repoRoot, port });

console.log(`yeast2tap UI test server listening on ${url}`);

async function shutdown() {
  await close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
