import { expect, type Locator, type Page, type Response } from '@playwright/test';
import { espmURL, hubURL, susmURL } from './load-env';
import {
  EspmBoot,
  HubChrome,
  HubLauncher,
  HubManageApps,
  HubRemote,
  HubUsageGuide,
  SusmNav,
  espmLogin,
  hubLogin,
  hubManageAppsRowName,
  hubOpenApp,
  hubOpenAppOnLeft,
  hubPane,
  hubRemoteHeading,
  hubUsageGuide,
  identityMaskLocators,
  loc,
  susmLogin,
} from './locators';

export type CapturedIssue = {
  kind: 'console' | 'pageerror' | 'request' | 'http';
  message: string;
};

const IGNORE_CONSOLE = [
  /Download the React DevTools/i,
  /\[HMR\]/i,
  /hub-state/i,
  /sorye:hub/i,
  /Failed to load resource:.*favicon/i,
];

const IGNORE_URL = [
  /favicon\.ico/,
  /\/_next\/webpack-hmr/,
  /\/__vite_ping/,
  /chrome-extension:/,
];

export function attachIssueCollector(page: Page): CapturedIssue[] {
  const issues: CapturedIssue[] = [];

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (IGNORE_CONSOLE.some((re) => re.test(text))) return;
    issues.push({ kind: 'console', message: text });
  });

  page.on('pageerror', (err) => {
    issues.push({ kind: 'pageerror', message: err.message });
  });

  page.on('requestfailed', (req) => {
    const url = req.url();
    if (IGNORE_URL.some((re) => re.test(url))) return;
    issues.push({
      kind: 'request',
      message: `${req.failure()?.errorText ?? 'failed'} ${url}`,
    });
  });

  page.on('response', (res: Response) => {
    const status = res.status();
    if (status < 400) return;
    const url = res.url();
    if (IGNORE_URL.some((re) => re.test(url))) return;
    issues.push({ kind: 'http', message: `${status} ${url}` });
  });

  return issues;
}

export function formatIssues(issues: CapturedIssue[]): string {
  if (issues.length === 0) return '(none)';
  return issues.map((i) => `[${i.kind}] ${i.message}`).join('\n');
}

export function hubScreenshotMask(page: Page): Locator[] {
  return [
    loc(page, HubChrome.footerTime),
    loc(page, HubChrome.signOut).locator('xpath=..'),
  ];
}

export async function gotoHubHome(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(hubURL);

  const form = hubLogin(page);
  const continueLocal = form.continueLocally;
  const google = form.continueWithGoogle;
  const welcome = loc(page, HubLauncher.welcome);

  try {
    await expect(welcome.or(continueLocal).or(google)).toBeVisible({
      timeout: 25_000,
    });
  } catch {
    throw new Error(
      `Hub did not render the launcher or login. URL=${page.url()}. Is Postgres up if STORE_DRIVER=postgres?`,
    );
  }

  if (await google.isVisible().catch(() => false)) {
    throw new Error(
      'Hub asked for Google sign-in. Set AUTH_DEV_BYPASS=true in apps/hub/.env.local (development only).',
    );
  }

  if (await continueLocal.isVisible().catch(() => false)) {
    await continueLocal.click();
  }

  await expect(welcome).toBeVisible({ timeout: 25_000 });
  await expect(openAppTile(page, 'Catalog')).toBeVisible();
}

export function openAppTile(page: Page, appName: string) {
  return loc(page, hubOpenApp(appName));
}

export async function waitForRemoteReady(page: Page, heading: string): Promise<void> {
  await expect(loc(page, HubRemote.loading)).toHaveCount(0, { timeout: 45_000 });
  await expect(loc(page, HubRemote.loadFailed)).toHaveCount(0);
  await expect(loc(page, HubRemote.unavailable)).toHaveCount(0);
  await expect(loc(page, hubRemoteHeading(heading))).toBeVisible({
    timeout: 20_000,
  });
}

export async function ensureAppEnabled(
  page: Page,
  appName: string,
): Promise<boolean> {
  const openTile = openAppTile(page, appName);
  if ((await openTile.count()) > 0) return true;

  await loc(page, HubLauncher.manageApps).click();
  await expect(loc(page, HubManageApps.heading)).toBeVisible();

  const row = loc(page, HubManageApps.row).filter({
    has: loc(page, hubManageAppsRowName(appName)),
  });
  await expect(row).toBeVisible();
  const toggle = loc(row, HubManageApps.rowToggle).first();

  if (await toggle.isDisabled()) {
    await loc(page, HubManageApps.done).click();
    return false;
  }

  await toggle.click();
  await loc(page, HubManageApps.done).click();
  await expect(loc(page, HubLauncher.welcome)).toBeVisible();
  await expect(openTile).toBeVisible();
  return true;
}

export async function openAppOnLeft(page: Page, appName: string): Promise<void> {
  await loc(page, hubOpenAppOnLeft(appName)).click();
  await expect(loc(page, hubPane(appName))).toBeVisible();
}

export async function dismissUsageGuide(page: Page, appName: string): Promise<void> {
  const guide = loc(page, hubUsageGuide(appName));
  if (await guide.isVisible().catch(() => false)) {
    await loc(guide, HubUsageGuide.gotIt).click();
  }
}

export async function waitForBootLoaderGone(page: Page): Promise<void> {
  const boot = loc(page, EspmBoot.loader);
  if ((await boot.count()) === 0) return;
  await expect(boot.first()).toBeHidden({ timeout: 45_000 }).catch(async () => {
    await expect(loc(page, EspmBoot.loadingText)).toHaveCount(0, { timeout: 20_000 });
  });
}

export type SusmCredentials = { email: string; password: string };
export type EspmCredentials = { username: string; password: string };

export const SUSM_CREDS_SKIP =
  'Set SUSM_EMAIL and SUSM_PASSWORD in e2e/.env (or $env:SUSM_EMAIL / $env:SUSM_PASSWORD) to run authenticated SUSM journeys';

export const ESPM_CREDS_SKIP =
  'Set ESPM_USERNAME and ESPM_PASSWORD in e2e/.env (or $env:ESPM_USERNAME / $env:ESPM_PASSWORD) to run authenticated ESPM journeys';

export function susmCredentials(): SusmCredentials | null {
  const email = process.env.SUSM_EMAIL?.trim() ?? '';
  const password = process.env.SUSM_PASSWORD ?? '';
  if (!email || !password) return null;
  return { email, password };
}

export function espmCredentials(): EspmCredentials | null {
  const username = process.env.ESPM_USERNAME?.trim() ?? '';
  const password = process.env.ESPM_PASSWORD ?? '';
  if (!username || !password) return null;
  return { username, password };
}

/** Mask emails, names, and user chips in visual snapshots. */
export function identityScreenshotMask(page: Page): Locator[] {
  return identityMaskLocators(page);
}

export async function loginSusm(page: Page, creds: SusmCredentials): Promise<void> {
  await page.goto(susmURL);
  const form = susmLogin(page);
  await expect(form.heading).toBeVisible({
    timeout: 30_000,
  });
  await form.email.fill(creds.email);
  await form.password.fill(creds.password);
  await form.submit.click();
  await expect(form.heading).toHaveCount(0, {
    timeout: 25_000,
  });
  await expect(loc(page, SusmNav.logout)).toBeVisible({
    timeout: 20_000,
  });
}

export async function loginEspm(page: Page, creds: EspmCredentials): Promise<void> {
  await page.goto(espmURL);
  await waitForBootLoaderGone(page);
  const form = espmLogin(page);
  await expect(form.username).toBeVisible({ timeout: 40_000 });
  await form.username.fill(creds.username);
  await form.password.fill(creds.password);
  await form.submit.click();
  await expect(form.username).toHaveCount(0, {
    timeout: 25_000,
  });
}
