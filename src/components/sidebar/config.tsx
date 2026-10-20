import {
  Home,
  BarChart3,
  Landmark,
  FileText,
  Shield,
  Folder,
  Building2,
  Hammer,
  HandCoins,
  FileBarChart,
  Megaphone,
  UserRound,
  Receipt,
  LifeBuoy,
  UserSearch,
  CreditCard,
  UserCog,
  PiggyBank,
  Scale,
  type LucideIcon,
} from "lucide-react";
import type { AppRole } from "@/lib/access/outside-roles";
import { OWNER_FINANCES_NAV, OWNER_NAV, STAFF_ANNOUNCEMENTS, STAFF_MY_UNIT, type OwnerNavItem } from "@/lib/owner/nav";

export interface NavItemConfig {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Key into the badges map passed to the sidebar: "uncategorized", "repairs" or "announcements". */
  badgeKey?: string;
  /** Other routes that belong to this item, so it stays highlighted there (defaults to its own href). */
  activePrefixes?: string[];
  /** Routes under those prefixes that belong to another item instead (Find a Contractor sits under /repairs). */
  excludePrefixes?: string[];
  /** The one item that should stand out from the rest (the Dashboard). */
  featured?: boolean;
  /** Rendered as data-tour, so the first-login tour can point at it (src/lib/tour/steps.ts). */
  tourId?: string;
}

export interface NavGroupConfig {
  label: string;
  items: NavItemConfig[];
}

/**
 * Icons for the items whose labels and hrefs live as plain data in
 * src/lib/owner/nav.ts (so a test can read them without React).
 */
const OWNER_ICONS: Record<string, LucideIcon> = {
  dashboard: Home,
  "owner-statement": Receipt,
  dues: HandCoins,
  announcements: Megaphone,
  repairs: Hammer,
  budget: BarChart3,
  insurance: Shield,
  "owner-building": LifeBuoy,
  documents: Folder,
  "owner-profile": UserRound,
  "my-unit": UserRound,
  "owner-finances": PiggyBank,
};

function toNavItem(i: OwnerNavItem): NavItemConfig {
  return { href: i.href, label: i.label, icon: OWNER_ICONS[i.tourId] ?? Home, tourId: i.tourId, badgeKey: i.badgeKey };
}

// Presentation only — labels and grouping change here, not the routes
// themselves. See DECISIONS.md and the nav audit that produced this grouping.
export const UNGROUPED_NAV: NavItemConfig[] = [
  { href: "/", label: "Dashboard", icon: Home, featured: true, tourId: "dashboard" },
  toNavItem(STAFF_ANNOUNCEMENTS),
];

export const NAV_GROUPS: NavGroupConfig[] = [
  {
    label: "Finances & Dues",
    items: [
      { href: "/bank-feed", label: "Bank Feed & Transactions", icon: Landmark, badgeKey: "uncategorized", tourId: "bank-feed" },
      { href: "/financial-statements", label: "Financial Statements", icon: FileBarChart, tourId: "financial-statements" },
      { href: "/budget", label: "Budget & Spending", icon: BarChart3, badgeKey: "uncategorized", tourId: "budget" },
      { href: "/dues", label: "HOA Dues", icon: HandCoins, tourId: "dues" },
    ],
  },
  {
    label: "Taxes & Insurance",
    items: [
      { href: "/tax", label: "Taxes", icon: FileText, tourId: "taxes" },
      { href: "/insurance", label: "Insurance", icon: Shield, tourId: "insurance" },
    ],
  },
  {
    label: "Building",
    items: [
      { href: "/building", label: "Building & Owners", icon: Building2, tourId: "building" },
      {
        href: "/repairs",
        label: "Repairs & Upkeep",
        icon: Hammer,
        badgeKey: "repairs",
        tourId: "repairs",
        // The problem, contractor and bill pages live under their old routes.
        activePrefixes: ["/repairs", "/maintenance", "/contractors", "/bills"],
        excludePrefixes: ["/repairs/find"],
      },
      { href: "/repairs/find", label: "Find a Contractor", icon: UserSearch, tourId: "find-contractor" },
      { href: "/documents", label: "Documents", icon: Folder, tourId: "documents" },
      { href: "/access", label: "People & Access", icon: UserCog, tourId: "access" },
    ],
  },
];

// Nothing trails the groups for staff now that Documents sits under Building;
// owners still get their own trailing run (OWNER_TRAILING_NAV).
export const TRAILING_NAV: NavItemConfig[] = [];

/**
 * Walkup's own plan (subscriptions plan 2.9). Board admins only: other board
 * members can open /billing to read the status but it is not in their nav,
 * and owners and the accountant never see billing.
 */
export const BILLING_NAV: NavItemConfig = { href: "/billing", label: "Billing", icon: CreditCard };

/** Staff who also own a unit get this one extra item, after the Dashboard and Announcements. */
export const MY_UNIT_NAV: NavItemConfig[] = [toNavItem(STAFF_MY_UNIT)];

/** What an owner-only person sees (owner-portal-spec 7.1), built from src/lib/owner/nav.ts. */
const OWNER_SECTIONS = OWNER_NAV.map((g) => ({ label: g.label, items: g.items.map(toNavItem) }));
export const OWNER_UNGROUPED_NAV: NavItemConfig[] = OWNER_SECTIONS[0].items;
export const OWNER_NAV_GROUPS: NavGroupConfig[] = OWNER_SECTIONS.slice(1, -1).map((g) => ({ label: g.label ?? "", items: g.items }));
export const OWNER_TRAILING_NAV: NavItemConfig[] = OWNER_SECTIONS[OWNER_SECTIONS.length - 1].items;

/**
 * An owner's navigation with "Finances" added right after Budget, for when a board admin has switched the
 * page on. Leaves the navigation untouched if there is no Budget item to put it after.
 */
export function withOwnerFinances<T extends { groups: NavGroupConfig[] }>(nav: T): T {
  const item = toNavItem(OWNER_FINANCES_NAV);
  let placed = false;
  const groups = nav.groups.map((g) => {
    const at = g.items.findIndex((i) => i.href === "/budget");
    if (placed || at < 0) return g;
    placed = true;
    return { ...g, items: [...g.items.slice(0, at + 1), item, ...g.items.slice(at + 1)] };
  });
  return placed ? { ...nav, groups } : nav;
}

/** Who is looking, for the few labels that depend on it. */
export type NavRole = AppRole;

/**
 * The three outside roles (0080) each get their own small navigation, built only from pages that role can
 * open (src/lib/access/outside-roles.ts OUTSIDE_PATHS, held by a test). Every other page answers
 * "Restricted" or "This part is for the board" for them.
 *
 * A property manager: announcements, the repairs and upkeep they run, the building's units and people
 * (read only, with contact details) and the documents they may read.
 */
export const MANAGER_UNGROUPED_NAV: NavItemConfig[] = [toNavItem(STAFF_ANNOUNCEMENTS)];
export const MANAGER_NAV_GROUPS: NavGroupConfig[] = [
  {
    label: "Building",
    items: [
      {
        href: "/repairs",
        label: "Repairs & Upkeep",
        icon: Hammer,
        badgeKey: "repairs",
        tourId: "repairs",
        activePrefixes: ["/repairs", "/maintenance", "/contractors"],
        excludePrefixes: ["/repairs/find"],
      },
      { href: "/building", label: "Building & Owners", icon: Building2, tourId: "building" },
      { href: "/documents", label: "Documents", icon: Folder, tourId: "documents" },
    ],
  },
];

/** An attorney: the documents the board shared, and the collections standing of the units shared with them. */
export const ATTORNEY_NAV_GROUPS: NavGroupConfig[] = [
  {
    label: "Shared with you",
    items: [
      { href: "/documents", label: "Documents", icon: Folder, tourId: "documents" },
      { href: "/collections", label: "Collections", icon: Scale, tourId: "collections" },
    ],
  },
];

/**
 * An observer: the owner navigation without the "My unit" run (an observer owns nothing unless they also
 * hold the owner role, in which case Home shows it), with Finances after Budget whether or not the board
 * switched the page on for owners.
 */
const OBSERVER_NAV = withOwnerFinances({
  ungrouped: OWNER_UNGROUPED_NAV,
  groups: OWNER_NAV_GROUPS.filter((g) => g.label !== "My unit"),
  trailing: OWNER_TRAILING_NAV,
});

/**
 * "Insurance" for the board and the accountant (the Marketplace is one tab
 * inside it); owners land on the published summary, "Building insurance", as
 * the owner navigation names it.
 */
export function insuranceNavLabel(role: NavRole | null | undefined): string {
  if (role === "owner") return "Building insurance";
  return "Insurance";
}

/** NAV_GROUPS with the role-dependent labels applied. The routes and tour ids never change. */
export function navGroupsFor(role: NavRole | null | undefined): NavGroupConfig[] {
  const boardRole = role === "board_admin" || role === "board_member";
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items
      .filter((i) => boardRole || i.href !== "/repairs/find")
      // People & Access is the board's page.
      .filter((i) => boardRole || i.href !== "/access")
      // The Building & Owners page is the board's; an accountant would only see "Restricted".
      .filter((i) => role !== "accountant" || i.href !== "/building")
      .map((i) => (i.href === "/insurance" ? { ...i, label: insuranceNavLabel(role) } : i)),
  }));
}

/**
 * The three runs of navigation for a viewer: owner-only people get the owner
 * navigation, everyone else the board's. A board member's own unit and
 * Walkup's billing are reached from the Your account page, not the sidebar.
 */
export function navFor(
  role: NavRole | null | undefined,
): { ungrouped: NavItemConfig[]; groups: NavGroupConfig[]; trailing: NavItemConfig[] } {
  if (role === "owner") {
    return { ungrouped: OWNER_UNGROUPED_NAV, groups: OWNER_NAV_GROUPS, trailing: OWNER_TRAILING_NAV };
  }
  if (role === "observer") return OBSERVER_NAV;
  if (role === "property_manager") return { ungrouped: MANAGER_UNGROUPED_NAV, groups: MANAGER_NAV_GROUPS, trailing: [] };
  if (role === "attorney") return { ungrouped: [], groups: ATTORNEY_NAV_GROUPS, trailing: [] };
  return {
    // "My unit" and Billing live in the Your account page (top-right profile button), not here.
    ungrouped: UNGROUPED_NAV,
    groups: navGroupsFor(role),
    trailing: TRAILING_NAV,
  };
}

/** Whether the item is the current page, by its href or any of its activePrefixes. */
export function isNavItemActive(pathname: string, item: Pick<NavItemConfig, "href" | "activePrefixes" | "excludePrefixes">): boolean {
  // Home pages match exactly, so /owner/pay does not light "Home" or "My unit".
  if (item.href === "/" || item.href === "/owner") return pathname === item.href;
  const within = (p: string) => pathname === p || pathname.startsWith(`${p}/`) || pathname.startsWith(`${p}?`);
  if (item.excludePrefixes?.some(within)) return false;
  const prefixes = item.activePrefixes ?? [item.href];
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`) || pathname.startsWith(`${p}?`));
}

/**
 * Pages reachable outside the nav, so the top bar can still name them. Read
 * before the nav items, so a sub-page ("/insurance/policies/…") gets its own
 * name rather than its section's.
 */
const EXTRA_TITLES: { prefix: string; label: string }[] = [
  { prefix: "/owner/statement/", label: "Statement" },
  { prefix: "/owner/finances", label: "Finances" },
  { prefix: "/collections", label: "Collections" },
  { prefix: "/announcements/", label: "Announcement" },
  { prefix: "/building/import", label: "Import" },
  { prefix: "/dues/send", label: "Review emails" },
  { prefix: "/dues/statements", label: "Owner statements" },
  { prefix: "/dues/email", label: "Email from Walkup" },
  { prefix: "/insurance/policies/", label: "Policy" },
  { prefix: "/insurance/import", label: "Import insurance" },
  { prefix: "/insurance/compare", label: "Compare quotes" },
  { prefix: "/insurance/facts", label: "Building facts" },
  { prefix: "/insurance/owner-summary", label: "Owner summary" },
  { prefix: "/insurance/emails/", label: "Email" },
  { prefix: "/insurance/claims/", label: "Claim" },
  { prefix: "/insurance/contacts/", label: "Contact" },
  { prefix: "/insurance/quotes/", label: "Quote" },
  { prefix: "/insurance/sheet", label: "Insurance facts sheet" },
  { prefix: "/repairs/report", label: "Report a problem" },
  { prefix: "/repairs/find", label: "Find a contractor" },
  { prefix: "/repairs/emergency-info", label: "In an emergency" },
  { prefix: "/repairs/upkeep/", label: "Upkeep job" },
  { prefix: "/maintenance/", label: "Problem" },
  { prefix: "/contractors/", label: "Contractor" },
  { prefix: "/ledger", label: "Ledger" },
  { prefix: "/admin", label: "Admin" },
  { prefix: "/billing", label: "Billing" },
  { prefix: "/account", label: "Your account" },
  { prefix: "/login", label: "Sign in" },
  { prefix: "/onboarding", label: "Set up" },
];

/** The current page's name for the slim top bar: a named sub-page first, then the nav item it sits under. */
export function pageTitleFor(pathname: string, role?: NavRole | null): string | null {
  if (pathname === "/") return "Dashboard";
  if (pathname === "/owner") return role === "owner" ? "Home" : "My unit";
  const extra = EXTRA_TITLES.find((e) => pathname.startsWith(e.prefix));
  if (extra) return extra.label;
  const owner = navFor("owner");
  const staff = navFor(role);
  const lists = role === "owner" ? [owner, staff] : [staff, owner];
  const all = lists
    .flatMap((n) => [...n.ungrouped, ...n.groups.flatMap((g) => g.items), ...n.trailing])
    .filter((i) => i.href !== "/" && i.href !== "/owner");
  const hit = all.find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`) || pathname.startsWith(`${i.href}?`));
  return hit?.label ?? null;
}
