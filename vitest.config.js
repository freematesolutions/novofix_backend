import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['src/__tests__/setup.vitest.js'],
    include: ['src/__tests__/**/*.test.js'],
    exclude: ['src/websocket/__tests__/**'],
    testTimeout: 120000,
    hookTimeout: 120000,
    env: {
      // Use locally installed mongod instead of downloading a binary
      MONGOMS_SYSTEM_BINARY: 'C:\\Program Files\\MongoDB\\Server\\8.0\\bin\\mongod.exe',
      MONGOMS_VERSION: '8.0.4',
      // Tests always run with promo OFF to validate real plan restrictions
      FREE_PLAN_PROMO: 'false',
    },
  }
});
