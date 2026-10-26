import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// Relative base: the same bundle loads from file:// (Electron) and the
// Android asset loader (https://appassets.androidplatform.net/assets/www/).
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: {
    outDir: 'dist/web',
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 0,
  },
});
