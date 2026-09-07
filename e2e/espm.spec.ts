import { expect, test } from '@playwright/test';
import {
  attachIssueCollector,
  ESPM_CREDS_SKIP,
  espmCredentials,
  formatIssues,
  identityScreenshotMask,
  loginEspm,
  waitForBootLoaderGone,
} from './helpers';
import { EspmApp, espmLogin, loc } from './locators';
import { espmURL, requireAppReachable } from './load-env';

test.use({ baseURL: espmURL });

test.describe('ESPM', () => {
  test.beforeAll(() => {
    requireAppReachable('espm');
  });

  test('lands on sign-in and submits the workspace form', async ({ page }, testInfo) => {
    const issues = attachIssueCollector(page);
    await page.goto(espmURL);
    const form = espmLogin(page);

    await waitForBootLoaderGone(page);
    await expect(page).not.toHaveTitle(/404/i);

    await expect(form.heading).toBeVisible({
      timeout: 40_000,
    });
    await expect(form.username).toBeVisible();
    await expect(form.password).toBeVisible();
    await expect(form.submit).toBeVisible();

    await testInfo.attach('land-url', {
      body: page.url(),
      contentType: 'text/plain',
    });

    await expect(page).toHaveScreenshot('espm-land.png', {
      maxDiffPixelRatio: 0.06,
      fullPage: true,
    });

    await form.username.fill('DeluWapes');
    await form.password.fill('DeluWapes');
    await form.submit.click();

    await expect(form.heading.or(form.error)).toBeVisible({ timeout: 15_000 });

    await testInfo.attach('issues', {
      body: formatIssues(issues),
      contentType: 'text/plain',
    });
  });

  test('logs in and opens a core list', async ({ page }, testInfo) => {
    const creds = espmCredentials();
    test.skip(!creds, ESPM_CREDS_SKIP);

    const issues = attachIssueCollector(page);
    await loginEspm(page, creds!);
    await waitForBootLoaderGone(page);

    await expect(espmLogin(page).username).toHaveCount(0);

    const listNav = loc(page, EspmApp.listNav).first();
    if (await listNav.isVisible().catch(() => false)) {
      await listNav.click();
    }

    await expect(
      loc(page, EspmApp.table)
        .or(loc(page, EspmApp.list))
        .or(loc(page, EspmApp.listHeading))
        .first(),
    ).toBeVisible({ timeout: 20_000 });

    const create = loc(page, EspmApp.create).first();
    if (await create.isVisible().catch(() => false)) {
      await create.click();
      await expect(
        loc(page, EspmApp.dialog).or(loc(page, EspmApp.createHeading)).first(),
      ).toBeVisible({ timeout: 10_000 });
      await page.keyboard.press('Escape');
    } else {
      const row = loc(page, EspmApp.dataRow).nth(1);
      if (await row.isVisible().catch(() => false)) {
        await row.click();
      }
    }

    await expect(page).toHaveScreenshot('espm-authed.png', {
      mask: identityScreenshotMask(page),
      maxDiffPixelRatio: 0.08,
      fullPage: true,
    });

    await testInfo.attach('issues', {
      body: formatIssues(issues),
      contentType: 'text/plain',
    });
  });
});
