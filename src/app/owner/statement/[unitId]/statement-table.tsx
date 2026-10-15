import { money } from "@/components/ui";
import { shortDate } from "@/lib/dates";
import { balanceWords, lineAmount, lineSummary, type StatementLine } from "@/lib/owner/statement";

/**
 * The statement as a table from `sm` up and as cards on a phone (no sideways
 * scroll). Server-safe, no client state. Every figure arrives as text from
 * unit_statement(); nothing is added up here.
 */
export function StatementTable({
  lines,
  fromIso,
  toIso,
  todayIso,
  periodLabel,
}: {
  lines: StatementLine[];
  fromIso: string | null;
  toIso: string | null;
  todayIso: string;
  periodLabel: string;
}) {
  const real = lines.filter((l) => l.kind !== "opening");
  const closing = lines.length > 0 ? lines[lines.length - 1].balance : "0.00";
  const closingLabel = `Balance on ${shortDate(toIso ?? todayIso, todayIso)}`;
  const toneClass = (tone: "good" | "neutral") => (tone === "good" ? "text-good-text" : "text-ink");

  return (
    <div>
      {real.length === 0 ? (
        <p className="rounded-xl border border-line bg-paper px-5 py-6 text-center text-[14px] text-mute">
          Nothing happened in this period.
          {fromIso && lines[0]?.kind === "opening" ? (
            <span className="mt-1 block figures text-ink">
              Balance before {shortDate(fromIso, todayIso)}: {balanceWords(lines[0].balance)}
            </span>
          ) : null}
        </p>
      ) : (
        <>
          {/* Desktop and tablet */}
          <div className="hidden overflow-hidden rounded-xl border border-line bg-paper sm:block">
            <table className="w-full text-[13px]">
              <caption className="sr-only">Statement for {periodLabel}: what was charged, what was paid, and the running balance</caption>
              <thead>
                <tr className="border-b border-line bg-fill/50 text-left text-[12px] text-mute">
                  <th scope="col" className="px-4 py-2.5 font-medium">Date</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">What</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Charged</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Paid</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {lines.map((l) => (
                  <tr key={`${l.seq}-${l.kind}`} className={l.kind === "opening" ? "bg-fill/30 text-mute" : ""}>
                    <td className="whitespace-nowrap px-4 py-2.5 align-top">{l.line_date ? shortDate(l.line_date, todayIso) : ""}</td>
                    <td className="px-4 py-2.5 align-top text-ink">
                      {l.kind === "opening" && fromIso ? `Balance before ${shortDate(fromIso, todayIso)}` : l.description}
                    </td>
                    <td className="figures px-4 py-2.5 text-right align-top text-ink">{l.kind === "charge" ? money(l.charge) : ""}</td>
                    <td className={`figures px-4 py-2.5 text-right align-top ${toneClass(lineAmount(l).tone)}`}>
                      {l.kind === "payment" ? money(l.payment) : l.kind === "waiver" || l.kind === "write_off" ? money(l.adjustment) : ""}
                    </td>
                    <td className="figures px-4 py-2.5 text-right align-top text-ink">{money(l.balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line-strong bg-fill/50">
                  <th scope="row" colSpan={4} className="px-4 py-2.5 text-left font-medium text-ink">{closingLabel}</th>
                  <td className="figures px-4 py-2.5 text-right font-bold text-ink">{balanceWords(closing)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Phone */}
          <ul className="space-y-2 sm:hidden" aria-label={`Statement for ${periodLabel}`}>
            {lines.map((l) => (
              <li key={`${l.seq}-${l.kind}`} className="rounded-xl border border-line bg-paper px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 break-words text-[14px] font-medium text-ink">
                    {l.kind === "opening" && fromIso ? `Balance before ${shortDate(fromIso, todayIso)}` : l.description}
                  </span>
                  <span className="shrink-0 text-[12px] text-mute">{l.line_date ? shortDate(l.line_date, todayIso) : ""}</span>
                </div>
                <div className="mt-1 flex items-baseline justify-between gap-3 text-[13px]">
                  <span className={`figures ${toneClass(lineAmount(l).tone)}`}>{lineSummary(l)}</span>
                  <span className="figures text-mute">Balance {money(l.balance)}</span>
                </div>
              </li>
            ))}
            <li className="rounded-xl border border-line-strong bg-fill/50 px-4 py-3">
              <div className="flex items-baseline justify-between gap-3 text-[14px] font-medium text-ink">
                <span>{closingLabel}</span>
                <span className="figures font-bold">{balanceWords(closing)}</span>
              </div>
            </li>
          </ul>
        </>
      )}
    </div>
  );
}
