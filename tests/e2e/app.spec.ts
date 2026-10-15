import { expect, test } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { STATE_PATH } from "./helpers/auth";
import { collectConsole, overflowInfo, VIEWPORTS } from "./helpers/page-checks";

/**
 * Signed-in, READ-ONLY walk of the main screens. Never clicks anything that
 * mutates data. Screenshots land in test-results/screens/<page>-<viewport>.png.
 * Skipped (not failed) when DEV_AUTH_* creds are missing: see auth.setup.ts.
 * Known-failing routes (rebuilds in progress) are NOT excluded here; see
 * docs/specs/progress/E1-e2e-and-deps.md.
 */
const PAGES: Array<[string, string]> = [
  ["home", "/"],
  ["bank-feed", "/bank-feed"],
  ["financial-statements", "/financial-statements"],
  ["budget", "/budget"],
  ["dues", "/dues"],
  ["tax", "/tax"],
  ["insurance", "/insurance"],
  ["building", "/building"],
  ["repairs", "/repairs"],
  ["documents", "/documents"],
];
const SIZES = { phone: VIEWPORTS.phone, desktop: VIEWPORTS.desktop } as const;

test.beforeEach(() => {
  test.skip(!existsSync(STATE_PATH), "Signed-in e2e skipped: no saved session (dev creds missing or sign-in failed; see the setup project)");
});

for (const [vpName, vp] of Object.entries(SIZES)) {
  test.describe(`signed in @ ${vpName}`, () => {
    test.use({ viewport: vp });

    for (const [name, route] of PAGES) {
      test(`${route}`, async ({ page }) => {
        const seen = collectConsole(page);
        const res = await page.goto(route, { waitUntil: "load" });
        await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
        await page.waitForTimeout(500);

        mkdirSync("test-results/screens", { recursive: true });
        await page.screenshot({ path: `test-results/screens/${name}-${vpName}.png`, fullPage: true });

        expect(res?.status(), `${route} HTTP status`).toBeLessThan(500);
        expect(page.url(), `${route} bounced to sign-in: session invalid`).not.toMatch(/\/login/);
        const bodyText = await page.locator("body").innerText();
        expect(bodyText, `${route} rendered an error page`).not.toMatch(/Application error|Internal Server Error|This page couldn.t load|500\b.*error|Unhandled Runtime Error/i);

        const o = await overflowInfo(page);
        expect(o.scrollWidth, `horizontal overflow on ${route} @ ${vpName}; wide elements: ${o.offenders.join(" | ")}`).toBeLessThanOrEqual(o.innerWidth);
        expect(seen.csp, `CSP violations on ${route}`).toEqual([]);
        expect(seen.errors, `console errors on ${route}`).toEqual([]);
      });
    }
  });
}

test.describe("sidebar drawer @ phone", () => {
  test.use({ viewport: VIEWPORTS.phone });
  test("menu button opens and closes the navigation drawer", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main" });
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(nav).toBeVisible();
    const box = await nav.boundingBox();
    expect(box && box.x >= -1 && box.x < VIEWPORTS.phone.width, "drawer should be on screen").toBeTruthy();
    await nav.getByRole("button", { name: "Close navigation" }).click();
    await expect(nav).toBeHidden();
  });
});

// Import (import-spec 16). Read-only: the start page loads, and a template
// downloads as a file. The page needs migration 0056 on the dev project (it
// reads import_batches); the template does not touch the database.
test.describe("spreadsheet import @ desktop", () => {
  test.use({ viewport: VIEWPORTS.desktop });

  test("/building/import loads for a board admin", async ({ page }) => {
    const res = await page.goto("/building/import", { waitUntil: "load" });
    expect(res?.status(), "/building/import HTTP status").toBeLessThan(500);
    expect(page.url()).not.toMatch(/\/login/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("a template downloads as a file", async ({ request }) => {
    const res = await request.get("/building/import/template/units-owners?format=csv");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-disposition"] ?? "").toMatch(/attachment/i);
    expect((await res.body()).length).toBeGreaterThan(20);
  });
});
