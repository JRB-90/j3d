import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The workspace's kernel as source, so tests run without a build (D264).
  resolve: { conditions: ['j3d-source'] },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
