// Builds dist/testtrail-<version>.zip containing only the files Chrome needs
// (for the Chrome Web Store or sharing). No build step is required to load the
// extension unpacked — this is only for distribution. Run: npm run package
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zip } from '../src/dashboard/zip.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INCLUDE = ['manifest.json', 'src', 'icons'];

function walk(rel) {
  const abs = path.join(ROOT, rel);
  if (fs.statSync(abs).isDirectory()) return fs.readdirSync(abs).flatMap((f) => walk(path.join(rel, f)));
  return [rel];
}

const files = INCLUDE.flatMap(walk)
  .filter((f) => !f.endsWith('icon-256.png'))
  .map((f) => ({ name: f.split(path.sep).join('/'), data: new Uint8Array(fs.readFileSync(path.join(ROOT, f))) }));
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const out = path.join(ROOT, 'dist', `testtrail-${version}.zip`);
fs.writeFileSync(out, zip(files));
console.log(`Wrote ${path.relative(ROOT, out)} (${files.length} files)`);
