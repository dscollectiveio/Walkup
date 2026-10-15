import Link from "next/link";
import { Answer } from "@/components/ui";
import { moneyAnswer, ownerStanding, type UnitSummary } from "@/lib/owner/standing";
import { btnPrimary, btnSecondary } from "@/components/repairs/styles";

/**
 * The balance for one unit as the page's headline answer (owner-portal-spec
 * 4.6). `actions="full"` adds the three buttons on the home page; `"none"`
 * leaves them off (the statement page has its own, the pay page is already
 * the pay page).
 */
export function MoneyAnswerCard({
  summary,
  hasEverBeenCharged,
  todayIso,
  actions = "full",
}: {
  summary: UnitSummary;
  hasEverBeenCharged: boolean;
  todayIso: string;
  actions?: "full" | "none";
}) {
  const standing = ownerStanding(summary, hasEverBeenCharged, todayIso);
  const a = moneyAnswer(summary, standing, todayIso);
  return (
    <Answer status={a.status} headline={a.headline} detail={a.detail}>
      {actions === "full" ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Link href={`/owner/statement/${summary.unit_id}`} className={btnPrimary}>
            View statement
          </Link>
          <Link href="/owner/pay" className={btnSecondary}>
            How to pay
          </Link>
          <Link href="/owner/pay#report" className={btnSecondary}>
            I paid another way
          </Link>
        </div>
      ) : null}
    </Answer>
  );
}

/** The answer shown when the balance could not be loaded: never a $0. */
export function MoneyAnswerError() {
  return (
    <Answer
      status="neutral"
      headline="We couldn't load your balance"
      detail="Reload the page. If it keeps happening, tell the board."
    />
  );
}
