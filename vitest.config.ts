import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./packages/shared/src', import.meta.url)),
      '@simulation': fileURLToPath(new URL('./packages/simulation/src', import.meta.url)),
    },
  },
  test: {
    include: ['packages/**/test/**/*.test.ts', 'apps/**/test/**/*.test.ts'],
    environment: 'node',
    globals: false,
    reporters: ['default'],
  },
  define: {
    // Ensure no accidental Date.now() in sim is masked; tests provide their own clock.
  },
});
