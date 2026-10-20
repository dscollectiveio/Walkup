/**
 * Roles, their order and the few rules about the three outside roles (property manager, attorney,
 * observer; migrations 0077 and 0080, DECISIONS #43). Pure, with no server or browser imports, so the
 * viewer, the sidebar, the tour, the invite form and the tests all read one definition.
 *
 * The database is the real check on all of this (RLS and the SECURITY DEFINER readers). This file only
 * decides what to show and where to send people.
 */

/** Every role in the app, highest first: the first one a person holds is the one that picks their navigation. */
export const APP_ROLES = [
  "board_admin",
  "board_member",
  "accountant",
  "property_manager",
  "attorney",
  "observer",
  "owner",
] as const;

export type AppRole = (typeof APP_ROLES)[number];

/** People invited from outside the building and the board. Their access always has an end date. */
export const OUTSIDE_ROLES = ["property_manager", "attorney", "observer"] as const;
export type OutsideRole = (typeof OUTSIDE_ROLES)[number];

/** Roles whose access ends by itself unless a board admin renews it: the accountant and the outside roles. */
export const TIMED_ROLES = ["accountant", ...OUTSIDE_ROLES] as const;

/** How long a timed role lasts from the day it is given or renewed. */
export const TIMED_ACCESS_DAYS = 90;

/** An invite for any role but owner expires after this many days (0075). */
export const STAFF_INVITE_DAYS = 3;

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && (APP_ROLES as readonly string[]).includes(value);
}

export function isOutsideRole(value: unknown): value is OutsideRole {
  return typeof value === "string" && (OUTSIDE_ROLES as readonly string[]).includes(value);
}

export function isTimedRole(value: unknown): boolean {
  return typeof value === "string" && (TIMED_ROLES as readonly string[]).includes(value);
}

/** The roles in a list that this app knows, in the order APP_ROLES gives them. Anything else is dropped. */
export function knownRoles(roles: readonly string[]): AppRole[] {
  return APP_ROLES.filter((r) => roles.includes(r));
}

/** The highest role a person holds, or null when none is a role this app knows (the "access ended" case). */
export function topRole(roles: readonly string[]): AppRole | null {
  return knownRoles(roles)[0] ?? null;
}

/**
 * The end date for a role given today: 90 days out for the accountant and the outside roles, null for
 * everyone else. `from` is a yyyy-mm-dd string or a Date; the answer is yyyy-mm-dd.
 */
export function endDateFor(role: string, from: Date | string = new Date()): string | null {
  if (!isTimedRole(role)) return null;
  const d = typeof from === "string" ? new Date(`${from}T00:00:00Z`) : new Date(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate()));
  d.setUTCDate(d.getUTCDate() + TIMED_ACCESS_DAYS);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `today` to `end` (both yyyy-mm-dd); negative once it has passed. */
export function daysUntil(end: string, today: string): number {
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export const ROLE_LABEL: Record<AppRole, string> = {
  board_admin: "Board admin",
  board_member: "Board member",
  accountant: "Accountant",
  property_manager: "Property manager",
  attorney: "Attorney",
  observer: "Observer",
  owner: "Owner",
};

/** One line for the role pickers: what the role is for and how long it lasts. */
export const ROLE_HINT: Record<AppRole, string> = {
  board_admin: "full read/write",
  board_member: "full read, limited write",
  accountant: "financials, expires after 90 days",
  property_manager: "repairs, units and people, read-only elsewhere, expires after 90 days",
  attorney: "only the legal documents you share, expires after 90 days",
  observer: "what an owner sees plus the finances summary, expires after 90 days",
  owner: "read-only, own unit",
};

/** Where a signed-in person lands when they open Walkup's front door ("/"). The board and the accountant have the Dashboard. */
export function homePathFor(top: AppRole | null): string {
  switch (top) {
    case "property_manager":
      return "/repairs";
    case "attorney":
      return "/documents";
    case "board_admin":
    case "board_member":
    case "accountant":
      return "/";
    default:
      return "/owner";
  }
}

/**
 * Pages an outside role can open, as path prefixes, by role. This is the allow-list the tests hold the
 * navigation to: every link in a role's sidebar must sit under one of these, and the pages that answer
 * "Restricted" or "This part is for the board" for the role are everything else. Owner-style pages that
 * every signed-in person reaches (the account, the owner pages) are listed too.
 */
export const OUTSIDE_PATHS: Record<OutsideRole, readonly string[]> = {
  property_manager: ["/announcements", "/repairs", "/maintenance", "/contractors", "/building", "/documents", "/account"],
  attorney: ["/documents", "/collections", "/account"],
  observer: ["/owner", "/announcements", "/repairs", "/maintenance", "/budget", "/insurance", "/documents", "/account"],
};

export function pathAllowedFor(role: OutsideRole, pathname: string): boolean {
  return OUTSIDE_PATHS[role].some((p) => pathname === p || pathname.startsWith(`${p}/`) || pathname.startsWith(`${p}?`));
}

/** The pages to point an outside role at when they land on a page that is not theirs (the owner Home, say). */
export function startLinksFor(role: AppRole | null): { href: string; label: string }[] {
  switch (role) {
    case "property_manager":
      return [
        { href: "/repairs", label: "Repairs & Upkeep" },
        { href: "/building", label: "Building & Owners" },
        { href: "/announcements", label: "Announcements" },
        { href: "/documents", label: "Documents" },
      ];
    case "attorney":
      return [
        { href: "/documents", label: "Documents" },
        { href: "/collections", label: "Collections" },
      ];
    case "observer":
      return [
        { href: "/announcements", label: "Announcements" },
        { href: "/owner/finances", label: "Finances" },
        { href: "/budget", label: "Budget" },
        { href: "/documents", label: "Documents" },
      ];
    default:
      return [];
  }
}
