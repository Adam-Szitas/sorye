import { defineConfig, devices } from '@playwright/test';
import { espmURL, hubLooksUp, hubURL, susmURL } from './e2e/load-env';

const startHub =
  process.env.E2E_START_HUB === '1' && !hubLooksUp(hubURL);

/**
 * Playwright E2E + visual diffs for Hub (localhost) and local SUSM / ESPM.
 *
 * Three CLI projects: `hub`, `susm`, `espm`. Playwright UI Mode checks only the
 * **first** project unless Filters were saved — so `pnpm test:e2e:ui` uses
 * `playwright.ui.config.ts` (one combined project) instead of this file.
 *
 * Start apps yourself (`pnpm dev`, plus local SUSM/ESPM). Playwright does not
 * auto-start Hub unless E2E_START_HUB=1 and :3000 is down.
 *
 * Tests use Playwright-bundled Chromium (not `channel: 'chrome'`). That keeps
 * headed windows off Cursor's CDP Chrome and off your signed-in Chrome profile.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: 90_000,
  expect: {
    timeout: 20_000,
    toHaveScreenshot: {
      animations: 'disabled',
      maxDiffPixelRatio: 0.03,
    },
  },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    browserName: 'chromium',
    channel: undefined,
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 15_000,
    launchOptions: {
      args: ['--enable-unsafe-webgpu'],
    },
  },
  projects: [
    {
      name: 'hub',
      testMatch: /hub(?:-advanced)?\.spec\.ts/,
      use: { baseURL: hubURL },
    },
    {
      name: 'susm',
      testMatch: /susm\.spec\.ts/,
      use: { baseURL: susmURL },
    },
    {
      name: 'espm',
      testMatch: /espm\.spec\.ts/,
      use: { baseURL: espmURL },
    },
  ],
  ...(startHub
    ? {
        webServer: {
          command: 'pnpm dev',
          url: hubURL,
          reuseExistingServer: true,
          timeout: 180_000,
          stdout: 'pipe',
          stderr: 'pipe',
        },
      }
    : {}),
});
