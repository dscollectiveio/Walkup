import { test as setup } from "@playwright/test";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { devCreds, signInDevAccount, STATE_PATH } from "./helpers/auth";

setup("sign in as the dev account", async ({ page }) => {
  const { missing } = devCreds();
  // Remove any stale state so the app project skips instead of using it.
  rmSync(STATE_PATH, { force: true });
  setup.skip(missing.length > 0, `Signed-in e2e skipped: missing env ${missing.join(", ")} (set in .env.local)`);
  await signInDevAccount(page);
  mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  await page.context().storageState({ path: STATE_PATH });
});
