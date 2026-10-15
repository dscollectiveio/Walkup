import Link from "next/link";
import { COVERAGE_TYPES, coverageShort } from "@/lib/insurance/coverage";
import { formatMoney } from "@/lib/insurance/format";
import { DeclineQuoteButton, RecordChoiceButton, UndeclineButton } from "../components/quote-buttons";
import { Chip } from "../components/status-chip";
import type { QuoteListRow } from "../quotes-data";
import { premiumVsNow, validityText } from "../quote-helpers";

/**
 * Quotes received, grouped by coverage (§9.7 item 3): each group links to
 * Compare; each row shows the premium against what the building pays now
 * (neutral words, a fact), how long the quote is good for, and the buttons.
 */

const small = "inline-flex min-h-[44px] items-center justify-center rounded-md border border-line-strong bg-paper px-3 text-[12px] font-medium text-ink hover:bg-fill";

export function QuoteGroups({
  quotes,
  nowPremium,
  canEdit,
  todayIso,
  showContact = true,
}: {
  quotes: QuoteListRow[];
  /** coverage -> the in-force premium (money text). */
  nowPremium: Record<string, string>;
  canEdit: boolean;
  todayIso: string;
  showContact?: boolean;
}) {
  const order = COVERAGE_TYPES.map((c) => c.value as string);
  const coverages = [...new Set(quotes.map((q) => q.coverage))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return (
    <div className="space-y-5">
      {coverages.map((cov) => {
        const rows = quotes.filter((q) => q.coverage === cov);
        return (
          <section key={cov} aria-label={`${coverageShort(cov)} quotes`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[13px] font-medium text-ink">
                {coverageShort(cov)}: {rows.length} {rows.length === 1 ? "quote" : "quotes"}
              </h3>
              <Link href={`/insurance/compare?coverage=${cov}`} className="inline-flex min-h-[44px] items-center text-[13px] font-medium text-ink underline underline-offset-2">
                Compare
              </Link>
            </div>
            <ul className="divide-y divide-line">
              {rows.map((q) => {
                const vs = premiumVsNow(q.annual_premium, nowPremium[q.coverage] ?? null);
                const valid = validityText(q.valid_until, todayIso);
                const open = !q.declined_at && !q.was_selected;
                return (
                  <li key={q.id} className="space-y-2 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 text-[13px]">
                        <Link href={`/insurance/quotes/${q.id}`} className="font-medium text-ink underline-offset-2 hover:underline">
                          {q.carrier_name}
                        </Link>
                        {showContact && q.contactName ? <span className="text-mute"> · {q.contactName}</span> : null}
                        <div className="mt-0.5 text-mute">
                          <span className="figures text-ink">{formatMoney(q.annual_premium)}</span> a year
                          {vs ? <span> · {vs}</span> : null}
                          {valid ? <span className={valid.warning ? "text-warning-text" : undefined}> · {valid.text}</span> : null}
                        </div>
                      </div>
                      {q.was_selected ? <Chip tone="good">Chosen</Chip> : q.declined_at ? <Chip tone="neutral">Declined</Chip> : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {canEdit && open ? (
                        <>
                          <RecordChoiceButton quoteId={q.id} contactName={q.contactName} />
                          <DeclineQuoteButton quoteId={q.id} carrier={q.carrier_name} />
                        </>
                      ) : null}
                      {canEdit && q.declined_at && !q.was_selected ? <UndeclineButton quoteId={q.id} /> : null}
                      <Link href={`/insurance/quotes/${q.id}`} className={small} aria-label={`Open the ${q.carrier_name} quote`}>
                        Open
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
