import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'threads',
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
