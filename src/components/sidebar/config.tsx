import {
  Home,
  AlertTriangle,
  Hourglass,
  Receipt,
  BarChart3,
  Landmark,
  List,
  FileText,
  Users,
  Wrench,
  Shield,
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
  { href: "/maintenance", label: "Problems", icon: AlertTriangle, badgeKey: "problems" },
];

export const NAV_GROUPS: NavGroupConfig[] = [
  {
    label: "Money",
    items: [
      { href: "/delinquency", label: "Who owes", icon: Hourglass },
      { href: "/bills", label: "Bills", icon: Receipt },
      { href: "/budget", label: "Budget", icon: BarChart3 },
      { href: "/bank-feed", label: "Bank feed", icon: Landmark },
      { href: "/ledger", label: "All transactions", icon: List },
    ],
  },
  {
    label: "Taxes",
    items: [
      { href: "/tax", label: "Tax filing", icon: FileText },
      { href: "/1099", label: "1099s", icon: Users },
    ],
  },
  {
    label: "Association",
    items: [
      { href: "/building", label: "Building", icon: Building2 },
      { href: "/contractors", label: "Contractors", icon: Wrench },
      { href: "/insurance", label: "Insurance", icon: Shield },
      { href: "/documents", label: "Document Hub", icon: Folder },
    ],
  },
];
