"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { Mark } from "@/components/mark";
import { NAV_GROUPS, UNGROUPED_NAV, type NavItemConfig } from "./config";

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function NavItemLink({
  item,
  active,
  badgeCount,
}: {
  item: NavItemConfig;
  active: boolean;
  badgeCount?: number;
}) {
  const Icon = item.icon;
  const showBadge = typeof badgeCount === "number" && badgeCount > 0;

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      title={item.label}
      className={`flex items-center justify-center gap-3 border-l-[3px] px-3 py-2 text-[13px] transition-colors min-[900px]:justify-start ${
        active
          ? "border-brass bg-ink-mid font-medium text-paper"
          : "border-transparent text-ondark-mute hover:bg-ink-mid hover:text-paper"
      }`}
    >
      <span className="relative flex shrink-0 items-center justify-center">
        <Icon
          size={16}
          strokeWidth={1.75}
          className={active ? "text-brass" : "text-current"}
          aria-hidden="true"
        />
        {showBadge ? (
          <span
            aria-hidden="true"
            className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-rust px-1 text-[9px] font-medium leading-none text-paper"
          >
            {badgeCount! > 99 ? "99+" : badgeCount}
          </span>
        ) : null}
      </span>
      <span className="sr-only truncate min-[900px]:not-sr-only">{item.label}</span>
      {showBadge ? <span className="sr-only">, {badgeCount} open</span> : null}
    </Link>
  );
}

export function Sidebar({
  associationName,
  problemCount,
  userEmail,
  signOutAction,
}: {
  associationName: string | null;
  problemCount: number;
  userEmail: string;
  signOutAction: () => Promise<void>;
}) {
  const pathname = usePathname();
  const badges = { problems: problemCount };
  const initials = userEmail.slice(0, 2).toUpperCase();

  return (
    <nav
      aria-label="Main"
      className="fixed inset-y-0 left-0 z-20 flex w-14 flex-col bg-ink min-[900px]:w-[232px]"
    >
      <Link
        href="/"
        aria-label="Walkup home"
        className="flex items-center gap-3 px-3 py-4"
      >
        <Mark variant="dark" size={28} className="shrink-0" />
        <span className="hidden min-w-0 flex-col leading-none min-[900px]:flex">
          <span className="text-[14px] font-semibold tracking-[-0.014em] text-paper">
            Walkup
          </span>
          {associationName ? (
            <span className="mt-1 truncate text-[11px] font-normal text-ondark-mute">
              {associationName}
            </span>
          ) : null}
        </span>
      </Link>

      <div className="flex-1 overflow-y-auto px-2 pb-4 min-[900px]:px-3">
        <div className="space-y-0.5">
          {UNGROUPED_NAV.map((item) => (
            <NavItemLink
              key={item.href}
              item={item}
              active={isActive(pathname, item.href)}
              badgeCount={item.badgeKey ? badges[item.badgeKey as keyof typeof badges] : undefined}
            />
          ))}
        </div>

        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mt-4">
            <div className="hidden px-3 pb-1 text-[10px] font-medium uppercase tracking-[0.07em] text-section-label min-[900px]:block">
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavItemLink
                  key={item.href}
                  item={item}
                  active={isActive(pathname, item.href)}
                  badgeCount={item.badgeKey ? badges[item.badgeKey as keyof typeof badges] : undefined}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <form
        action={signOutAction}
        className="flex items-center gap-2.5 border-t border-[var(--color-sidebar-divider)] px-3 py-3"
      >
        <span
          aria-hidden="true"
          className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-slate text-[10px] font-medium text-paper"
        >
          {initials}
        </span>
        <span className="hidden min-w-0 flex-1 truncate text-[12px] text-ondark-mute min-[900px]:inline">
          {userEmail}
        </span>
        <button
          type="submit"
          aria-label="Sign out"
          title="Sign out"
          className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ondark-mute transition-colors hover:bg-ink-mid hover:text-paper"
        >
          <LogOut size={15} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </form>
    </nav>
  );
}
