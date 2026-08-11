import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@pipeline': fileURLToPath(new URL('./pipeline', import.meta.url)),
    },
  },
  test: {
    include: ['pipeline/**/*.spec.ts'],
    environment: 'node',
  },
});