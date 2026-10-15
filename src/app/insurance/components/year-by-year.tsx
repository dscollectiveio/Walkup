import Link from "next/link";
import { shortDate } from "@/lib/dates";
import { coverageShort } from "@/lib/insurance/coverage";
import { formatMoney } from "@/lib/insurance/format";

/** insurance_year_over_year with every money and percent column selected as text (§9.2). */
export const YEAR_SELECT =
  "policy_id, coverage, carrier_name, effective_from, effective_to, annual_premium::text, previous_premium::text, change_amount::text, change_percent::text, previous_carrier, quotes_obtained";

export interface YearRow {
  policy_id: string;
  coverage: string;
  carrier_name: string;
  effective_from: string;
  effective_to: string;
  annual_premium: string;
  previous_premium: string | null;
  change_amount: string | null;
  change_percent: string | null;
  previous_carrier: string | null;
  quotes_obtained: number;
}

function Change({ row }: { row: YearRow }) {
  if (row.change_percent === null) return <span className="text-mute-soft">first year</span>;
  const pct = row.change_percent.replace(/\.0$/, "");
  const up = !pct.startsWith("-") && pct !== "0";
  const amount = row.change_amount ? formatMoney(row.change_amount.replace(/^-/, "")) : null;
  return (
    <span className={up ? "text-warning-text" : "text-good-text"}>
      {up ? "+" : ""}
      {pct}%
      {amount ? (
        <span className="ml-1 text-[11px] text-mute-soft">
          ({row.change_amount?.startsWith("-") ? "-" : "+"}
          {amount})
        </span>
      ) : null}
    </span>
  );
}

function Quotes({ n }: { n: number }) {
  return n === 0 ? <span className="text-[11px] text-warning-text">none</span> : <span className="figures text-mute">{n}</span>;
}

/**
 * Each term, what it cost, and whether quotes were gathered before it (§9.2).
 * A table from sm up; stacked on phones (§11.6).
 */
export function YearByYear({ rows, todayIso, showCoverage = true }: { rows: YearRow[]; todayIso: string; showCoverage?: boolean }) {
  return (
    <>
      <ul className="divide-y divide-line sm:hidden">
        {rows.map((h) => (
          <li key={h.policy_id} className="py-3 text-[13px]">
            <Link href={`/insurance/policies/${h.policy_id}`} className="font-medium text-ink underline-offset-2 hover:underline">
              {showCoverage ? `${coverageShort(h.coverage)} · ` : ""}
              {h.carrier_name}
            </Link>
            <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
              <dt className="text-mute">From</dt>
              <dd className="figures text-ink">{shortDate(h.effective_from, todayIso)}</dd>
              <dt className="text-mute">Premium</dt>
              <dd className="figures text-ink">{formatMoney(h.annual_premium)}</dd>
              <dt className="text-mute">Change</dt>
              <dd className="figures">
                <Change row={h} />
              </dd>
              <dt className="text-mute">Quotes got</dt>
              <dd>
                <Quotes n={h.quotes_obtained} />
              </dd>
            </dl>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[36rem] text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-mute">
              {showCoverage ? <th scope="col" className="pb-2 font-medium">Cover</th> : null}
              <th scope="col" className="pb-2 font-medium">From</th>
              <th scope="col" className="pb-2 font-medium">Insurer</th>
              <th scope="col" className="pb-2 text-right font-medium">Premium</th>
              <th scope="col" className="pb-2 text-right font-medium">Change</th>
              <th scope="col" className="pb-2 text-right font-medium">Quotes got</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((h) => (
              <tr key={h.policy_id}>
                {showCoverage ? (
                  <th scope="row" className="py-3 text-left font-normal text-ink">
                    <Link href={`/insurance/policies/${h.policy_id}`} className="underline-offset-2 hover:underline">
                      {coverageShort(h.coverage)}
                    </Link>
                  </th>
                ) : null}
                <td className="figures py-3 text-ink">
                  {showCoverage ? (
                    shortDate(h.effective_from, todayIso)
                  ) : (
                    <Link href={`/insurance/policies/${h.policy_id}`} className="underline-offset-2 hover:underline">
                      {shortDate(h.effective_from, todayIso)}
                    </Link>
                  )}
                </td>
                <td className="py-3 text-ink">
                  {h.carrier_name}
                  {h.previous_carrier && h.previous_carrier !== h.carrier_name ? (
                    <span className="ml-2 text-[11px] text-mute-soft">switched from {h.previous_carrier}</span>
                  ) : null}
                </td>
                <td className="figures py-3 text-right text-ink">{formatMoney(h.annual_premium)}</td>
                <td className="figures py-3 text-right">
                  <Change row={h} />
                </td>
                <td className="py-3 text-right">
                  <Quotes n={h.quotes_obtained} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
