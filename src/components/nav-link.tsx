"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Active state is a 2px Brass rule, not a filled shape — the signature
 * element from WALKUP_BRAND.md section 9, applied to navigation.
 */
export function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`border-b-2 pb-1 text-[12px] font-medium transition-colors ${
        active
          ? "border-brass text-paper"
          : "border-transparent text-ondark-mute hover:text-paper"
      }`}
    >
      {label}
    </Link>
  );
}
