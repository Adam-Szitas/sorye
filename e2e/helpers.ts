import {
  expect,
  type Locator,
  type Page,
  type Response,
} from "@playwright/test";
import { hubURL } from "./load-env";
import {
  HubChrome,
  HubLauncher,
  HubManageApps,
  HubRemote,
  HubUsageGuide,
  hubLogin,
  hubManageAppsRowName,
  hubOpenApp,
  hubOpenAppOnLeft,
  hubOpenAppOnRight,
  hubPane,
  hubRemoteHeading,
  hubUsageGuide,
  loc,
} from "./locators";

export type CapturedIssue = {
  kind: "console" | "pageerror" | "request" | "http";
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

  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (IGNORE_CONSOLE.some((re) => re.test(text))) return;
    issues.push({ kind: "console", message: text });
  });

  page.on("pageerror", (err) => {
    issues.push({ kind: "pageerror", message: err.message });
  });

  page.on("requestfailed", (req) => {
    const url = req.url();
    if (IGNORE_URL.some((re) => re.test(url))) return;
    issues.push({
      kind: "request",
      message: `${req.failure()?.errorText ?? "failed"} ${url}`,
    });
  });

  page.on("response", (res: Response) => {
    const status = res.status();
    if (status < 400) return;
    const url = res.url();
    if (IGNORE_URL.some((re) => re.test(url))) return;
    issues.push({ kind: "http", message: `${status} ${url}` });
  });

  return issues;
}

export function formatIssues(issues: CapturedIssue[]): string {
  if (issues.length === 0) return "(none)";
  return issues.map((i) => `[${i.kind}] ${i.message}`).join("\n");
}

export function hubScreenshotMask(page: Page): Locator[] {
  return [
    loc(page, HubChrome.footerTime),
    loc(page, HubChrome.signOut).locator("xpath=.."),
  ];
}

export async function gotoHubHome(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
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
      "Hub asked for Google sign-in. Set AUTH_DEV_BYPASS=true in apps/hub/.env.local (development only).",
    );
  }

  if (await continueLocal.isVisible().catch(() => false)) {
    await continueLocal.click();
  }

  await expect(welcome).toBeVisible({ timeout: 25_000 });
  await expect(openAppTile(page, "Catalog")).toBeVisible();
}

export function openAppTile(page: Page, appName: string) {
  return loc(page, hubOpenApp(appName));
}

export async function waitForRemoteReady(
  page: Page,
  heading: string,
): Promise<void> {
  await expect(loc(page, HubRemote.loading)).toHaveCount(0, {
    timeout: 45_000,
  });
  await expect(loc(page, HubRemote.loadFailed)).toHaveCount(0);
  await expect(loc(page, HubRemote.unavailable)).toHaveCount(0);
  await expect(loc(page, hubRemoteHeading(heading))).toBeVisible({
    timeout: 20_000,
  });
}

export async function returnToHubLauncher(page: Page): Promise<void> {
  const welcome = loc(page, HubLauncher.welcome);
  if (await welcome.isVisible().catch(() => false)) return;

  // Full-page `/apps/[slug]` chrome uses “← Hub”.
  const hubLink = page.getByRole('link', { name: /^(← Hub|Back to Hub)$/ });
  if (await hubLink.isVisible().catch(() => false)) {
    await hubLink.click();
    await expect(welcome).toBeVisible({ timeout: 25_000 });
    return;
  }

  // Clear open panes — App grid alone leaves workspaceOpen true, so Manage apps
  // Done would jump back into the desk instead of the launcher.
  const closeAll = loc(page, HubChrome.closeAll);
  if (await closeAll.isVisible().catch(() => false)) {
    await closeAll.click();
    await expect(welcome).toBeVisible({ timeout: 25_000 });
    return;
  }

  const appGrid = loc(page, HubChrome.appGrid);
  if (await appGrid.isVisible().catch(() => false)) {
    await appGrid.click();
  } else {
    await page.goto(hubURL);
  }

  await expect(welcome).toBeVisible({ timeout: 25_000 });
}

export async function ensureAppEnabled(
  page: Page,
  appName: string,
  options?: {
    swap?: boolean;
    /** Keep Dashboard when freeing a slot (default true). */
    protectDashboard?: boolean;
    /** Extra app names that must not be swapped off. */
    alsoKeep?: string[];
  },
): Promise<boolean> {
  const openTile = openAppTile(page, appName);
  if ((await openTile.count()) > 0) return true;

  await loc(page, HubLauncher.manageApps).click();
  await expect(loc(page, HubManageApps.heading)).toBeVisible();

  const rowFor = (name: string) =>
    loc(page, HubManageApps.row).filter({
      has: loc(page, hubManageAppsRowName(name)),
    });

  const toggleFor = (name: string) => loc(rowFor(name), HubManageApps.rowToggle).first();

  await expect(rowFor(appName)).toBeVisible();
  let toggle = toggleFor(appName);

  if (await toggle.isDisabled()) {
    if (!options?.swap) {
      await loc(page, HubManageApps.done).click();
      return false;
    }

    const protectDashboard = options.protectDashboard !== false;
    const keep = new Set(["Catalog", "Reports", appName, ...(options.alsoKeep ?? [])]);
    if (protectDashboard) keep.add("Dashboard");

    const swapOrder = [
      "Studio",
      "OCR",
      "Notes",
      "Calendar",
      "Tasks",
      "Relay",
      "DevKit",
      "Protocolio",
      "Canvas",
      "Storefront",
      "Site",
      "Mail",
      "Drive",
      "Messenger",
      "Dashboard",
    ];

    let freed = false;
    for (const other of swapOrder) {
      if (keep.has(other)) continue;
      const otherRow = rowFor(other);
      if ((await otherRow.count()) === 0) continue;
      const otherToggle = toggleFor(other);
      if (await otherToggle.isDisabled()) continue;
      await otherToggle.click();
      freed = true;
      break;
    }

    if (!freed) {
      await loc(page, HubManageApps.done).click();
      return false;
    }

    toggle = toggleFor(appName);
    if (await toggle.isDisabled()) {
      await loc(page, HubManageApps.done).click();
      return false;
    }
  }

  await toggle.click();
  await loc(page, HubManageApps.done).click();
  // If a desk was still open underneath, Done restores it — land on launcher.
  if (!(await loc(page, HubLauncher.welcome).isVisible().catch(() => false))) {
    await returnToHubLauncher(page);
  }
  await expect(loc(page, HubLauncher.welcome)).toBeVisible();
  await expect(openTile).toBeVisible();
  return true;
}

export async function openAppOnLeft(
  page: Page,
  appName: string,
): Promise<void> {
  await loc(page, hubOpenAppOnLeft(appName)).click();
  await expect(loc(page, hubPane(appName, "left"))).toBeVisible();
}

export async function openAppOnRight(
  page: Page,
  appName: string,
): Promise<void> {
  await loc(page, hubOpenAppOnRight(appName)).click();
  await expect(loc(page, hubPane(appName, "right"))).toBeVisible();
}

export async function dismissUsageGuide(
  page: Page,
  appName: string,
): Promise<void> {
  const guide = loc(page, hubUsageGuide(appName));
  if (await guide.isVisible().catch(() => false)) {
    await loc(guide, HubUsageGuide.gotIt).click();
  }
}
