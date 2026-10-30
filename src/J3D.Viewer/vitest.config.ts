import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The workspace's kernel as source, so tests run without a build (D264). The node environment resolves
  // through `ssr`, and conditions set there replace its defaults, so those are named too.
  ssr: { resolve: { conditions: ['j3d-source', 'module', 'node', 'development|production'] } },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
