import { defineConfig } from 'vite';

// Relative base: the same bundle loads from file:// (Electron) and the
// Android asset loader (https://appassets.androidplatform.net/assets/www/).
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist/web',
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 0,
  },
});
