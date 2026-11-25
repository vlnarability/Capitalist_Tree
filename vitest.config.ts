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
    // P12-C: the design-promise bot is a slow (~9 min) verification tool that
    // runs 3 scenarios at 1-day steps for 90 days + writes a markdown report.
    // Excluded from the default test run (CI); run manually via
    // `pnpm exec vitest run packages/simulation/test/design-promise-bot.test.ts`
    // (temporarily comment out this exclude line first — vitest applies the
    // exclude even when the file is passed explicitly).
    exclude: [
      // Don't run tests bundled inside dependencies. The `include` globs above
      // use `**/` which matches into node_modules, so without this exclude
      // vitest discovers ~700 irrelevant dep tests (zod ships its own
      // *.test.ts under node_modules/zod/.../tests/) per run. That ballooned
      // the test step to >10min + a dep test failure would fail CI for a
      // reason unrelated to this project. (Vitest's default exclude already
      // covers node_modules, but the explicit `include` globs here override
      // discovery — so the exclude must be re-stated explicitly.)
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      'packages/simulation/test/design-promise-bot.test.ts',
      // DR-1 long-timeframe runner (P12-C follow-up): 1-day steps × multi-year
      // is infeasible inline — the engine runs at ~1-2s/tick at 1-day steps (the
      // bot's 90d × 3 scenarios already takes ~9min). Excluded from the default
      // run; run manually for an overnight verification of the collapse ≥2yr /
      // recovery ≥1yr targets.
      'packages/simulation/test/dr1-long-run.test.ts',
      // W77: 25yr long-horizon steady-state verification (P12-C follow-up).
      // Excluded from the default suite (~15min); run manually:
      //   npx vitest run packages/simulation/test/_w77-long-horizon.test.ts
      // (temporarily comment out this exclude line first — vitest applies
      // excludes even when a file is passed explicitly).
      'packages/simulation/test/_w77-long-horizon.test.ts',
    ],
    environment: 'node',
    globals: false,
    reporters: ['default'],
  },
  define: {
    // Ensure no accidental Date.now() in sim is masked; tests provide their own clock.
  },
});
