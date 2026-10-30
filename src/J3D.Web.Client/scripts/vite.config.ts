import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Output goes straight into the client's wwwroot so it is served as a static web asset.
const outDir = fileURLToPath(new URL('../wwwroot/app', import.meta.url));

export default defineConfig({
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    rolldownOptions: {
      input: { 'j3d-app': 'src/index.ts' },
      // Keep the entry's exports: .NET imports ./app/j3d-app.js and calls them.
      preserveEntrySignatures: 'strict',
      output: { entryFileNames: '[name].js' },
    },
  },
  // The app takes only touch constants from the viewer: read as source, so this needs no package build first.
  resolve: { conditions: ['j3d-source', 'module', 'browser', 'development|production'] },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
