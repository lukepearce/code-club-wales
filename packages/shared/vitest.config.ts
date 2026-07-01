import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Unit tests live beside the pure modules in src/**; integration-style
    // package tests live in test/**. Discover both.
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
