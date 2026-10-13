import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Instantiating the OCCT WebAssembly module takes a few seconds.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
