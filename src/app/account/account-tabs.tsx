import Link from "next/link";

/**
 * The Your account tab strip, in the same look as Insurance's. Each tab is its
 * own URL (`?tab=`), so this is a nav of links with aria-current, not an ARIA
 * tablist. On a phone it scrolls sideways in its own strip; the page never does.
 * Which tabs show depends on the person: Your units for owners, Plan and
 * billing for the board.
 */

export type AccountTab = "profile" | "units" | "security" | "billing" | "notifications" | "privacy";

const LABELS: Record<AccountTab, string> = {
  profile: "Profile",
  units: "Your units",
  security: "Sign-in and security",
  billing: "Plan and billing",
  notifications: "Notifications",
  privacy: "Privacy and data",
};

const ORDER: AccountTab[] = ["profile", "units", "security", "billing", "notifications", "privacy"];

/** Older links (`plan`, `preferences`, `data`) still land on the right tab. */
const ALIASES: Record<string, AccountTab> = { plan: "billing", preferences: "notifications", data: "privacy" };

export function visibleTabs(opts: { ownsUnits: boolean; isBoard: boolean }): AccountTab[] {
  return ORDER.filter((t) => (t === "units" ? opts.ownsUnits : t === "billing" ? opts.isBoard : true));
}

/** `?tab=` to a tab this person can see; anything else is the Profile tab. */
export function tabFor(raw: string | undefined, visible: AccountTab[]): AccountTab {
  const key = (raw && (ALIASES[raw] ?? raw)) as AccountTab | undefined;
  return key && visible.includes(key) ? key : "profile";
}

export function accountHref(tab: AccountTab): string {
  return tab === "profile" ? "/account" : `/account?tab=${tab}`;
}

export function AccountTabs({
  active,
  tabs,
  flags = {},
}: {
  active: AccountTab;
  tabs: AccountTab[];
  /** A small dot on a tab that needs attention, with words for screen readers. */
  flags?: Partial<Record<AccountTab, string>>;
}) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <nav aria-label="Account sections" className="inline-flex rounded-full border border-line bg-paper p-0.5">
        {tabs.map((key) => {
          const current = active === key;
          const flag = flags[key];
          return (
            <Link
              key={key}
              href={accountHref(key)}
              aria-current={current ? "page" : undefined}
              className={`inline-flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[13px] font-medium transition-colors duration-300 ${
                current ? "bg-ink text-paper" : "text-mute hover:text-ink"
              }`}
            >
              {LABELS[key]}
              {flag ? (
                <>
                  <span aria-hidden className="h-2 w-2 rounded-full bg-brass" />
                  <span className="sr-only">, {flag}</span>
                </>
              ) : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
