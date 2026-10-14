import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// Output goes straight into the Blazor client's wwwroot so it is served as a static web asset.
const outDir = fileURLToPath(new URL('../J3D.Web.Client/wwwroot/viewer', import.meta.url));

/**
 * The Emscripten glue imports `node:module` only when it runs under Node. Give the browser bundle a
 * stub instead of Vite's "externalized for browser compatibility" shim and warning.
 */
function nodeModuleStub(): Plugin {
  const id = '\0j3d-node-module-stub';
  return {
    name: 'j3d-node-module-stub',
    apply: 'build',
    enforce: 'pre',
    resolveId: (source) => (source === 'node:module' ? id : undefined),
    load: (source) => (source === id ? 'export function createRequire() { throw new Error("node:module is unavailable in browsers."); }' : undefined),
  };
}

export default defineConfig({
  // Relative asset URLs (resolved against import.meta.url), since the bundle is served from /viewer/.
  base: './',
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    // The mesh chunk is three plus its loaders, fetched only on the first mesh import.
    chunkSizeWarningLimit: 1000,
    // An app build rather than library mode: library mode inlines every asset, including the 15 MB
    // OCCT WebAssembly binary, as base64 (spike S5).
    rolldownOptions: {
      input: { 'j3d-viewer': 'src/index.ts' },
      // Keep the entry's exports: Blazor imports ./viewer/j3d-viewer.js and calls createViewer.
      preserveEntrySignatures: 'strict',
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  worker: {
    format: 'es',
    plugins: () => [nodeModuleStub()],
    rolldownOptions: {
      output: {
        entryFileNames: 'workers/[name]-[hash].js',
        chunkFileNames: 'workers/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
