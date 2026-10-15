// Copies the built web bundle (dist/web) into the Android app's assets.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const from = `${root}dist/web`;
const to = `${root}android/app/src/main/assets/www`;

if (!existsSync(`${from}/index.html`)) {
  console.error('dist/web is missing: run `pnpm build:web` first.');
  process.exit(1);
}
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log(`Copied ${from} -> ${to}`);
