import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts'],
    env: {
      VITE_PORTABLE_HEALTH_PACKAGE_ID: '0xtest',
    },
  },
});
