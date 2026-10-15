import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Restricted } from "@/components/ui";
import { isCoverageType } from "@/lib/insurance/coverage";
import { rowText } from "@/lib/insurance/fields";
import { loadInsuranceContext, loadPolicy } from "@/lib/insurance/queries";
import { effectiveSections, legacyValuesOutside } from "@/lib/insurance/status";
import { BackLink } from "../../../components/page-header";
import { ReviewForm } from "../../../components/review-form";
import { baseReviewProps, documentFilename, listRows, loadReviewSupport, resolvedFromRow, storedProvenance } from "../../../review-data";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** /insurance/policies/[id]/edit (§9.3.4 intent "edit"): the review form, prefilled, provenance kept. */
export default async function EditPolicyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const ctx = await loadInsuranceContext(supabase);
  if (!ctx || !ctx.isBoard) return <Restricted what="insurance records" />;
  const policy = await loadPolicy(supabase, id, ctx.todayIso);
  if (!policy) notFound();

  const [support, prov] = await Promise.all([loadReviewSupport(supabase, ctx), storedProvenance(supabase, { policyId: id })]);
  const documentId = rowText(policy, "source_document_id") ?? prov.documentId;
  const props = baseReviewProps(ctx, support, {
    mode: "policy",
    intent: "edit",
    coverage: isCoverageType(policy.coverage) ? policy.coverage : "other",
    includedSections: effectiveSections(policy),
    resolved: resolvedFromRow(policy, "manual"),
    storedProvenance: prov.byField,
    lists: listRows(policy),
    documentId,
    documentFilename: await documentFilename(supabase, documentId),
    policyId: policy.id,
    expectedUpdatedAt: rowText(policy, "updated_at"),
    premiumBill: { exists: support.billByPolicy.has(policy.id), accounts: support.accounts, insuranceAccountId: support.insuranceAccountId },
    renewalReminderDays: policy.renewal_reminder_days,
    notes: rowText(policy, "notes"),
    legacyValues: legacyValuesOutside(policy),
    carrierName: policy.carrier_name,
  });

  return (
    <div className="space-y-4">
      <BackLink href={`/insurance/policies/${id}`}>Back to the policy</BackLink>
      <ReviewForm {...props} />
    </div>
  );
}
