import { expect, test } from '@playwright/test';
import {
  attachIssueCollector,
  dismissUsageGuide,
  ensureAppEnabled,
  formatIssues,
  gotoHubHome,
  hubScreenshotMask,
  openAppOnLeft,
  openAppTile,
  waitForRemoteReady,
} from './helpers';
import { hubURL, requireHubReachable } from './load-env';
import {
  HubCatalog,
  HubChrome,
  HubContact,
  HubDashboard,
  HubLauncher,
  HubLogin,
  HubManageApps,
  HubOcr,
  HubRemote,
  HubStudio,
  hubManageAppsRowName,
  hubPane,
  loc,
} from './locators';

test.use({ baseURL: hubURL });

test.describe('Sorye Hub', () => {
  test.beforeAll(() => {
    requireHubReachable();
  });

  test('lands on the launcher without Google', async ({ page }, testInfo) => {
    const issues = attachIssueCollector(page);
    await gotoHubHome(page);

    await expect(loc(page, HubLauncher.welcome)).toBeVisible();
    await expect(openAppTile(page, 'Catalog')).toBeVisible();
    await expect(openAppTile(page, 'Contact')).toHaveCount(0);
    await expect(loc(page, HubContact.email)).toHaveCount(0);
    await expect(openAppTile(page, 'Dashboard')).toBeVisible();
    await expect(loc(page, HubLauncher.manageApps)).toBeVisible();
    await expect(loc(page, HubLogin.continueWithGoogle)).toHaveCount(0);
    await expect(loc(page, HubLauncher.mainNav)).toBeVisible();

    await expect(page).toHaveScreenshot('hub-launcher.png', {
      mask: hubScreenshotMask(page),
      maxDiffPixelRatio: 0.03,
    });

    await testInfo.attach('console-network', {
      body: formatIssues(issues),
      contentType: 'text/plain',
    });
  });

  test('opens Catalog and Manage apps', async ({ page }, testInfo) => {
    const issues = attachIssueCollector(page);
    await gotoHubHome(page);

    await loc(page, HubLauncher.manageApps).click();
    await expect(loc(page, HubManageApps.heading)).toBeVisible();
    await expect(loc(page, HubManageApps.alwaysIncluded)).toBeVisible();
    await expect(
      loc(page, HubManageApps.row).filter({ has: loc(page, hubManageAppsRowName('Catalog')) }),
    ).toBeVisible();
    await loc(page, HubManageApps.done).click();

    await openAppOnLeft(page, 'Catalog');
    await dismissUsageGuide(page, 'Catalog');
    await expect(loc(page, HubCatalog.heading)).toBeVisible();
    await expect(loc(page, HubCatalog.manageEnabled)).toBeVisible();
    await expect(
      loc(
        loc(page, HubCatalog.row).filter({ hasText: 'Dashboard' }),
        HubCatalog.open,
      ),
    ).toBeVisible();
    await expect(loc(page, HubRemote.loadFailed)).toHaveCount(0);

    await expect(loc(page, hubPane('Catalog'))).toHaveScreenshot('hub-catalog-pane.png', {
      maxDiffPixelRatio: 0.04,
      mask: [loc(page, HubChrome.footerTime)],
    });

    await testInfo.attach('console-network', {
      body: formatIssues(issues),
      contentType: 'text/plain',
    });
  });

  test('hides Contact from chrome and serves /contact', async ({ page }, testInfo) => {
    const issues = attachIssueCollector(page);
    await gotoHubHome(page);

    await expect(page.getByRole('button', { name: 'Contact', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Contact app' })).toHaveCount(0);

    await page.goto('/contact');
    await expect(loc(page, HubContact.heading)).toBeVisible();
    await expect(loc(page, HubContact.tryProtocolio)).toBeVisible();
    await expect(loc(page, HubContact.tryCanvas)).toBeVisible();
    await expect(page.getByRole('complementary', { name: /How to use/ })).toHaveCount(0);
    await loc(page, HubContact.email).click();
    await expect(loc(page, HubContact.emailDialog)).toBeVisible();
    await expect(loc(page, HubContact.send)).toBeVisible();
    await expect(loc(page, HubRemote.loadFailed)).toHaveCount(0);

    await testInfo.attach('console-network', {
      body: formatIssues(issues),
      contentType: 'text/plain',
    });
  });

  test('opens Dashboard remote without a crash overlay', async ({ page }, testInfo) => {
    const issues = attachIssueCollector(page);
    await gotoHubHome(page);

    await openAppTile(page, 'Dashboard').click();
    await waitForRemoteReady(page, 'Dashboard');
    await expect(loc(page, HubDashboard.nav)).toBeVisible();
    await expect(loc(page, HubDashboard.workspaceOverview)).toBeVisible();

    await loc(page, HubDashboard.workspaceOverview).click();
    await expect(loc(page, HubDashboard.installedApps)).toBeVisible();

    await testInfo.attach('console-network', {
      body: formatIssues(issues),
      contentType: 'text/plain',
    });
  });

  test('opens Studio sample part when WebGPU is available', async ({ page }, testInfo) => {
    const issues = attachIssueCollector(page);
    await gotoHubHome(page);

    const enabled = await ensureAppEnabled(page, 'Studio');
    test.skip(!enabled, 'Studio could not be enabled — Free plan slot limit');

    await openAppTile(page, 'Studio').click();
    await waitForRemoteReady(page, 'Studio');
    await expect(loc(page, HubStudio.uploadModel)).toBeVisible();
    await expect(loc(page, HubStudio.samplePart)).toBeVisible();
    await expect(loc(page, HubStudio.warming)).toHaveCount(0, { timeout: 20_000 });

    const blocked = loc(page, HubStudio.webgpuBlocked);
    const sample = loc(page, HubStudio.samplePart);

    if ((await blocked.isVisible().catch(() => false)) || (await sample.isDisabled())) {
      await testInfo.attach('studio-status', {
        body: 'WebGPU unavailable in this Chromium — functional chrome only, no pixel-perfect canvas.',
        contentType: 'text/plain',
      });
      await expect(loc(page, HubStudio.heading)).toBeVisible();
    } else {
      await sample.click();
      await expect(loc(page, HubStudio.tris)).toBeVisible({ timeout: 15_000 });
    }

    await expect(page).toHaveScreenshot('hub-studio.png', {
      maxDiffPixelRatio: 0.12,
      mask: hubScreenshotMask(page),
    });

    await testInfo.attach('console-network', {
      body: formatIssues(issues),
      contentType: 'text/plain',
    });
  });

  test('opens OCR remote with upload UI', async ({ page }, testInfo) => {
    const issues = attachIssueCollector(page);
    await gotoHubHome(page);

    const enabled = await ensureAppEnabled(page, 'OCR');
    test.skip(!enabled, 'OCR could not be enabled — Free plan slot limit');

    await openAppTile(page, 'OCR').click();
    await waitForRemoteReady(page, 'OCR');
    await expect(loc(page, HubOcr.uploadPdf)).toBeVisible();
    await expect(loc(page, HubOcr.layoutMatrix)).toBeVisible();
    await expect(loc(page, HubOcr.empty)).toBeVisible();

    await testInfo.attach('console-network', {
      body: formatIssues(issues),
      contentType: 'text/plain',
    });
  });

});
