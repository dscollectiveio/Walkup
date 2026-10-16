import { notFound } from "next/navigation";
import { aiConfigured } from "@/lib/ai/client";
import { createClient } from "@/lib/supabase/server";
import { Card, Restricted } from "@/components/ui";
import { isCoverageType, type CoverageType } from "@/lib/insurance/coverage";
import type { ResolvedField } from "@/lib/insurance/declarations";
import { FIELD_DEFS } from "@/lib/insurance/fields";
import { loadInsuranceContext } from "@/lib/insurance/queries";
import { ImportUploader } from "../../components/insurance-uploader";
import { BackLink } from "../../components/page-header";
import { ReviewForm } from "../../components/review-form";
import { baseReviewProps, documentFilename, loadReviewSupport } from "../../review-data";

export const dynamic = "force-dynamic";
// The quote upload starts a read; saving runs save_insurance_quote (insurance-spec §3.1).
export const maxDuration = 300;

const isUuid = (v: string | undefined): v is string => !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/**
 * /insurance/quotes/new (insurance-spec §3.1, §9.7): enter a quote the board
 * received, by hand, or upload it to be read. Query: ?request= (the request it
 * answers), ?contact= (who sent it), ?coverage=, ?document= (an uploaded file
 * to link, the AI-off path).
 */
export default async function NewQuotePage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string; contact?: string; coverage?: string; document?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const ctx = await loadInsuranceContext(supabase);
  if (!ctx || !ctx.isBoard) return <Restricted what="insurance records" />;
  const support = await loadReviewSupport(supabase, ctx);

  const documentId = isUuid(sp.document) ? sp.document : null;
  const filename = await documentFilename(supabase, documentId);
  if (documentId && !filename) notFound();

  type RequestRef = { id: string; contact_id: string | null; coverages: string[] };
  let request: RequestRef | null = null;
  if (isUuid(sp.request)) {
    const { data } = await supabase.from("insurance_quote_requests").select("id, contact_id, coverages").eq("id", sp.request).maybeSingle();
    if (!data) notFound();
    request = data as RequestRef;
  }
  const coverageRaw = sp.coverage ?? request?.coverages[0] ?? "property";
  const coverage: CoverageType = isCoverageType(coverageRaw) ? coverageRaw : "property";
  const contactId = isUuid(sp.contact) && support.contacts.some((c) => c.id === sp.contact) ? sp.contact : (request?.contact_id ?? null);

  const resolved: ResolvedField[] = FIELD_DEFS.map((d) => ({
    key: d.key,
    status: d.key === "policy_type" ? "high" : "blank",
    value: d.key === "policy_type" ? coverage : null,
    candidates: [],
    page: null,
    snippet: null,
    confidence: null,
    reason: null,
    suggested: null,
  }));
  const props = baseReviewProps(ctx, support, {
    mode: "quote",
    intent: "manual",
    coverage,
    resolved,
    documentId,
    documentFilename: filename,
    quoteRequestId: request?.id ?? null,
    defaultContactId: contactId,
  });

  const aiOn = aiConfigured();
  const manualHref = `/insurance/quotes/new?document={id}${request ? `&request=${request.id}` : ""}${contactId ? `&contact=${contactId}` : ""}&coverage=${coverage}`;

  return (
    <div className="space-y-4">
      <BackLink href="/insurance?view=quotes">Insurance</BackLink>
      {!documentId ? (
        <Card navy title="Have the quote as a file?">
          <div className="space-y-2">
            <p className="text-[13px] text-mute">
              {aiOn
                ? "Upload it and Walkup reads the figures for you to check. Or enter them below."
                : "Upload it to keep it on file with the quote, then enter the figures."}
            </p>
            <ImportUploader aiOn={aiOn} mode="quote" quoteRequestId={request?.id ?? null} manualHref={manualHref} label="Choose the quote" />
          </div>
        </Card>
      ) : null}
      <ReviewForm {...props} />
    </div>
  );
}
