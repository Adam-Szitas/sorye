import { expect, test } from '@playwright/test';
import {
  attachIssueCollector,
  dismissUsageGuide,
  ensureAppEnabled,
  formatIssues,
  gotoHubHome,
  openAppOnLeft,
  openAppOnRight,
  openAppTile,
  returnToHubLauncher,
  waitForRemoteReady,
} from './helpers';
import { hubURL, requireAppReachable } from './load-env';
import {
  HubCatalog,
  HubChrome,
  HubContact,
  HubDashboard,
  HubDock,
  HubDrive,
  HubLauncher,
  HubMail,
  HubManageApps,
  HubMessenger,
  HubNotifications,
  HubRelay,
  HubRemote,
  HubReports,
  HubSite,
  HubStorefront,
  HubTasks,
  hubDriveFile,
  hubDrivePreview,
  hubNotificationTitle,
  hubPane,
  hubRelayRouteRow,
  hubUsageGuide,
  loc,
} from './locators';

test.use({ baseURL: hubURL });

test.describe('Sorye Hub advanced', { tag: '@advanced' }, () => {
  test.beforeAll(() => {
    requireAppReachable('hub');
  });

  test('launcher dock opens a split Catalog + Dashboard desk', async ({
    page,
  }, testInfo) => {
    const issues = attachIssueCollector(page);
    await gotoHubHome(page);

    const nav = loc(page, HubLauncher.mainNav);
    await expect(loc(nav, HubDock.home)).toBeVisible();
    await expect(loc(nav, HubDock.apps)).toBeVisible();
    await expect(loc(nav, HubDock.connect)).toBeVisible();

    await loc(nav, HubDock.apps).click();
    await expect(loc(page, HubManageApps.heading)).toBeVisible();
    await loc(page, HubManageApps.done).click();
    await expect(loc(page, HubLauncher.welcome)).toBeVisible();

    await openAppOnLeft(page, 'Catalog');
    await dismissUsageGuide(page, 'Catalog');
    await expect(loc(page, HubCatalog.heading)).toBeVisible();
    await expect(loc(nav, HubDock.split)).toBeVisible();

    await loc(page, HubChrome.appGrid).click();
    await expect(loc(page, HubLauncher.welcome)).toBeVisible();

    await openAppOnRight(page, 'Dashboard');
    await waitForRemoteReady(page, 'Dashboard');
    await dismissUsageGuide(page, 'Dashboard');

    await expect(loc(page, hubPane('Catalog', 'left'))).toBeVisible();
    await expect(loc(page, hubPane('Dashboard', 'right'))).toBeVisible();
    await expect(loc(page, HubChrome.resizePanes)).toBeVisible();

    await loc(page, HubChrome.appGrid).click();
    await loc(nav, HubDock.split).click();
    await expect(loc(page, hubPane('Catalog', 'left'))).toBeVisible();
    await expect(loc(page, hubPane('Dashboard', 'right'))).toBeVisible();

    await testInfo.attach('console-network', {
      body: formatIssues(issues),
      contentType: 'text/plain',
    });
  });

  test('Catalog Manage enabled apps opens the App Library', async ({
    page,
  }, testInfo) => {
    const issues = attachIssueCollector(page);
    await gotoHubHome(page);

    await openAppOnLeft(page, 'Catalog');
    await dismissUsageGuide(page, 'Catalog');
    await loc(page, HubCatalog.manageEnabled).click();
    await expect(loc(page, HubManageApps.heading)).toBeVisible();
    await loc(page, HubManageApps.done).click();
    await expect(loc(page, HubCatalog.heading)).toBeVisible();

    await testInfo.attach('console-network', {
      body: formatIssues(issues),
      contentType: 'text/plain',
    });
  });

  test('notifications center opens from the bell', async ({ page }, testInfo) => {
    const issues = attachIssueCollector(page);
    await gotoHubHome(page);

    await loc(page, HubChrome.notifications).click();
    await expect(loc(page, HubNotifications.center)).toBeVisible();
    await expect(loc(page, HubNotifications.heading)).toBeVisible();
    await expect(loc(page, HubNotifications.toastPopups)).toBeVisible();
    if ((await loc(page, HubNotifications.toast).count()) > 0) {
      await expect(loc(page, HubNotifications.toast).first()).toBeVisible();
    }
    await loc(loc(page, HubNotifications.center), HubNotifications.close).click();
    await expect(loc(page, HubNotifications.center)).toHaveCount(0);

    await testInfo.attach('console-network', {
      body: formatIssues(issues),
      contentType: 'text/plain',
    });
  });

  test('Mail compose modal opens from Hub Mail', async ({ page }, testInfo) => {
    const issues = attachIssueCollector(page);
    await gotoHubHome(page);

    const enabled = await ensureAppEnabled(page, 'Mail', { swap: true });
    test.skip(!enabled, 'Mail could not be enabled — plan slot limit');

    await openAppTile(page, 'Mail').click();
    await expect(loc(page, HubMail.loading)).toHaveCount(0, { timeout: 20_000 });
    await waitForRemoteReady(page, 'Mail');
    await dismissUsageGuide(page, 'Mail');

    await loc(page, HubMail.compose).first().click();
    const dialog = loc(page, HubMail.composeDialog);
    await expect(dialog).toBeVisible();
    await expect(loc(dialog, HubMail.composeHeading)).toBeVisible();
    await expect(loc(dialog, HubMail.to)).toBeVisible();
    await expect(loc(dialog, HubMail.subject)).toBeVisible();
    await expect(loc(dialog, HubMail.message)).toBeVisible();

    await loc(dialog, HubMail.subject).fill('e2e compose');
    await loc(dialog, HubMail.message).fill('In-workspace only.');

    const send = loc(dialog, HubMail.send);
    if (await send.isEnabled()) {
      await send.click();
      await expect(dialog).toBeHidden({ timeout: 15_000 });
      await expect(loc(page, HubMail.sent)).toBeVisible();
    } else {
      await loc(dialog, HubMail.cancel).click();
      await expect(dialog).toBeHidden();
    }

    await testInfo.attach('console-network', {
      body: formatIssues(issues),
      contentType: 'text/plain',
    });
  });

  test('Messenger Forward to Mail opens the compose modal', async ({
    page,
  }, testInfo) => {
    const issues = attachIssueCollector(page);
    await gotoHubHome(page);

    const enabled = await ensureAppEnabled(page, 'Messenger', { swap: true });
    test.skip(!enabled, 'Messenger could not be enabled — plan slot limit');

    await openAppOnLeft(page, 'Messenger');
    await expect(loc(page, HubMessenger.loading)).toHaveCount(0, {
      timeout: 20_000,
    });
    await waitForRemoteReady(page, 'Messenger');
    await dismissUsageGuide(page, 'Messenger');

    await expect(loc(page, HubMessenger.composer)).toBeEnabled({
      timeout: 20_000,
    });
    await loc(page, HubMessenger.composer).fill('e2e forward to mail');
    await loc(page, HubMessenger.send).click();
    await expect(page.getByText('e2e forward to mail').first()).toBeVisible();

    await loc(page, HubMessenger.forwardToMail).last().click();
    const dialog = loc(page, HubMail.composeDialog);
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(loc(dialog, HubMail.subject)).toHaveValue(/Fwd:/);
    await loc(dialog, HubMail.cancel).click();
    await expect(dialog).toBeHidden();

    await testInfo.attach('console-network', {
      body: formatIssues(issues),
      contentType: 'text/plain',
    });
  });

  test('Contact email modal on public /contact', async ({ page }, testInfo) => {
    const issues = attachIssueCollector(page);
    await gotoHubHome(page);
    await page.goto(`${hubURL}/contact`);

    await expect(loc(page, HubContact.heading)).toBeVisible();
    await expect(page.getByRole('complementary', { name: /How to use/ })).toHaveCount(
      0,
    );

    await loc(page, HubContact.email).click();
    const dialog = loc(page, HubContact.emailModal);
    await expect(dialog).toBeVisible();
    await expect(loc(dialog, HubContact.emailDialog)).toBeVisible();
    await expect(loc(dialog, HubContact.to)).toBeVisible();
    await expect(loc(dialog, HubContact.subject)).toBeVisible();
    await expect(loc(dialog, HubContact.yourName)).toBeVisible();
    await expect(loc(dialog, HubContact.yourEmail)).toBeVisible();
    await expect(loc(dialog, HubContact.company)).toBeVisible();
    await expect(loc(dialog, HubContact.whatYouNeed)).toBeVisible();
    await expect(loc(dialog, HubContact.send)).toBeVisible();
    await loc(dialog, HubContact.close).click();
    await expect(dialog).toBeHidden();

    await testInfo.attach('console-network', {
      body: formatIssues(issues),
      contentType: 'text/plain',
    });
  });

  test('Contact Try Protocolio mounts the remote without a usage guide', async ({
    page,
  }, testInfo) => {
    const issues = attachIssueCollector(page);
    await gotoHubHome(page);
    await page.goto(`${hubURL}/contact`);
    await expect(loc(page, HubContact.tryProtocolio)).toBeVisible();

    await loc(page, HubContact.tryProtocolio).click();
    await waitForRemoteReady(page, 'Protocolio');
    await expect(loc(page, hubUsageGuide('Protocolio'))).toHaveCount(0);
    await expect(loc(page, HubRemote.loadFailed)).toHaveCount(0);

    await testInfo.attach('console-network', {
      body: formatIssues(issues),
      contentType: 'text/plain',
    });
  });

  test('Contact Try Canvas mounts the remote without a usage guide', async ({
    page,
  }, testInfo) => {
    const issues = attachIssueCollector(page);
    await gotoHubHome(page);
    await page.goto(`${hubURL}/contact`);
    await expect(loc(page, HubContact.tryCanvas)).toBeVisible();

    await loc(page, HubContact.tryCanvas).click();
    await waitForRemoteReady(page, 'Canvas');
    await expect(loc(page, hubUsageGuide('Canvas'))).toHaveCount(0);
    await expect(loc(page, HubRemote.loadFailed)).toHaveCount(0);

    await testInfo.attach('console-network', {
      body: formatIssues(issues),
      contentType: 'text/plain',
    });
  });

  test('Drive search and Open preview modal', async ({ page }, testInfo) => {
    const issues = attachIssueCollector(page);
    await gotoHubHome(page);

    const enabled = await ensureAppEnabled(page, 'Drive', { swap: true });
    test.skip(!enabled, 'Drive could not be enabled — plan slot limit');

    await openAppTile(page, 'Drive').click();
    await expect(loc(page, HubDrive.loading)).toHaveCount(0, { timeout: 20_000 });
    await waitForRemoteReady(page, 'Drive');
    await dismissUsageGuide(page, 'Drive');

    const fileName = `e2e-drive-${Date.now()}.txt`;
    await loc(page, HubDrive.upload).setInputFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from(
        'e2e Drive preview fixture — tiny text file for Hub advanced tests.\n',
      ),
    });
    await expect(loc(page, hubDriveFile(fileName))).toBeVisible({
      timeout: 20_000,
    });

    await loc(page, HubDrive.search).fill(fileName);
    await expect(loc(page, hubDriveFile(fileName))).toBeVisible();

    await loc(page, HubDrive.open).first().click();
    const preview = loc(page, hubDrivePreview(fileName));
    await expect(preview).toBeVisible();
    await expect(loc(preview, HubDrive.previewLoading)).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(preview.getByText(/e2e Drive preview fixture/)).toBeVisible();
    await loc(preview, HubDrive.previewClose).click();
    await expect(preview).toBeHidden();

    await testInfo.attach('console-network', {
      body: formatIssues(issues),
      contentType: 'text/plain',
    });
  });

  test('Storefront add to cart and place enquiry', async ({ page }, testInfo) => {
    const issues = attachIssueCollector(page);
    await gotoHubHome(page);

    const enabled = await ensureAppEnabled(page, 'Storefront', { swap: true });
    test.skip(!enabled, 'Storefront could not be enabled — plan slot limit');

    await openAppTile(page, 'Storefront').click();
    await waitForRemoteReady(page, 'Storefront');
    await dismissUsageGuide(page, 'Storefront');

    await loc(page, HubStorefront.addToCart).first().click();
    await expect(loc(page, HubStorefront.addedNotice)).toBeVisible();
    await loc(page, HubStorefront.cart).click();
    await loc(page, HubStorefront.placeOrder).click();
    await expect(
      loc(page, HubStorefront.placedNotice).or(loc(page, HubStorefront.orders)),
    ).toBeVisible({ timeout: 20_000 });

    await testInfo.attach('console-network', {
      body: formatIssues(issues),
      contentType: 'text/plain',
    });
  });

  test('Site editor loads without publishing', async ({ page }, testInfo) => {
    const issues = attachIssueCollector(page);
    await gotoHubHome(page);

    const enabled = await ensureAppEnabled(page, 'Site', { swap: true });
    test.skip(!enabled, 'Site could not be enabled — plan slot limit');

    await openAppTile(page, 'Site').click();
    await expect(loc(page, HubSite.loading)).toHaveCount(0, { timeout: 20_000 });
    await waitForRemoteReady(page, 'Site');
    await dismissUsageGuide(page, 'Site');

    await expect(loc(page, HubSite.pageTitle)).toBeVisible();
    await expect(loc(page, HubSite.addSection)).toBeVisible();
    await expect(loc(page, HubSite.published)).toBeVisible();

    await testInfo.attach('console-network', {
      body: formatIssues(issues),
      contentType: 'text/plain',
    });
  });

  test('Reports page shows volume chart when admin', async ({ page }, testInfo) => {
    const issues = attachIssueCollector(page);
    await gotoHubHome(page);

    const tile = openAppTile(page, 'Reports');
    test.skip((await tile.count()) === 0, 'Reports is hidden — not an admin session');

    await tile.click();
    await expect(loc(page, HubReports.loading)).toHaveCount(0, { timeout: 20_000 });
    await waitForRemoteReady(page, 'Reports');
    await dismissUsageGuide(page, 'Reports');
    await expect(loc(page, HubReports.forbidden)).toHaveCount(0);

    await expect(
      loc(page, HubReports.volumeChart).or(loc(page, HubReports.empty)),
    ).toBeVisible();

    await testInfo.attach('console-network', {
      body: formatIssues(issues),
      contentType: 'text/plain',
    });
  });

  test('Dashboard App events tab and overview scroll', async ({
    page,
  }, testInfo) => {
    const issues = attachIssueCollector(page);
    await gotoHubHome(page);

    await openAppTile(page, 'Dashboard').click();
    await waitForRemoteReady(page, 'Dashboard');
    await dismissUsageGuide(page, 'Dashboard');

    await loc(page, HubDashboard.workspaceOverview).scrollIntoViewIfNeeded();
    await loc(page, HubDashboard.workspaceOverview).click();
    await loc(page, HubDashboard.installedApps).scrollIntoViewIfNeeded();
    await expect(loc(page, HubDashboard.installedApps)).toBeVisible();

    await loc(page, HubDashboard.appEvents).click();
    await expect(loc(page, HubDashboard.appEventsHeading)).toBeVisible();

    await testInfo.attach('console-network', {
      body: formatIssues(issues),
      contentType: 'text/plain',
    });
  });

  test('Relay routes a Tasks create into Messenger #events', async ({
    page,
  }, testInfo) => {
    const issues = attachIssueCollector(page);
    await gotoHubHome(page);

    // Free plan: Dashboard + Messenger first so App events is eligible.
    const messengerOn = await ensureAppEnabled(page, 'Messenger', {
      swap: true,
    });
    test.skip(!messengerOn, 'Messenger could not be enabled — plan slot limit');

    // Stay in Hub panes so App grid + notification bell remain available.
    await openAppOnLeft(page, 'Dashboard');
    await waitForRemoteReady(page, 'Dashboard');
    await dismissUsageGuide(page, 'Dashboard');
    await loc(page, HubDashboard.appEvents).click();
    await expect(loc(page, HubDashboard.appEventsHeading)).toBeVisible();

    const eventsSwitch = loc(page, HubDashboard.appEventsSwitch);
    await expect(eventsSwitch).toBeVisible();
    if (!(await eventsSwitch.isChecked())) {
      await eventsSwitch.click();
      await expect(eventsSwitch).toBeChecked({ timeout: 15_000 });
    }

    await returnToHubLauncher(page);

    // Configure Relay (may swap Messenger temporarily; defaults already route Tasks).
    const relayOn = await ensureAppEnabled(page, 'Relay', {
      swap: true,
      protectDashboard: false,
    });
    test.skip(!relayOn, 'Relay could not be enabled — plan slot limit');

    await openAppOnLeft(page, 'Relay');
    await waitForRemoteReady(page, 'Relay');
    await dismissUsageGuide(page, 'Relay');
    await loc(page, HubRelay.configureTab).click();
    await expect(loc(page, HubRelay.routingRules)).toBeVisible();

    const tasksSource = loc(page, HubRelay.sourceTasks).first();
    if (!(await tasksSource.isChecked())) {
      await tasksSource.check();
      await expect(loc(page, HubRelay.savedNotice)).toBeVisible({
        timeout: 15_000,
      });
    }

    const messengerChannel = page
      .locator('article.channel-card')
      .filter({ hasText: 'Messenger' })
      .getByRole('checkbox', { name: 'Enabled' });
    if (!(await messengerChannel.isChecked())) {
      await messengerChannel.check();
      await expect(loc(page, HubRelay.savedNotice)).toBeVisible({
        timeout: 15_000,
      });
    }

    let tasksRoute = loc(page, hubRelayRouteRow('Tasks'));
    if ((await tasksRoute.count()) === 0) {
      await page.getByLabel('App').selectOption('tasks');
      await page.getByLabel('Channel').selectOption({ label: /Messenger/ });
      await loc(page, HubRelay.addRoute).click();
      await expect(loc(page, HubRelay.savedNotice)).toBeVisible({
        timeout: 15_000,
      });
      tasksRoute = loc(page, hubRelayRouteRow('Tasks'));
    }
    await expect(tasksRoute.first()).toBeVisible();
    const routeOn = loc(tasksRoute.first(), HubRelay.routeOn);
    if (!(await routeOn.isChecked())) {
      await routeOn.check();
      await expect(loc(page, HubRelay.savedNotice)).toBeVisible({
        timeout: 15_000,
      });
    }

    await returnToHubLauncher(page);

    // Emit requires Messenger + Tasks selected (eligible) — swap Dashboard if needed.
    const messengerAgain = await ensureAppEnabled(page, 'Messenger', {
      swap: true,
      protectDashboard: false,
    });
    test.skip(
      !messengerAgain,
      'Messenger could not be re-enabled for delivery',
    );
    const tasksOn = await ensureAppEnabled(page, 'Tasks', {
      swap: true,
      protectDashboard: false,
      alsoKeep: ['Messenger'],
    });
    test.skip(!tasksOn, 'Tasks could not be enabled — plan slot limit');

    await openAppOnLeft(page, 'Tasks');
    await waitForRemoteReady(page, 'Tasks');
    await dismissUsageGuide(page, 'Tasks');

    const taskTitle = `e2e-relay-task-${Date.now()}`;
    await loc(page, HubTasks.newTask).fill(taskTitle);
    await loc(page, HubTasks.addTask).click();
    await expect(page.getByText(taskTitle, { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });

    await returnToHubLauncher(page);
    await openAppOnLeft(page, 'Messenger');
    await expect(loc(page, HubMessenger.loading)).toHaveCount(0, {
      timeout: 20_000,
    });
    await waitForRemoteReady(page, 'Messenger');
    await dismissUsageGuide(page, 'Messenger');

    await loc(page, HubMessenger.eventsChannel).click();
    const eventTitle = `Task created: ${taskTitle}`;
    const eventsThread = loc(page, HubMessenger.conversation);
    const eventBubble = eventsThread.locator('article').filter({
      hasText: eventTitle,
    });
    await expect(eventBubble).toBeVisible({ timeout: 25_000 });
    await expect(eventBubble.getByText('sorye.task.created')).toBeVisible();

    await loc(page, HubChrome.notifications).click();
    await expect(loc(page, HubNotifications.center)).toBeVisible();
    await expect(
      loc(
        loc(page, HubNotifications.center),
        hubNotificationTitle(eventTitle),
      ),
    ).toBeVisible({ timeout: 15_000 });

    await testInfo.attach('console-network', {
      body: formatIssues(issues),
      contentType: 'text/plain',
    });
  });
});
