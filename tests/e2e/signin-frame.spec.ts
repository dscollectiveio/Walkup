import { expect, test } from "@playwright/test";
import { devCreds, freshTotp } from "./helpers/auth";

/**
 * Regression: after signing in (or resetting a password) the very first page
 * must have the sidebar, the top bar and the app's column, with no refresh.
 * The layout used to pick "bare" from the request path, which after a server
 * redirect was still the sign-in page.
 */
test("the app frame is there right after sign-in, without a refresh", async ({ page }) => {
  const { email, password, totp, missing } = devCreds();
  test.skip(missing.length > 0, `missing env ${missing.join(", ")}`);

  await page.goto("/login");
  // The sign-in page itself is bare.
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);

  await page.getByLabel("Email").fill(email!);
  await page.locator("#password").fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  // The code step is bare too, even when the address bar still says "/" after the redirect.
  await expect(page.locator("#code").or(page.getByRole("button", { name: "Sign out" }))).toBeVisible({ timeout: 30_000 });
  if (await page.locator("#code").isVisible()) {
    await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
    await expect(page.locator("header", { hasText: "Sign out" })).toHaveCount(0);
    await page.locator("#code").fill(await freshTotp(totp!));
    await page.getByRole("button", { name: "Verify" }).click();
  }
  // Wait for the dashboard itself (the URL changes a beat before the page does).
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)/ })).toBeVisible({ timeout: 30_000 });

  // No page.reload() and no second goto: whatever the sign-in left on screen is what we check.
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await expect(page.locator("header").first()).toContainText("Sign out");
  const box = await page.locator("main").first().boundingBox();
  expect(box!.x).toBeGreaterThan(24); // inside the column, not against the edge
});
