/**
 * Playwright config (P5d — smoke test).
 *
 * Minimal config: launches the Next.js dev server on a random port, runs
 * a single smoke spec against Chromium. The smoke test exercises the
 * P5d gameplay loop end-to-end:
 *
 *   new game → buy water → apply water → advance time → harvest →
 *   save → reload → verify state restored
 *
 * Browser coverage:
 *   - Chromium only (single browser — the goal is a smoke pass, not
 *     cross-browser matrix coverage). Firefox + WebKit can be enabled by
 *     adding to `projects` once CI can provision them.
 *
 * Server:
 *   - `webServer` launches `pnpm dev` against the apps/web workspace on
 *     port 4321 (avoiding 3000 which is commonly taken by other dev
 *     servers). The `baseUrl` reuse keeps the spec file short.
 *   - `reuseExistingServer: true` so local dev can run `pnpm dev` and
 *     `pnpm test:e2e` in parallel without port conflicts.
 *
 * CI: `WEB_SERVER_URL` env var (set by the CI runner) skips launching the
 * local dev server. Mirrors Playwright's recommended CI pattern.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 4321);
const baseURL = process.env.WEB_SERVER_URL ?? `http://127.0.0.1:${PORT}`;

// Conditionally include the `webServer` block. `exactOptionalPropertyTypes`
// is enabled repo-wide (tsconfig.base.json) — assigning `webServer: undefined`
// would fail typecheck. Spreading an empty object vs. the webServer block
// avoids the explicit-undefined trap.
const webServerBlock = process.env.WEB_SERVER_URL
  ? {}
  : {
      webServer: {
        command: `pnpm --filter web exec next dev -p ${PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000, // Next dev first-boot can be slow.
        stdout: 'pipe' as const,
        stderr: 'pipe' as const,
      },
    };

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,

  // Single worker — the smoke test is one file, one browser, one tab.
  // Parallelism across files (when added) can be tuned later.
  fullyParallel: false,
  workers: 1,

  // Fail fast on the first error so CI logs are short + focused.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Headless by default. Local devs can flip via `PLAYWRIGHT_HEADED=1
    // pnpm test:e2e` to debug.
    headless: process.env.PLAYWRIGHT_HEADED !== '1',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  ...webServerBlock,
});
