import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'threads',
    maxWorkers: 4,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
