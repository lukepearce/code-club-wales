import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Each test file boots its own ephemeral Postgres container.
    testTimeout: 60_000,
    hookTimeout: 180_000,
    // One container at a time keeps Docker resource use predictable as later
    // slices add more integration test files.
    fileParallelism: false,
  },
});
