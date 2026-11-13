import Link from "next/link";

const TABS = [
  { key: "collections", label: "Collections", href: "/dues" },
  { key: "statements", label: "Owner statements", href: "/dues/statements" },
  { key: "email", label: "Email & reminders", href: "/dues/email" },
] as const;

export type DuesTab = (typeof TABS)[number]["key"];

const PILL_ACTIVE =
  "inline-flex min-h-[44px] items-center rounded-full bg-ink px-3 py-1 sm:min-h-0 text-[12px] font-medium text-paper";
const PILL =
  "inline-flex min-h-[44px] items-center rounded-full border border-line-strong px-3 py-1 sm:min-h-0 text-[12px] text-ink hover:bg-fill";

/** The three board pages under HOA Dues, as pill tabs. The current page is filled. */
export function DuesTabs({ current }: { current: DuesTab }) {
  return (
    <nav aria-label="HOA Dues pages" className="mt-3 flex flex-wrap gap-2">
      {TABS.map((t) => (
        <Link key={t.key} href={t.href} aria-current={t.key === current ? "page" : undefined} className={t.key === current ? PILL_ACTIVE : PILL}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
