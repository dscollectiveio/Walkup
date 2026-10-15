import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Restricted } from "@/components/ui";
import { isCoverageType, isSectionKey, type SectionKey } from "@/lib/insurance/coverage";
import { rowText } from "@/lib/insurance/fields";
import { loadInsuranceContext, loadQuote } from "@/lib/insurance/queries";
import { BackLink } from "../../../components/page-header";
import { ReviewForm } from "../../../components/review-form";
import { baseReviewProps, documentFilename, listRows, loadReviewSupport, resolvedFromRow, storedProvenance } from "../../../review-data";

export const dynamic = "force-dynamic";
// saveQuote (insurance-spec §3.1).
export const maxDuration = 300;

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** /insurance/quotes/[id]/edit: the review form in quote mode, prefilled, provenance kept. */
export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const ctx = await loadInsuranceContext(supabase);
  if (!ctx || !ctx.isBoard) return <Restricted what="insurance records" />;
  const quote = await loadQuote(supabase, id);
  if (!quote) notFound();

  const [support, prov] = await Promise.all([loadReviewSupport(supabase, ctx), storedProvenance(supabase, { quoteId: id })]);
  const documentId = quote.document_id ?? prov.documentId;
  const props = baseReviewProps(ctx, support, {
    mode: "quote",
    intent: "edit",
    coverage: isCoverageType(quote.coverage) ? quote.coverage : "other",
    includedSections: ((quote.included_sections as string[] | null) ?? []).filter(isSectionKey) as SectionKey[],
    resolved: resolvedFromRow(quote, "quote"),
    storedProvenance: prov.byField,
    lists: listRows(quote),
    documentId,
    documentFilename: await documentFilename(supabase, documentId),
    quoteId: quote.id,
    quoteRequestId: quote.quote_request_id,
    defaultContactId: quote.contact_id,
    quotedOn: quote.quoted_on,
    validUntil: quote.valid_until,
    notes: rowText(quote, "notes"),
    carrierName: quote.carrier_name,
  });

  return (
    <div className="space-y-4">
      <BackLink href={`/insurance/quotes/${id}`}>Back to the quote</BackLink>
      <ReviewForm {...props} />
    </div>
  );
}
