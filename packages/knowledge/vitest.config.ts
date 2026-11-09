import { defineConfig } from 'vitest/config';

// Unit tests only; test/integration needs Docker and runs through vitest.integration.config.ts.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/integration/**'],
  },
});
