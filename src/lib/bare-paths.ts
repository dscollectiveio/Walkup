/**
 * Pages that bring their own layout: no sidebar, no top bar. Sign-in, sign-up,
 * the two-step pages and building setup, where the person isn't "in the app"
 * yet. Shared by the root layout (what to fetch) and AppFrame (what to show).
 */
export const BARE_PATHS = ["/login", "/signup", "/forgot-password", "/reset-password", "/account/mfa", "/onboarding", "/unsubscribe", "/features"];

export function isBarePath(pathname: string): boolean {
  return BARE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Whether to draw the page without the app's frame: a bare page, or the landing page when signed out. */
export function isBare(pathname: string, signedIn: boolean): boolean {
  return isBarePath(pathname) || (!signedIn && pathname === "/");
}
