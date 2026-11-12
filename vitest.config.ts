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
  // P4d: TreeView.tsx (and future React components) uses the modern
  // automatic JSX runtime (`react/jsx-runtime`) — same convention as Next.js.
  // Vitest's esbuild transpiles .tsx files; tell it to emit the automatic
  // runtime so component files don't need an explicit `import * as React`
  // boilerplate. Pure-TS test files are unaffected.
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  test: {
    include: [
      'packages/**/test/**/*.test.ts',
      'packages/**/tests/**/*.test.ts',
      'apps/**/test/**/*.test.{ts,tsx}',
      'apps/**/tests/**/*.test.{ts,tsx}',
      // P4d: React component smoke tests live next to their components under
      // apps/web/components/<name>/<Component>.test.tsx. Discover them here.
      'apps/**/components/**/*.test.{ts,tsx}',
      // P4d: root-level import-boundary test scans simulation + shared +
      // rendering src dirs in one place.
      'tests/**/*.test.{ts,tsx}',
    ],
    environment: 'node',
    globals: false,
    reporters: ['default'],
  },
  define: {
    // Ensure no accidental Date.now() in sim is masked; tests provide their own clock.
  },
});
