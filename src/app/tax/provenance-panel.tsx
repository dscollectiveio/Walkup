import { money } from "@/components/ui";

const FIGURE_LABELS: Record<string, string> = {
  exempt_income: "Exempt income (owner fees)",
  nonexempt_income: "Non-exempt income (taxable)",
  gross_income: "Gross income (everything collected)",
  exempt_expenditures: "Exempt expenditures (on the building)",
  total_expenditures: "Total expenditures (everything spent)",
  taxable_income: "Taxable income",
  tax_due: "Estimated tax",
  test_60_pct_ratio: "Rule 1 ratio (60% income test)",
  test_90_pct_ratio: "Rule 2 ratio (90% expenditure test)",
};

const RATIO_KEYS = new Set(["test_60_pct_ratio", "test_90_pct_ratio"]);

export interface ProvenanceRow {
  figure_key: string;
  value: string | null;
  derivation: "sum" | "computed";
  source_journal_line_ids: string[];
  formula_description: string;
}

export interface ResolvedLine {
  date: string;
  label: string;
  amount: string;
}

/**
 * Every number a filing was built from, with the transactions that produced
 * it. Plain <details> — this is read-only, so no client JS is needed to
 * expand it. If no filing has been saved yet, this renders nothing rather
 * than a stale or synthetic figure (CLAUDE.md: never show a computed number
 * without its provenance available).
 */
export function ProvenancePanel({
  rows,
  lineIndex,
}: {
  rows: ProvenanceRow[];
  lineIndex: Map<string, ResolvedLine>;
}) {
  if (rows.length === 0) return null;

  return (
    <details className="mt-3 border-t border-line pt-3">
      <summary className="cursor-pointer text-[13px] text-mute underline-offset-2 hover:underline">
        See what this is made of
      </summary>
      <dl className="mt-3 space-y-3 text-[13px]">
        {rows.map((row) => (
          <div key={row.figure_key}>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="font-medium text-ink">
                {FIGURE_LABELS[row.figure_key] ?? row.figure_key}
              </dt>
              <dd className="figures text-ink">
                {row.value === null
                  ? "n/a"
                  : RATIO_KEYS.has(row.figure_key)
                    ? `${(Number(row.value) * 100).toFixed(2)}%`
                    : money(row.value)}
              </dd>
            </div>
            <p className="mt-0.5 text-[11px] text-mute-soft">{row.formula_description}</p>
            {row.derivation === "sum" && row.source_journal_line_ids.length > 0 ? (
              <ul className="mt-1 space-y-0.5 border-l-2 border-line pl-2">
                {row.source_journal_line_ids.map((id) => {
                  const line = lineIndex.get(id);
                  if (!line) return null;
                  return (
                    <li key={id} className="flex justify-between gap-3 text-[11px] text-mute">
                      <span>
                        {line.date} · {line.label}
                      </span>
                      <span className="figures">{money(line.amount)}</span>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        ))}
      </dl>
    </details>
  );
}
