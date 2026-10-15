import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui";
import { EntityDocuments } from "@/app/documents/entity-documents";
import { listLinkedDocuments } from "@/lib/documents/access";
import { SECTION_LABEL, coverageLabel, isCoverageType, isSectionKey, sectionsFor, type SectionKey } from "@/lib/insurance/coverage";
import { fieldsFor, rowText } from "@/lib/insurance/fields";
import { formatMoney, longDate } from "@/lib/insurance/format";
import { perUnitCost } from "@/lib/insurance/premium";
import { loadInsuranceContext, loadPolicies, loadQuote } from "@/lib/insurance/queries";
import { displayValue } from "@/lib/insurance/status";
import { DesktopOpenDetails } from "../../components/desktop-open-details";
import { BackLink } from "../../components/page-header";
import { Provenance } from "../../components/provenance";
import { DeclineQuoteButton, DeleteQuoteButton, RecordChoiceButton, UndeclineButton } from "../../components/quote-buttons";
import { Chip } from "../../components/status-chip";
import { btnGhost } from "../../components/styles";
import { Toast } from "../../components/toast";
import { inForceByCoverage } from "../../quotes-data";
import { premiumVsNow, validityText } from "../../quote-helpers";
import { storedProvenance } from "../../review-data";

export const dynamic = "force-dynamic";
// "Decline" and "Record our choice" run quote actions from here (insurance-spec §3.1).
export const maxDuration = 300;

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** /insurance/quotes/[id] (§3.1): what the quote states, where it came from, and the board's choices. */
export default async function QuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const ctx = await loadInsuranceContext(supabase);
  if (!ctx || !ctx.canRead) notFound();
  const quote = await loadQuote(supabase, id);
  if (!quote) notFound();
  const canEdit = ctx.isBoard;

  const [prov, contact, request, documents, policies] = await Promise.all([
    storedProvenance(supabase, { quoteId: id }),
    quote.contact_id ? supabase.from("insurance_contacts").select("id, name").eq("id", quote.contact_id).maybeSingle() : Promise.resolve({ data: null }),
    quote.quote_request_id
      ? supabase.from("insurance_quote_requests").select("id, sent_at, created_at").eq("id", quote.quote_request_id).maybeSingle()
      : Promise.resolve({ data: null }),
    listLinkedDocuments(supabase, "insurance_quotes", id),
    loadPolicies(supabase, ctx.association.id, ctx.todayIso),
  ]);
  const contactRow = contact.data as { id: string; name: string } | null;
  const requestRow = request.data as { id: string; sent_at: string | null; created_at: string } | null;

  const coverage = isCoverageType(quote.coverage) ? quote.coverage : "other";
  const included = ((quote.included_sections as string[] | null) ?? []).filter(isSectionKey) as SectionKey[];
  const sections = sectionsFor(coverage, included);
  const defs = fieldsFor(coverage, sections, "quote");
  const documentId = quote.document_id ?? prov.documentId;
  const now = inForceByCoverage(policies).get(quote.coverage) ?? null;
  const vs = premiumVsNow(quote.annual_premium, now?.annual_premium ?? null);
  const perUnit = perUnitCost(quote.annual_premium, ctx.unitCount);
  const valid = validityText(quote.valid_until, ctx.todayIso);
  const open = !quote.declined_at && !quote.was_selected;
  const groups = ["basics", "agent", ...sections] as string[];
  const lists = {
    endorsements: (Array.isArray(quote.endorsements) ? quote.endorsements : []) as { form_number: string | null; title: string; page: number | null }[],
    exclusions: (Array.isArray(quote.exclusions) ? quote.exclusions : []) as { title: string; page: number | null }[],
    premium: (Array.isArray(quote.premium_breakdown) ? quote.premium_breakdown : []) as { label: string; amount: string; page: number | null }[],
  };
  const notes = rowText(quote, "notes");

  return (
    <div className="space-y-6">
      <BackLink href="/insurance?view=quotes">Insurance</BackLink>

      <header className="space-y-2">
        <h1 className="text-[20px] font-bold tracking-tight text-ink">{quote.carrier_name}</h1>
        <p className="text-[13px] text-mute">
          {[
            `Quote: ${coverageLabel(quote.coverage)}`,
            contactRow ? `from ${contactRow.name}` : null,
            `received ${longDate(quote.quoted_on)}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {quote.was_selected ? <Chip tone="good">Chosen</Chip> : quote.declined_at ? <Chip tone="neutral">Declined</Chip> : null}
          {valid ? <Chip tone={valid.warning ? "warning" : "neutral"}>{valid.text}</Chip> : null}
        </div>
      </header>

      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          {open ? <RecordChoiceButton quoteId={quote.id} contactName={contactRow?.name ?? null} primary /> : null}
          {open ? <DeclineQuoteButton quoteId={quote.id} carrier={quote.carrier_name} /> : null}
          {quote.declined_at && !quote.was_selected ? <UndeclineButton quoteId={quote.id} /> : null}
          <Link href={`/insurance/quotes/${quote.id}/edit`} className={btnGhost}>
            Edit
          </Link>
          <Link href={`/insurance/compare?coverage=${quote.coverage}`} className={btnGhost}>
            Compare
          </Link>
          {!quote.was_selected && contactRow ? (
            <Link href={`/insurance/emails/new?kind=quote_decline&quote=${quote.id}&contact=${contactRow.id}`} className={btnGhost}>
              Write a thank-you
            </Link>
          ) : null}
          {ctx.isAdmin && !quote.was_selected ? <DeleteQuoteButton quoteId={quote.id} /> : null}
        </div>
      ) : (
        <Link href={`/insurance/compare?coverage=${quote.coverage}`} className={btnGhost}>
          Compare
        </Link>
      )}
      {quote.was_selected ? (
        <p className="text-[13px] text-mute">The board chose this quote. The policy started from it is under Policies.</p>
      ) : null}

      <section aria-label="Premium" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-xl border border-line bg-paper px-4 py-3">
          <div className="text-[11px] text-mute">Premium</div>
          <div className="figures mt-1 text-[18px] text-ink">{formatMoney(quote.annual_premium)} a year</div>
          {vs ? <div className="mt-1 text-[12px] text-mute">{vs}</div> : null}
          <Provenance info={prov.byField.annual_premium ?? null} documentId={prov.byField.annual_premium?.source === "extracted" ? documentId : null} variant="tile" />
        </div>
        {perUnit ? (
          <div className="rounded-xl border border-line bg-paper px-4 py-3">
            <div className="text-[11px] text-mute">Per unit a month</div>
            <div className="figures mt-1 text-[18px] text-ink">{formatMoney(perUnit.perMonth, { cents: true })}</div>
          </div>
        ) : null}
      </section>

      <div className="space-y-3">
        <h2 className="eyebrow text-mute">What the quote states</h2>
        {groups.map((g) => {
          const gd = defs.filter((d) => d.group === g && d.key !== "policy_type");
          if (gd.length === 0) return null;
          return (
            <DesktopOpenDetails key={g} summary={SECTION_LABEL[g as keyof typeof SECTION_LABEL] ?? g}>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {gd.map((d) => {
                  const v = displayValue(d, quote);
                  return (
                    <div key={d.key} className="min-w-0">
                      <dt className="text-[11px] text-mute">{d.label}</dt>
                      <dd className={`text-[13px] ${v === null ? "text-mute-soft" : "figures text-ink"}`}>{v ?? "Not stated"}</dd>
                      {v !== null ? (
                        <Provenance
                          info={prov.byField[d.key] ?? null}
                          documentId={prov.byField[d.key]?.source === "extracted" ? documentId : null}
                          variant="tile"
                        />
                      ) : null}
                    </div>
                  );
                })}
              </dl>
            </DesktopOpenDetails>
          );
        })}
      </div>

      {lists.endorsements.length > 0 ? (
        <Card title="Endorsements">
          <ul className="space-y-1 text-[13px] text-ink">
            {lists.endorsements.map((e, i) => (
              <li key={i}>
                {e.form_number ? <span className="figures text-mute">{e.form_number} </span> : null}
                {e.title}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {lists.exclusions.length > 0 ? (
        <Card title="Exclusions">
          <ul className="space-y-1 text-[13px] text-ink">
            {lists.exclusions.map((e, i) => (
              <li key={i}>{e.title}</li>
            ))}
          </ul>
        </Card>
      ) : null}
      {lists.premium.length > 0 ? (
        <Card title="Premium breakdown">
          <ul className="divide-y divide-line text-[13px]">
            {lists.premium.map((l, i) => (
              <li key={i} className="flex justify-between gap-3 py-2">
                <span className="text-ink">{l.label}</span>
                <span className="figures text-ink">{formatMoney(l.amount, { cents: true })}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card title="About this quote">
        <dl className="space-y-2 text-[13px]">
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-mute">From</dt>
            <dd className="text-ink">
              {contactRow ? (
                <Link href={`/insurance/contacts/${contactRow.id}`} className="underline underline-offset-2">
                  {contactRow.name}
                </Link>
              ) : (
                "Not recorded"
              )}
            </dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-mute">Received</dt>
            <dd className="text-ink">{longDate(quote.quoted_on)}</dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-mute">Valid until</dt>
            <dd className="text-ink">{quote.valid_until ? longDate(quote.valid_until) : "Not stated"}</dd>
          </div>
          {requestRow ? (
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-mute">Answers</dt>
              <dd className="text-ink">
                Your request{requestRow.sent_at ? ` sent ${longDate(requestRow.sent_at)}` : ` of ${longDate(requestRow.created_at)}`}
              </dd>
            </div>
          ) : null}
          {notes ? (
            <div>
              <dt className="text-mute">Notes</dt>
              <dd className="mt-1 whitespace-pre-line text-ink">{notes}</dd>
            </div>
          ) : null}
        </dl>
      </Card>

      <Card title="Documents">
        <EntityDocuments targetTable="insurance_quotes" targetId={id} documents={documents} canWrite={canEdit} />
      </Card>

      <Toast message={sp.saved === "1" ? "Quote saved." : null} />
    </div>
  );
}
