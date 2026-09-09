import { defineConfig } from '@playwright/test';
import config from './playwright.config';

/**
 * Playwright UI (`pnpm test:e2e:ui`) loads this file — not `playwright.config.ts`.
 *
 * UI Mode persists project checkboxes in localStorage keyed by config path, and
 * with no saved filter it enables **only the first project**. A separate config
 * with one project matching hub + susm + espm means the file tree lists all
 * three apps without requiring Filters checkboxes.
 *
 * Each spec still sets `test.use({ baseURL })` so Chromium opens Hub / SUSM / ESPM
 * on their own **localhost** hosts. CLI (`pnpm test:e2e -- --project=susm`) keeps
 * using the three named projects in `playwright.config.ts`.
 *
 * `pnpm test:e2e:ui` serves :9323 without auto-opening a browser so Cursor does
 * not steal the single UI client. Open the URL in system Chrome.
 */
export default defineConfig({
  ...config,
  projects: [
    {
      name: 'hub · susm · espm',
      testMatch: /(?:hub(?:-advanced)?|susm|espm)\.spec\.ts/,
    },
  ],
});
