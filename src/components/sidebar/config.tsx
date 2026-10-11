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
  type LucideIcon,
} from "lucide-react";

export interface NavItemConfig {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Key into the badges map passed to the sidebar: currently only "uncategorized". */
  badgeKey?: string;
  /** The one item that should stand out from the rest (the Dashboard). */
  featured?: boolean;
}

export interface NavGroupConfig {
  label: string;
  items: NavItemConfig[];
}

// Presentation only — labels and grouping change here, not the routes
// themselves. See DECISIONS.md and the nav audit that produced this grouping.
export const UNGROUPED_NAV: NavItemConfig[] = [
  { href: "/", label: "Dashboard", icon: Home, featured: true },
];

export const NAV_GROUPS: NavGroupConfig[] = [
  {
    label: "Finances & Dues",
    items: [
      { href: "/bank-feed", label: "Bank Feed & Transactions", icon: Landmark, badgeKey: "uncategorized" },
      { href: "/financial-statements", label: "Financial Statements", icon: FileBarChart },
      { href: "/budget", label: "Budget & spending", icon: BarChart3, badgeKey: "uncategorized" },
      { href: "/dues", label: "HOA Dues", icon: HandCoins },
    ],
  },
  {
    label: "Taxes & Insurance",
    items: [
      { href: "/tax", label: "Taxes", icon: FileText },
      { href: "/insurance", label: "Insurance Marketplace", icon: Shield },
    ],
  },
  {
    label: "Building",
    items: [
      { href: "/building", label: "Building Info", icon: Building2 },
      { href: "/repairs", label: "Repairs & Upkeep", icon: Hammer },
    ],
  },
];

// Rendered after every group, not inside one — Document Hub sits outside the
// Money/Taxes/Building groupings by design.
export const TRAILING_NAV: NavItemConfig[] = [
  { href: "/documents", label: "Document Hub", icon: Folder },
];

/** Pages reachable outside the nav, so the top bar can still name them. */
const EXTRA_TITLES: { prefix: string; label: string }[] = [
  { prefix: "/units/", label: "Unit statement" },
  { prefix: "/maintenance/", label: "Problem" },
  { prefix: "/contractors/", label: "Contractor" },
  { prefix: "/ledger", label: "Ledger" },
  { prefix: "/delinquency", label: "Who owes money" },
  { prefix: "/admin", label: "Admin" },
  { prefix: "/login", label: "Sign in" },
  { prefix: "/onboarding", label: "Set up" },
];

/** The current page's name for the slim top bar, from the nav config first. */
export function pageTitleFor(pathname: string): string | null {
  if (pathname === "/") return "Dashboard";
  const all = [...UNGROUPED_NAV, ...NAV_GROUPS.flatMap((g) => g.items), ...TRAILING_NAV].filter((i) => i.href !== "/");
  const hit = all.find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`) || pathname.startsWith(`${i.href}?`));
  if (hit) return hit.label;
  const extra = EXTRA_TITLES.find((e) => pathname.startsWith(e.prefix));
  return extra?.label ?? null;
}
