import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['src/__tests__/setup.vitest.js'],
    include: ['src/__tests__/**/*.test.js'],
    exclude: ['src/websocket/__tests__/**'],
    testTimeout: 120000,
    hookTimeout: 180000,
  }
});
