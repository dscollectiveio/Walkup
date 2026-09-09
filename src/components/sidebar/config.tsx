import {
  Home,
  AlertTriangle,
  BarChart3,
  Landmark,
  List,
  Folder,
  Building2,
  type LucideIcon,
} from "lucide-react";

export interface NavItemConfig {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Key into the badges map passed to the sidebar — currently only "problems". */
  badgeKey?: string;
}

export interface NavGroupConfig {
  label: string;
  items: NavItemConfig[];
}

// Presentation only — labels and grouping change here, not the routes
// themselves. See DECISIONS.md and the nav audit that produced this grouping.
export const UNGROUPED_NAV: NavItemConfig[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/maintenance", label: "Needs Attention", icon: AlertTriangle, badgeKey: "problems" },
];

export const NAV_GROUPS: NavGroupConfig[] = [
  {
    label: "Money In & Money Out",
    items: [
      { href: "/budget", label: "Budget", icon: BarChart3 },
      { href: "/bank-feed", label: "Bank Sync & Transactions", icon: Landmark },
      { href: "/ledger", label: "All Transactions", icon: List },
    ],
  },
  {
    label: "Building",
    items: [{ href: "/building", label: "Building Info", icon: Building2 }],
  },
];

// Rendered after every group, not inside one — Document Hub sits outside the
// Money/Taxes/Building groupings by design.
export const TRAILING_NAV: NavItemConfig[] = [
  { href: "/documents", label: "Document Hub", icon: Folder },
];
