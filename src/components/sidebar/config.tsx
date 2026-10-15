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
  type LucideIcon,
} from "lucide-react";
import { OWNER_NAV, STAFF_ANNOUNCEMENTS, STAFF_MY_UNIT, type OwnerNavItem } from "@/lib/owner/nav";

export interface NavItemConfig {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Key into the badges map passed to the sidebar: "uncategorized", "repairs" or "announcements". */
  badgeKey?: string;
  /** Other routes that belong to this item, so it stays highlighted there (defaults to its own href). */
  activePrefixes?: string[];
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
};

function toNavItem(i: OwnerNavItem): NavItemConfig {
  return { href: i.href, label: i.label, icon: OWNER_ICONS[i.tourId] ?? Home, tourId: i.tourId, badgeKey: i.badgeKey };
}

// Presentation only — labels and grouping change here, not the routes
// themselves. See DECISIONS.md and the nav audit that produced this grouping.
export const UNGROUPED_NAV: NavItemConfig[] = [
  { href: "/", label: "Dashboard", icon: Home, featured: true, tourId: "dashboard" },
];

export const NAV_GROUPS: NavGroupConfig[] = [
  {
    label: "Finances & Dues",
    items: [
      { href: "/bank-feed", label: "Bank Feed & Transactions", icon: Landmark, badgeKey: "uncategorized", tourId: "bank-feed" },
      { href: "/financial-statements", label: "Financial Statements", icon: FileBarChart, tourId: "financial-statements" },
      { href: "/budget", label: "Budget & spending", icon: BarChart3, badgeKey: "uncategorized", tourId: "budget" },
      { href: "/dues", label: "HOA Dues", icon: HandCoins, tourId: "dues" },
    ],
  },
  {
    label: "Taxes & Insurance",
    items: [
      { href: "/tax", label: "Taxes", icon: FileText, tourId: "taxes" },
      { href: "/insurance", label: "Insurance Marketplace", icon: Shield, tourId: "insurance" },
    ],
  },
  {
    label: "Building",
    items: [
      { href: "/building", label: "Building Info", icon: Building2, tourId: "building" },
      toNavItem(STAFF_ANNOUNCEMENTS),
      {
        href: "/repairs",
        label: "Repairs & Upkeep",
        icon: Hammer,
        badgeKey: "repairs",
        tourId: "repairs",
        // The problem, contractor and bill pages live under their old routes.
        activePrefixes: ["/repairs", "/maintenance", "/contractors", "/bills"],
      },
    ],
  },
];

// Rendered after every group, not inside one — Document Hub sits outside the
// Money/Taxes/Building groupings by design.
export const TRAILING_NAV: NavItemConfig[] = [
  { href: "/documents", label: "Document Hub", icon: Folder, tourId: "documents" },
];

/** Staff who also own a unit get this one extra item, after the Dashboard. */
export const MY_UNIT_NAV: NavItemConfig[] = [toNavItem(STAFF_MY_UNIT)];

/** What an owner-only person sees (owner-portal-spec 7.1), built from src/lib/owner/nav.ts. */
const OWNER_SECTIONS = OWNER_NAV.map((g) => ({ label: g.label, items: g.items.map(toNavItem) }));
export const OWNER_UNGROUPED_NAV: NavItemConfig[] = OWNER_SECTIONS[0].items;
export const OWNER_NAV_GROUPS: NavGroupConfig[] = OWNER_SECTIONS.slice(1, -1).map((g) => ({ label: g.label ?? "", items: g.items }));
export const OWNER_TRAILING_NAV: NavItemConfig[] = OWNER_SECTIONS[OWNER_SECTIONS.length - 1].items;

/** Who is looking, for the few labels that depend on it. */
export type NavRole = "board_admin" | "board_member" | "accountant" | "owner";

/**
 * Board roles shop for insurance there, so it's the Marketplace (brief
 * decision 1 allows the word). Owners land on the published summary ("Building
 * insurance", as the owner navigation names it) and the accountant on a
 * read-only view, where it is just Insurance.
 */
export function insuranceNavLabel(role: NavRole | null | undefined): string {
  if (role === "owner") return "Building insurance";
  return role === "accountant" ? "Insurance" : "Insurance Marketplace";
}

/** NAV_GROUPS with the role-dependent labels applied. The routes and tour ids never change. */
export function navGroupsFor(role: NavRole | null | undefined): NavGroupConfig[] {
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.map((i) => (i.href === "/insurance" ? { ...i, label: insuranceNavLabel(role) } : i)),
  }));
}

/**
 * The three runs of navigation for a viewer: owner-only people get the owner
 * navigation, everyone else the board's (plus "My unit" when they own one).
 */
export function navFor(
  role: NavRole | null | undefined,
  opts: { ownsUnit?: boolean } = {},
): { ungrouped: NavItemConfig[]; groups: NavGroupConfig[]; trailing: NavItemConfig[] } {
  if (role === "owner") {
    return { ungrouped: OWNER_UNGROUPED_NAV, groups: OWNER_NAV_GROUPS, trailing: OWNER_TRAILING_NAV };
  }
  return {
    ungrouped: [...UNGROUPED_NAV, ...(opts.ownsUnit ? MY_UNIT_NAV : [])],
    groups: navGroupsFor(role),
    trailing: TRAILING_NAV,
  };
}

/** Whether the item is the current page, by its href or any of its activePrefixes. */
export function isNavItemActive(pathname: string, item: Pick<NavItemConfig, "href" | "activePrefixes">): boolean {
  // Home pages match exactly, so /owner/pay does not light "Home" or "My unit".
  if (item.href === "/" || item.href === "/owner") return pathname === item.href;
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
  { prefix: "/units/", label: "Unit statement" },
  { prefix: "/maintenance/", label: "Problem" },
  { prefix: "/contractors/", label: "Contractor" },
  { prefix: "/ledger", label: "Ledger" },
  { prefix: "/delinquency", label: "Collections" },
  { prefix: "/admin", label: "Admin" },
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
  const staff = navFor(role, { ownsUnit: true });
  const lists = role === "owner" ? [owner, staff] : [staff, owner];
  const all = lists
    .flatMap((n) => [...n.ungrouped, ...n.groups.flatMap((g) => g.items), ...n.trailing])
    .filter((i) => i.href !== "/" && i.href !== "/owner");
  const hit = all.find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`) || pathname.startsWith(`${i.href}?`));
  return hit?.label ?? null;
}
