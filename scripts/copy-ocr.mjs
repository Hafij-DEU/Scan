// Copies the OCR engine (tesseract.js worker + non-SIMD LSTM core) and the
// English model into public/ocr, where Vite serves and bundles them as-is.
// The core's .wasm sits next to worker.min.js because Emscripten resolves it
// relative to the worker script.
import { copyFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(join(root, 'package.json'));
const tesseract = dirname(require.resolve('tesseract.js/package.json'));
// tesseract.js-core is a dependency of tesseract.js, not of this package.
const core = dirname(createRequire(realpathSync(join(tesseract, 'package.json'))).resolve('tesseract.js-core/package.json'));
const eng = dirname(require.resolve('@tesseract.js-data/eng/package.json'));
const out = join(root, 'public', 'ocr');

const files = [
  [join(tesseract, 'dist', 'worker.min.js'), 'worker.min.js'],
  [join(core, 'tesseract-core-lstm.js'), 'tesseract-core-lstm.js'],
  [join(core, 'tesseract-core-lstm.wasm'), 'tesseract-core-lstm.wasm'],
  [join(eng, '4.0.0_best_int', 'eng.traineddata.gz'), 'eng.traineddata.gz'],
];
mkdirSync(out, { recursive: true });
for (const [from, name] of files) {
  if (!existsSync(from)) {
    console.error(`Missing ${from}: run pnpm install.`);
    process.exit(1);
  }
  copyFileSync(from, join(out, name));
}
console.log(`OCR files copied to ${out}`);
