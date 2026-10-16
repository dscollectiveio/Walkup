import Link from "next/link";
import type { BillingCopy } from "@/lib/billing/copy";

const TONE: Record<BillingCopy["tone"], string> = {
  bad: "border-bad-line bg-bad-tint text-bad-text",
  attention: "border-warning-line bg-warning-tint text-warning-text",
  neutral: "border-info-line bg-info-tint text-info-text",
  good: "border-good-line bg-good-tint text-good-text",
};

/**
 * Walkup's own plan, on the Dashboard, only when it needs the board
 * (lib/billing/copy billingNotice). A board admin gets the button; another
 * board member is told who can act.
 */
export function BillingNotice({ copy, canPay }: { copy: BillingCopy; canPay: boolean }) {
  return (
    <section
      aria-label="Walkup subscription"
      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-5 py-3 ${TONE[copy.tone]}`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold">{copy.headline}</p>
        {copy.detail ? <p className="mt-0.5 text-[13px] opacity-90">{copy.detail}</p> : null}
        {!canPay ? <p className="mt-0.5 text-[12px] opacity-90">A board admin can take care of this on the Billing page.</p> : null}
      </div>
      {canPay && copy.action ? (
        <Link
          href="/billing"
          className="inline-flex min-h-[40px] shrink-0 items-center rounded-md bg-ink px-4 text-[13px] font-medium text-paper hover:bg-ink-mid"
        >
          {copy.action === "manage" ? "Manage billing" : "Choose a plan"}
        </Link>
      ) : null}
    </section>
  );
}
