// Copies the Tauri bundles into release/ under the names the README and the
// release page use: DocScan-<v>-amd64.deb, DocScan-<v>-setup-x64.exe and
// DocScan-<v>-portable-x64.exe (the bare app exe; it needs the WebView2
// runtime that Windows 10 and 11 already have).
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const target = join(root, 'src-tauri', 'target', 'release');
const out = join(root, 'release');
mkdirSync(out, { recursive: true });

function find(dir, pattern) {
  if (!existsSync(dir)) return null;
  const file = readdirSync(dir).find((f) => pattern.test(f) && f.includes(version));
  if (!file) throw new Error(`No ${pattern} for ${version} in ${dir}`);
  return join(dir, file);
}

function collect(dir, pattern, name) {
  const file = find(dir, pattern);
  if (!file) return;
  copyFileSync(file, join(out, name));
  console.log(`release/${name}`);
}

// Tauri names the Debian package "doc-scan"; releases up to 0.1.2 installed
// "docscan", so the control file is rewritten to keep apt upgrades working.
const deb = find(join(target, 'bundle', 'deb'), /_amd64\.deb$/);
if (deb) {
  const work = mkdtempSync(join(tmpdir(), 'docscan-deb-'));
  try {
    execFileSync('dpkg-deb', ['-R', deb, work]);
    const controlPath = join(work, 'DEBIAN', 'control');
    const control = readFileSync(controlPath, 'utf8')
      .replace(/^Package: .*$/m, 'Package: docscan')
      .replace(/^Maintainer: .*$/m, 'Maintainer: Hafij-BGE <mdhafijur.rahman@ogr.deu.edu.tr>')
      .replace(/^Priority: /m, 'Section: graphics\nPriority: ');
    writeFileSync(controlPath, control);
    const name = `DocScan-${version}-amd64.deb`;
    execFileSync('dpkg-deb', ['--root-owner-group', '-Zxz', '--build', work, join(out, name)], { stdio: 'ignore' });
    console.log(`release/${name}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
collect(join(target, 'bundle', 'nsis'), /_x64-setup\.exe$/, `DocScan-${version}-setup-x64.exe`);
if (existsSync(join(target, 'bundle', 'nsis'))) {
  copyFileSync(join(target, 'docscan.exe'), join(out, `DocScan-${version}-portable-x64.exe`));
  console.log(`release/DocScan-${version}-portable-x64.exe`);
}
