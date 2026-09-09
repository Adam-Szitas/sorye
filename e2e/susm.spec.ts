import { expect, test } from "@playwright/test";
import {
  attachIssueCollector,
  formatIssues,
  identityScreenshotMask,
  loginSusm,
  susmCredentials,
  SUSM_CREDS_SKIP,
} from "./helpers";
import {
  loc,
  SUSM_LOGIN_URL,
  susmLogin,
  SusmNav,
  SusmProjects,
} from "./locators";
import { requireAppReachable, susmURL } from "./load-env";

test.use({ baseURL: susmURL });

test.describe("SUSM", () => {
  test.beforeAll(() => {
    requireAppReachable("susm");
  });

  test("lands on login, shows brand nav, and submits the form", async ({
    page,
  }, testInfo) => {
    const issues = attachIssueCollector(page);
    await page.goto(susmURL);
    const form = susmLogin(page);

    await expect(page).not.toHaveTitle(/404|Error/i);
    await expect(page).toHaveURL(SUSM_LOGIN_URL, { timeout: 30_000 });
    await expect(form.nav).toBeVisible();
    await expect(form.brand).toBeVisible();
    await expect(form.form).toBeVisible();
    await expect(form.heading).toBeVisible();
    await expect(form.email).toBeVisible();
    await expect(form.password).toBeVisible();
    await expect(form.submit).toBeVisible();

    await testInfo.attach("land-url", {
      body: page.url(),
      contentType: "text/plain",
    });

    await expect(page).toHaveScreenshot("susm-land.png", {
      maxDiffPixelRatio: 0.05,
      fullPage: true,
    });

    await form.email.fill("test@test.te");
    await form.password.fill("Password");
    await form.submit.click();

    await expect(form.heading.or(form.error)).toBeVisible({ timeout: 15_000 });

    if (page.url().includes("/projects")) {
      await testInfo.attach("note", {
        body: "Anonymous session reached /projects after submit.",
        contentType: "text/plain",
      });
    }

    await testInfo.attach("issues", {
      body: formatIssues(issues),
      contentType: "text/plain",
    });
  });

  test("logs in and opens a project from the list", async ({
    page,
  }, testInfo) => {
    const creds = susmCredentials();
    test.skip(!creds, SUSM_CREDS_SKIP);

    const issues = attachIssueCollector(page);
    await loginSusm(page, creds!);

    await loc(loc(page, SusmNav.main), SusmNav.projects).click();
    await expect(loc(page, SusmProjects.heading)).toBeVisible();
    await expect(loc(page, SusmProjects.addNew)).toBeVisible();

    const firstProject = loc(page, SusmProjects.firstTitle).first();
    if (await firstProject.isVisible().catch(() => false)) {
      await firstProject.click();
      await expect(loc(page, SusmNav.logout)).toBeVisible();
      await expect(susmLogin(page).heading).toHaveCount(0);
    } else {
      await loc(page, SusmProjects.addNew).click();
      await expect(
        loc(page, SusmProjects.dialog)
          .or(loc(page, SusmProjects.projectHeading))
          .first(),
      ).toBeVisible({ timeout: 5_000 });
      await page.keyboard.press("Escape");
    }

    await expect(page).toHaveScreenshot("susm-authed.png", {
      mask: identityScreenshotMask(page),
      maxDiffPixelRatio: 0.08,
      fullPage: true,
    });

    await testInfo.attach("issues", {
      body: formatIssues(issues),
      contentType: "text/plain",
    });
  });
});
