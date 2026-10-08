// Copies the pdf.js runtime assets (CMaps, standard fonts, wasm decoders, ICC
// profiles) into public/pdfjs so the app is fully self-contained and works
// offline with no CDN calls. Runs automatically before `dev` and `build`.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, 'node_modules', 'pdfjs-dist');
const dest = join(root, 'public', 'pdfjs');

if (!existsSync(src)) {
  console.error('pdfjs-dist is not installed. Run `npm install` first.');
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  const from = join(src, dir);
  if (existsSync(from)) cpSync(from, join(dest, dir), { recursive: true });
}
console.log('pdf.js assets copied to public/pdfjs');
