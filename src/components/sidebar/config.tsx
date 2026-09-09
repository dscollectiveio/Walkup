import {
  Home,
  AlertTriangle,
  Hourglass,
  Receipt,
  BarChart3,
  Landmark,
  List,
  FileText,
  Wrench,
  Shield,
  Folder,
  Building2,
  Hammer,
  CalendarClock,
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
      { href: "/delinquency", label: "Who owe the HOA", icon: Hourglass },
      { href: "/bills", label: "Bills", icon: Receipt },
      { href: "/budget", label: "Budget", icon: BarChart3 },
      { href: "/bank-feed", label: "Bank Feed", icon: Landmark },
      { href: "/ledger", label: "All Transactions", icon: List },
    ],
  },
  {
    label: "Taxes & Insurance",
    items: [
      { href: "/tax", label: "Tax Center", icon: FileText },
      { href: "/insurance", label: "Insurance Marketplace", icon: Shield },
    ],
  },
  {
    label: "Building",
    items: [
      { href: "/building", label: "Building Info", icon: Building2 },
      { href: "/repairs", label: "Repairs", icon: Hammer },
      { href: "/upkeep-schedule", label: "Upkeep Schedule", icon: CalendarClock },
      { href: "/contractors", label: "Contractor Directory", icon: Wrench },
    ],
  },
];

// Rendered after every group, not inside one — Document Hub sits outside the
// Money/Taxes/Building groupings by design.
export const TRAILING_NAV: NavItemConfig[] = [
  { href: "/documents", label: "Document Hub", icon: Folder },
];
