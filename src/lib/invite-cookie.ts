/**
 * Set when signing up specifically to redeem an invite, so that if
 * confirm-email sends the browser away and back, proxy.ts's onboarding
 * redirect knows to send them to that invite instead of the generic "create a
 * building" page. Cleared once redeemed. A plain shared constant, not
 * exported from login/actions.ts or proxy.ts directly — a "use server" file's
 * exports must all be async server actions, and proxy.ts isn't a server
 * module either, so this lives on its own.
 */
export const PENDING_INVITE_COOKIE = "walkup_pending_invite";
