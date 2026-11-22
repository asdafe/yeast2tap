import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PIO = process.env.PIO || 'pio';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ENV = 'esp32';

function main() {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(PIO)) {
      console.error(`PlatformIO not found: ${PIO}`);
      process.exit(1);
    }

    let stdout = '';
    let stderr = '';

    const child = spawn(PIO, ['run', '-e', ENV], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });

    child.stdout.on('data', (d) => { stdout += d.toString(); process.stdout.write(d); });
    child.stderr.on('data', (d) => { stderr += d.toString(); process.stderr.write(d); });

    child.on('close', (code) => {
      const flashMatch = stdout.match(/(\d+)\s*bytes.*flash|flash[^\n]{0,80}?(\d+)\s*bytes/i);
      const ramMatch = stdout.match(/(\d+)\s*bytes.*RAM|RAM[^\n]{0,80}?(\d+)\s*bytes/i);

      console.log(`\n=== PlatformIO ${ENV} build ===`);
      console.log(`Exit code: ${code}`);
      if (flashMatch) console.log(`Flash hint: ${flashMatch[0].trim()}`);
      if (ramMatch) console.log(`RAM hint: ${ramMatch[0].trim()}`);

      if (code !== 0) {
        console.error('Build did not succeed. Reported as evidence; not fixed here.');
        process.exit(code);
      }
      resolve();
    });

    child.on('error', (err) => {
      console.error('Failed to spawn PlatformIO:', err.message);
      process.exit(1);
    });
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
