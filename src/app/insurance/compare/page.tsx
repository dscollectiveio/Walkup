import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty } from "@/components/ui";
import { chipText, compareRows, type CompareCell } from "@/lib/insurance/compare";
import { COVERAGE_TYPES, coverageLabel, isCoverageType, isSectionKey } from "@/lib/insurance/coverage";
import { fieldsFor, quoteSelect } from "@/lib/insurance/fields";
import { longDate } from "@/lib/insurance/format";
import { loadInsuranceContext, loadPolicies, type QuoteRow } from "@/lib/insurance/queries";
import { effectiveSections } from "@/lib/insurance/status";
import { BackLink, Disclaimer } from "../components/page-header";
import { OpenFileButton } from "../components/provenance";
import { DeclineQuoteButton, RecordChoiceButton } from "../components/quote-buttons";
import { Chip, type ChipTone } from "../components/status-chip";
import { btnGhost, btnPrimary } from "../components/styles";
import { inForceByCoverage } from "../quotes-data";

export const dynamic = "force-dynamic";
// "Decline" runs a quote action from here (insurance-spec §3.1).
export const maxDuration = 300;

/**
 * /insurance/compare?coverage= (insurance-spec §9.10): the policy in force
 * and each quote, side by side, with what differs from now marked in words.
 * It lines up what each document states; it never scores or ranks.
 */

const TONE: Record<NonNullable<CompareCell["tone"]>, ChipTone> = { warning: "warning", good: "good", neutral: "info" };

function CellView({ cell }: { cell: CompareCell }) {
  const chip = chipText(cell);
  // The whole fact for screen readers ("Water deductible: $25,000, higher than now."), so the chip's colour isn't the only signal.
  return (
    <div className="space-y-1">
      {cell.ariaLabel ? <span className="sr-only">{cell.ariaLabel}</span> : null}
      <div aria-hidden={cell.ariaLabel ? true : undefined} className="space-y-1">
        <span className={cell.display === null ? "text-mute-soft" : "figures text-ink"}>{cell.display ?? "Not stated"}</span>
        {chip && cell.tone ? (
          <div>
            <Chip tone={TONE[cell.tone]}>{chip}</Chip>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ coverage?: string; declined?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const ctx = await loadInsuranceContext(supabase);
  if (!ctx || !ctx.canRead) notFound();
  const assoc = ctx.association.id;
  const showDeclined = sp.declined === "1";

  const [policies, allQuotes] = await Promise.all([
    loadPolicies(supabase, assoc, ctx.todayIso),
    supabase.from("insurance_quotes").select(`${quoteSelect()}, insurance_contacts(name)`).eq("association_id", assoc).order("quoted_on", { ascending: false }),
  ]);
  type Q = QuoteRow & { insurance_contacts: { name: string } | { name: string }[] | null };
  const quotesAll = (allQuotes.data ?? []) as unknown as Q[];
  const withQuotes = COVERAGE_TYPES.filter((c) => quotesAll.some((q) => q.coverage === c.value)).map((c) => c.value as string);
  const coverage = sp.coverage && isCoverageType(sp.coverage) ? sp.coverage : (withQuotes[0] ?? "property");
  const label = coverageLabel(coverage);
  const current = inForceByCoverage(policies).get(coverage) ?? null;
  const quotes = quotesAll.filter((q) => q.coverage === coverage && (showDeclined || !q.declined_at));
  const declinedCount = quotesAll.filter((q) => q.coverage === coverage && q.declined_at).length;
  const contactName = (q: Q) => (Array.isArray(q.insurance_contacts) ? q.insurance_contacts[0]?.name : q.insurance_contacts?.name) ?? null;

  const sections = new Set<string>(current ? effectiveSections(current) : []);
  for (const q of quotes) for (const s of ((q.included_sections as string[] | null) ?? []).filter(isSectionKey)) sections.add(s);
  const defs = isCoverageType(coverage) ? fieldsFor(coverage, [...sections], "policy") : [];
  const table = compareRows(current, quotes, defs, ctx.unitCount);
  const canEdit = ctx.isBoard;

  const pills = (
    <nav aria-label="Coverage to compare" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div className="inline-flex rounded-full border border-line bg-paper p-0.5">
        {withQuotes.map((c) => (
          <Link
            key={c}
            href={`/insurance/compare?coverage=${c}${showDeclined ? "&declined=1" : ""}`}
            aria-current={c === coverage ? "page" : undefined}
            className={`inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap rounded-full px-4 text-[13px] font-medium ${c === coverage ? "bg-ink text-paper" : "text-mute hover:text-ink"}`}
          >
            {COVERAGE_TYPES.find((t) => t.value === c)?.short ?? c}
          </Link>
        ))}
      </div>
    </nav>
  );

  return (
    <div className="space-y-6">
      <BackLink href="/insurance?view=quotes">Insurance</BackLink>
      <h1 className="text-[20px] font-bold tracking-tight text-ink">Compare: {label}</h1>
      {withQuotes.length > 1 ? pills : null}

      {quotes.length === 0 ? (
        <Card title={label}>
          <div className="space-y-3">
            <Empty>No quotes for {label.toLowerCase()} yet.</Empty>
            {canEdit ? (
              <div className="flex flex-wrap justify-center gap-2">
                <Link href={`/insurance?view=quotes&new=1&coverage=${coverage}`} className={btnPrimary}>
                  Ask for quotes
                </Link>
                <Link href={`/insurance/quotes/new?coverage=${coverage}`} className={btnGhost}>
                  Add a quote you received
                </Link>
              </div>
            ) : null}
            {declinedCount > 0 && !showDeclined ? (
              <p className="text-center text-[13px]">
                <Link href={`/insurance/compare?coverage=${coverage}&declined=1`} className="underline underline-offset-2">
                  Show declined ({declinedCount})
                </Link>
              </p>
            ) : null}
          </div>
        </Card>
      ) : (
        <>
          {declinedCount > 0 ? (
            <Link
              href={`/insurance/compare?coverage=${coverage}${showDeclined ? "" : "&declined=1"}`}
              className="inline-flex min-h-[44px] items-center text-[13px] text-ink underline underline-offset-2"
            >
              {showDeclined ? "Hide declined" : `Show declined (${declinedCount})`}
            </Link>
          ) : null}

          {/* Desktop: the table. */}
          <div className="hidden overflow-x-auto rounded-xl border border-line bg-paper md:block">
            <table className="w-full text-left text-[13px]">
              <caption className="sr-only">
                {label}: the current policy and {quotes.length} {quotes.length === 1 ? "quote" : "quotes"}
              </caption>
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="px-4 py-3 text-[11px] font-medium text-mute">
                    &nbsp;
                  </th>
                  <th scope="col" className="px-4 py-3 align-bottom">
                    <div className="text-[11px] font-medium text-mute">Now</div>
                    <div className="font-medium text-ink">{current ? current.carrier_name : "No current policy"}</div>
                  </th>
                  {quotes.map((q) => (
                    <th key={q.id} scope="col" className="px-4 py-3 align-bottom">
                      <div className="text-[11px] font-medium text-mute">{contactName(q) ?? "Quote"}</div>
                      <Link href={`/insurance/quotes/${q.id}`} className="font-medium text-ink underline-offset-2 hover:underline">
                        {q.carrier_name}
                      </Link>
                      {q.declined_at ? <div className="mt-1"><Chip tone="neutral">Declined</Chip></div> : null}
                    </th>
                  ))}
                </tr>
              </thead>
              {table.map((s) => (
                <tbody key={s.section} className="border-b border-line">
                  <tr>
                    <th scope="colgroup" colSpan={quotes.length + 2} className="bg-fill/60 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-mute">
                      {s.section}
                    </th>
                  </tr>
                  {s.rows.map((r) => (
                    <tr key={r.key} className="border-t border-line align-top">
                      <th scope="row" className="px-4 py-2 font-normal text-mute">
                        {r.label}
                      </th>
                      {r.cells.map((c, i) => (
                        <td key={i} className="px-4 py-2">
                          <CellView cell={c} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              ))}
              <tfoot>
                <tr className="border-t border-line align-top">
                  <th scope="row" className="px-4 py-3 font-normal text-mute">
                    Valid until
                  </th>
                  <td className="px-4 py-3 text-mute">&nbsp;</td>
                  {quotes.map((q) => (
                    <td key={q.id} className="px-4 py-3 text-ink">
                      {q.valid_until ? longDate(q.valid_until) : <span className="text-mute-soft">Not stated</span>}
                    </td>
                  ))}
                </tr>
                {canEdit ? (
                  <tr className="border-t border-line align-top">
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3" />
                    {quotes.map((q) => (
                      <td key={q.id} className="space-y-2 px-4 py-3">
                        {!q.declined_at && !q.was_selected ? (
                          <div className="flex flex-col items-start gap-2">
                            <RecordChoiceButton quoteId={q.id} contactName={contactName(q)} />
                            <DeclineQuoteButton quoteId={q.id} carrier={q.carrier_name} />
                          </div>
                        ) : null}
                        {q.document_id ? <OpenFileButton documentId={q.document_id} label="Open the quote PDF" /> : null}
                      </td>
                    ))}
                  </tr>
                ) : null}
              </tfoot>
            </table>
          </div>

          {/* Phones: one card per quote, the differences first. */}
          <div className="space-y-4 md:hidden">
            {quotes.map((q, qi) => {
              const rows = table.flatMap((s) => s.rows.map((r) => ({ section: s.section, label: r.label, cell: r.cells[qi + 1], now: r.cells[0] })));
              const changed = rows.filter((r) => chipText(r.cell) !== null && r.cell.change !== "same");
              const rest = rows.filter((r) => !changed.includes(r));
              return (
                <Card key={q.id} title={`${q.carrier_name} vs now`}>
                  <div className="space-y-3 text-[13px]">
                    {current ? null : <p className="text-mute">No current policy to compare with.</p>}
                    {changed.length ? (
                      <dl className="space-y-2">
                        {changed.map((r) => (
                          <div key={`${r.section}-${r.label}`} className="flex justify-between gap-3">
                            <dt className="text-mute">{r.label}</dt>
                            <dd className="text-right">
                              <CellView cell={r.cell} />
                              {r.now.display ? <div className="text-[11px] text-mute">Now {r.now.display}</div> : null}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <p className="text-mute">Nothing stated differs from now.</p>
                    )}
                    <details>
                      <summary className="flex min-h-[44px] cursor-pointer items-center font-medium text-ink">Everything else is the same or not stated</summary>
                      <dl className="space-y-2">
                        {rest.map((r) => (
                          <div key={`${r.section}-${r.label}`} className="flex justify-between gap-3">
                            <dt className="text-mute">{r.label}</dt>
                            <dd className="text-right">
                              <CellView cell={r.cell} />
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                    <p className="text-mute">Valid until {q.valid_until ? longDate(q.valid_until) : "not stated"}</p>
                    {canEdit && !q.declined_at && !q.was_selected ? (
                      <div className="flex flex-wrap gap-2">
                        <RecordChoiceButton quoteId={q.id} contactName={contactName(q)} />
                        <DeclineQuoteButton quoteId={q.id} carrier={q.carrier_name} />
                      </div>
                    ) : null}
                    {q.document_id ? <OpenFileButton documentId={q.document_id} label="Open the quote PDF" /> : null}
                  </div>
                </Card>
              );
            })}
          </div>

          <p className="text-[13px] text-mute">
            Walkup lines up what each quote states. A quote can differ in ways the summary doesn&rsquo;t show, so ask the agent to point out any differences before you choose.
          </p>
        </>
      )}
      <Disclaimer />
    </div>
  );
}
