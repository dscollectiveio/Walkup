import Link from "next/link";
import { Card } from "@/components/ui";
import { btnSecondary } from "@/components/repairs/styles";
import { ROLE_LABEL, startLinksFor, type AppRole } from "@/lib/access/outside-roles";

/**
 * What a property manager, attorney or observer sees on an owner page when they own no unit (0080): a plain
 * line that the page is for owners, and links to the pages that are theirs. Never "no unit is linked to your
 * account", which would send them to ask the board for an owner invite they do not need.
 */
export function OutsideNoUnit({ firstName, associationName, topRole }: { firstName: string; associationName: string; topRole: AppRole | null }) {
  return (
    <Card navy title={`Welcome, ${firstName}`}>
      <p className="text-[14px] text-ink">
        You have {ROLE_LABEL[topRole ?? "owner"].toLowerCase()} access to {associationName}. This page is for unit owners, so there is
        nothing to show here. Your access ends on its own after 90 days unless a board admin renews it.
      </p>
      <ul className="mt-4 flex flex-wrap gap-2">
        {startLinksFor(topRole).map((l) => (
          <li key={l.href}>
            <Link href={l.href} className={btnSecondary}>
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
