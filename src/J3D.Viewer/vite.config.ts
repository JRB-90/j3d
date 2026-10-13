import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Output goes straight into the Blazor client's wwwroot so it is served as a static web asset.
const outDir = fileURLToPath(new URL('../J3D.Web.Client/wwwroot/viewer', import.meta.url));

export default defineConfig({
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'j3d-viewer.js',
    },
  },
  // The OCCT worker (and libcascade's pthread workers) use ES module workers with top-level await.
  worker: {
    format: 'es',
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
