import { expect, test } from "@playwright/test";
import { collectConsole, overflowInfo, VIEWPORTS } from "./helpers/page-checks";

// Tap-target rule: standalone links/buttons >= 36px (asserted), >= 40px (reported). Inline links inside sentences are exempt.
const ROUTES = ["/", "/login", "/signup", "/forgot-password", "/privacy", "/terms", "/security", "/policies"];

for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
  test.describe(`public pages @ ${vpName} ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp });

    for (const route of ROUTES) {
      test(`${route}: loads, no overflow, clean console`, async ({ page }) => {
        const seen = collectConsole(page);
        const res = await page.goto(route, { waitUntil: "load" });
        await page.waitForTimeout(600); // let hydration/late console errors surface
        expect(res?.status(), `${route} HTTP status`).toBeLessThan(400);

        const o = await overflowInfo(page);
        expect(o.scrollWidth, `horizontal scroll on ${route} @ ${vpName}; wide elements: ${o.offenders.join(" | ")}`).toBeLessThanOrEqual(o.innerWidth);
        expect(seen.csp, `CSP violations on ${route}`).toEqual([]);
        expect(seen.errors, `console errors on ${route}`).toEqual([]);

        if (route === "/") {
          await expect(page.locator("h1"), "landing page must have exactly one h1").toHaveCount(1);
        }
      });
    }
  });
}

test.describe("tap targets on phone", () => {
  test.use({ viewport: VIEWPORTS.phone });

  for (const route of ["/login", "/signup"]) {
    test(`${route}: links and buttons are tall enough`, async ({ page }) => {
      await page.goto(route);
      const targets = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>("a[href], button, [role=button], input[type=submit]"))
          .map((el) => {
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            return {
              label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40),
              tag: el.tagName.toLowerCase(),
              href: el.getAttribute("href") ?? "",
              h: Math.round(r.height),
              w: Math.round(r.width),
              // inline = a link sitting inside a sentence (WCAG 2.5.8 inline exception)
              inline: el.tagName === "A" && (el.parentElement?.textContent ?? "").trim().length > (el.textContent ?? "").trim().length + 3,
              visible: r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none",
            };
          })
          .filter((t) => t.visible),
      );
      expect(targets.length).toBeGreaterThan(0);
      const under40 = targets.filter((t) => t.h < 40);
      if (under40.length) {
        console.log(`[tap-targets ${route}] under 40px: ` + under40.map((t) => `${t.tag}"${t.label}"${t.href ? "->" + t.href : ""} ${t.w}x${t.h}`).join("; "));
        test.info().annotations.push({ type: "under-40px", description: under40.map((t) => `${t.label} (${t.h}px)`).join(", ") });
      }
      // Known real defects in src/ (not fixed here; see docs/specs/progress/E1-e2e-and-deps.md).
      // Remove an entry when the underlying link is fixed. Anything NEW under 36px fails.
      const KNOWN_SHORT: string[] = [];
      const under36 = targets.filter((t) => t.h < 36 && !t.inline && !KNOWN_SHORT.includes(t.label));
      expect(under36, `tap targets under 36px on ${route}`).toEqual([]);
    });
  }
});

test("password eye toggle flips the input type", async ({ page }) => {
  await page.goto("/login");
  const input = page.locator("#password");
  await expect(input).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(input).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(input).toHaveAttribute("type", "password");
});
