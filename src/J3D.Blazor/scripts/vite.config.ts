import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Output goes straight into the library's wwwroot so it is served as a static web asset.
const outDir = fileURLToPath(new URL('../wwwroot/viewer', import.meta.url));

export default defineConfig({
  // Relative asset URLs (resolved against import.meta.url), since the bundle is served from _content/J3D.Blazor/viewer/.
  base: './',
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    // The mesh chunk is three's loaders, fetched only on the first mesh import.
    chunkSizeWarningLimit: 1000,
    // An app build rather than library mode: library mode inlines every asset, including the 15 MB
    // OCCT WebAssembly binary, as base64 (spike S5).
    rolldownOptions: {
      input: { 'j3d-viewer': 'src/index.ts' },
      // Keep the entry's exports: Blazor imports it and calls createViewer.
      preserveEntrySignatures: 'strict',
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        // three's core, shared by the viewer and the lazily loaded mesh importers.
        codeSplitting: { groups: [{ name: 'three', test: /[\\/]node_modules[\\/]three[\\/]build[\\/]/ }] },
      },
    },
  },
  worker: {
    format: 'es',
    rolldownOptions: {
      output: {
        entryFileNames: 'workers/[name]-[hash].js',
        chunkFileNames: 'workers/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  // Tests read the packages' sources, so they run without a build; the bundle above is of what's packed (D264).
  resolve: process.env['VITEST'] ? { conditions: ['j3d-source'] } : {},
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
