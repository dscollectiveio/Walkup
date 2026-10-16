import Link from "next/link";
import { Card, money } from "@/components/ui";
import { longDate } from "@/lib/dates";
import type { SummaryResult } from "@/lib/owner/load";
import { moneyAnswer, ownerStanding, type OwnerStanding } from "@/lib/owner/standing";
import { btnPrimary, btnSecondary } from "@/components/repairs/styles";
import { Pill, dtClass, ddClass } from "./shared";

const STANDING: Record<OwnerStanding, { label: string; tone: "good" | "attention" | "bad" | "neutral" }> = {
  behind: { label: "Past due", tone: "bad" },
  due_soon: { label: "Payment due", tone: "attention" },
  current: { label: "Paid up", tone: "good" },
  ahead: { label: "Paid ahead", tone: "good" },
  not_charged: { label: "No charges yet", tone: "neutral" },
};

/**
 * Your units: each unit the person owns, with where it stands today (the same
 * words as the owner portal and the statement, from unit_statement_summary)
 * and the three things an owner does most: read the statement, pay, report.
 */
export function UnitsTab({
  units,
  summaries,
  todayIso,
}: {
  units: { id: string; label: string }[];
  summaries: SummaryResult[];
  todayIso: string;
}) {
  return (
    <>
      {units.map((u, i) => {
        const res = summaries[i];
        const standing = res?.ok ? ownerStanding(res.summary, res.hasHistory, todayIso) : null;
        const answer = res?.ok && standing ? moneyAnswer(res.summary, standing, todayIso) : null;
        const s = res?.ok ? res.summary : null;
        return (
          <Card key={u.id} navy title={u.label} hint="Your dues, from the association's own records.">
            {s && standing && answer ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[20px] font-bold tracking-tight text-ink">{answer.headline}</p>
                  <Pill tone={STANDING[standing].tone}>{STANDING[standing].label}</Pill>
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-mute">{answer.detail}</p>
                <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-3">
                  <div>
                    <dt className={dtClass}>Next payment</dt>
                    <dd className={ddClass}>
                      {s.next_due_on && s.next_due_amount ? `${money(s.next_due_amount)} on ${longDate(s.next_due_on)}` : "Nothing scheduled"}
                    </dd>
                  </div>
                  <div>
                    <dt className={dtClass}>Last payment</dt>
                    <dd className={ddClass}>
                      {s.last_payment_on && s.last_payment_amount ? `${money(s.last_payment_amount)} on ${longDate(s.last_payment_on)}` : "None yet"}
                    </dd>
                  </div>
                  <div>
                    <dt className={dtClass}>Open charges</dt>
                    <dd className={ddClass}>{s.open_charges}</dd>
                  </div>
                </dl>
              </>
            ) : (
              <p className="text-[13px] text-mute">
                {res && !res.ok && res.reason === "error"
                  ? "We couldn't load this unit's balance just now. Reload the page in a minute."
                  : "Nothing to show for this unit yet."}
              </p>
            )}
            <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-5">
              <Link href={`/owner/statement/${u.id}`} className={btnPrimary}>
                See statement
              </Link>
              <Link href="/owner/pay" className={btnSecondary}>
                How to pay
              </Link>
              <Link href="/repairs/report" className={btnSecondary}>
                Report a problem
              </Link>
            </div>
          </Card>
        );
      })}
      <p className="text-[12px] text-mute">
        Walkup never takes payments. You pay the association the way the board has set up, and it shows here once the board records it.{" "}
        <Link href="/owner" className="font-medium text-ink underline underline-offset-2">
          Go to your unit home
        </Link>
        .
      </p>
    </>
  );
}
