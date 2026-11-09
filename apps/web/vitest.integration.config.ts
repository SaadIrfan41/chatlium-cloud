import { defineConfig } from 'vitest/config';

// Integration tests start a real Postgres through Testcontainers, so Docker must be running.
export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
