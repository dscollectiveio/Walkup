// Role-aware navigation as plain data (owner-portal-spec 7.1). The sidebar's
// config.tsx adds icons and badges on top of these; keeping the list here
// means a test can prove an owner never sees the board's pages and that every
// link goes somewhere that exists.

export interface OwnerNavItem {
  href: string;
  label: string;
  tourId: string;
  /** Which count badge the sidebar draws on it. */
  badgeKey?: "repairs" | "announcements";
}

export interface OwnerNavGroup {
  /** null: ungrouped at the top (or trailing at the bottom). */
  label: string | null;
  items: OwnerNavItem[];
}

/** What an owner-only person sees, in order: Home, My unit, Building, then Documents and Your account. */
export const OWNER_NAV: OwnerNavGroup[] = [
  { label: null, items: [{ href: "/owner", label: "Home", tourId: "dashboard" }] },
  {
    label: "My unit",
    items: [
      { href: "/owner/statement", label: "Statement", tourId: "owner-statement" },
      { href: "/owner/pay", label: "How to pay", tourId: "dues" },
    ],
  },
  {
    label: "Building",
    items: [
      { href: "/announcements", label: "Announcements", tourId: "announcements", badgeKey: "announcements" },
      { href: "/repairs", label: "Repairs", tourId: "repairs", badgeKey: "repairs" },
      { href: "/budget", label: "Budget", tourId: "budget" },
      { href: "/insurance", label: "Building insurance", tourId: "insurance" },
      { href: "/owner/building", label: "Your building", tourId: "owner-building" },
    ],
  },
  {
    label: null,
    items: [
      { href: "/documents", label: "Documents", tourId: "documents" },
      { href: "/account", label: "Your account", tourId: "owner-profile" },
    ],
  },
];

/**
 * The owner Finances page (migration 0079). Not part of OWNER_NAV: it is added after Budget only while a board
 * admin has switched the page on, so the default navigation never links to it.
 */
export const OWNER_FINANCES_NAV: OwnerNavItem = { href: "/owner/finances", label: "Finances", tourId: "owner-finances" };

/** The one extra item a board member or accountant gets when they also own a unit. */
export const STAFF_MY_UNIT: OwnerNavItem = { href: "/owner", label: "My unit", tourId: "my-unit" };

/** Announcements sit right under the Dashboard for staff. */
export const STAFF_ANNOUNCEMENTS: OwnerNavItem = {
  href: "/announcements",
  label: "Announcements",
  tourId: "announcements",
  badgeKey: "announcements",
};

export function ownerNavItems(): OwnerNavItem[] {
  return OWNER_NAV.flatMap((g) => g.items);
}
