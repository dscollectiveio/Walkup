import Link from "next/link";

/**
 * The tab strip (§3.2). Each tab is its own URL, so this is a nav of links
 * with aria-current, not an ARIA tablist. On a phone it scrolls sideways in
 * its own strip; the page never does.
 */

export type InsuranceView = "overview" | "policies" | "check" | "market" | "quotes";

export const INSURANCE_VIEWS: InsuranceView[] = ["overview", "policies", "check", "market", "quotes"];

/** `?view=` to a tab. Legacy keys: `policy` (the old first tab) is the overview. */
export function viewFor(raw: string | undefined): InsuranceView {
  if (raw && (INSURANCE_VIEWS as string[]).includes(raw)) return raw as InsuranceView;
  return "overview";
}

const TABS: { key: InsuranceView; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "policies", label: "Policies" },
  { key: "check", label: "Coverage check" },
  { key: "market", label: "Marketplace" },
  { key: "quotes", label: "Quotes & emails" },
];

export function InsuranceTabs({
  active,
  badges,
}: {
  active: InsuranceView;
  badges: { policies?: number; gaps?: number; quotes?: number };
}) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <nav aria-label="Insurance sections" className="inline-flex rounded-full border border-line bg-paper p-0.5">
        {TABS.map((t) => {
          const current = active === t.key;
          const count = t.key === "policies" ? badges.policies : t.key === "check" ? badges.gaps : t.key === "quotes" ? badges.quotes : undefined;
          const showCount = count !== undefined && count > 0;
          return (
            <Link
              key={t.key}
              href={t.key === "overview" ? "/insurance" : `/insurance?view=${t.key}`}
              aria-current={current ? "page" : undefined}
              className={`inline-flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[13px] font-medium ${
                current ? "bg-ink text-paper" : "text-mute hover:text-ink"
              }`}
            >
              {t.label}
              {showCount ? (
                <span
                  className={`figures inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] ${
                    t.key === "check"
                      ? "bg-bad-tint text-bad-text"
                      : current
                        ? "bg-ink-mid text-paper"
                        : "bg-fill text-mute"
                  }`}
                >
                  {count}
                  <span className="sr-only">{t.key === "check" ? (count === 1 ? " gap" : " gaps") : ""}</span>
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
