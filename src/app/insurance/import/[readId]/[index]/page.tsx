import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Restricted } from "@/components/ui";
import { parseFieldValue, type ResolvedField } from "@/lib/insurance/declarations";
import { FIELD_DEFS, rowText } from "@/lib/insurance/fields";
import { loadInsuranceContext, loadPolicy } from "@/lib/insurance/queries";
import { effectiveSections, legacyValuesOutside } from "@/lib/insurance/status";
import { BackLink } from "../../../components/page-header";
import { ReviewForm } from "../../../components/review-form";
import { btnGhost } from "../../../components/styles";
import {
  baseReviewProps, documentFilename, initialMetaFor, listRows, loadReviewSupport, pagesLabel, readListRows, resolvedFromRead,
  resolvedFromRow, storedProvenance,
} from "../../../review-data";
import { READ_SELECT, effectiveState, itemState, type ReadRow } from "../../read-state";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/**
 * /insurance/import/[readId]/[index] (§9.3.4): review and save one policy or
 * quote found in a file. With ?update={policyId} (§10.7) it edits that policy
 * instead, showing where the read differs from what is saved.
 */
export default async function ReviewItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ readId: string; index: string }>;
  searchParams: Promise<{ update?: string }>;
}) {
  const { readId, index: rawIndex } = await params;
  const sp = await searchParams;
  const index = Number(rawIndex);
  if (!isUuid(readId) || !Number.isInteger(index) || index < 0) notFound();
  const supabase = await createClient();
  const ctx = await loadInsuranceContext(supabase);
  if (!ctx || !ctx.isBoard) return <Restricted what="insurance imports" />;

  const { data } = await supabase.from("insurance_document_reads").select(READ_SELECT).eq("id", readId).maybeSingle();
  const read = (data ?? null) as unknown as ReadRow | null;
  if (!read || effectiveState(read) !== "done") notFound();
  const item = read.result?.policies?.[index];
  if (!item) notFound();

  const isQuote = read.mode === "quote";
  const saved = itemState(read, index);
  const update = !isQuote && sp.update && isUuid(sp.update) ? sp.update : null;

  if (saved.kind === "saved" && !update) {
    const href = saved.policyId ? `/insurance/policies/${saved.policyId}` : `/insurance/quotes/${saved.quoteId}`;
    return (
      <div className="space-y-6">
        <BackLink href={`/insurance/import/${readId}`}>Back to the file</BackLink>
        <p className="text-[15px] text-ink">
          {isQuote ? "This quote was already saved from this file." : "This policy was already saved from this file."}
        </p>
        <Link href={href} className={btnGhost}>
          Open it
        </Link>
      </div>
    );
  }

  const [support, filename] = await Promise.all([loadReviewSupport(supabase, ctx), documentFilename(supabase, read.document_id)]);
  const total = read.result?.policies?.length ?? 0;
  const othersOpen = Array.from({ length: total }, (_, i) => i).some((i) => i !== index && itemState(read, i).kind === "open");
  const returnTo = othersOpen ? `/insurance/import/${readId}` : null;
  const back = total > 1 ? `/insurance/import/${readId}` : "/insurance";

  // Values the outline found but the detail pass didn't report: offered as typed values.
  let resolved: ResolvedField[] = resolvedFromRead(item).map((r) =>
    r.key === "policy_type" ? { ...r, status: "high", value: item.coverage, candidates: [] } : r,
  );
  const initialMeta = initialMetaFor(resolved, "extracted");
  delete initialMeta.policy_type;
  const outlineFill: Record<string, string | null> = { carrier_name: item.carrierName, policy_number: item.policyNumber };
  resolved = resolved.map((r) => {
    const v = outlineFill[r.key];
    if (r.status === "blank" && v) {
      initialMeta[r.key] = { source: "manual", candidateIndex: null };
      return { ...r, status: "high", value: v };
    }
    return r;
  });

  if (update) {
    const policy = await loadPolicy(supabase, update, ctx.todayIso);
    if (!policy || policy.coverage !== item.coverage) notFound();
    const prov = await storedProvenance(supabase, { policyId: policy.id });
    const stored = resolvedFromRow(policy, "manual");
    const readDiffs: Record<string, { value: string; candidateIndex: number; saved: string | null }> = {};
    for (const r of resolved) {
      if (r.key === "policy_type") continue;
      const def = FIELD_DEFS.find((d) => d.key === r.key);
      const cand = r.status === "high" ? r.value : r.status === "review" ? (r.suggested ?? null) : null;
      if (!def || cand === null) continue;
      const savedValue = stored.find((s) => s.key === r.key)?.value ?? null;
      const norm = (v: string | null) => (v === null ? null : (parseFieldValue(def, v) ?? v));
      if (norm(savedValue) !== norm(cand)) readDiffs[r.key] = { value: cand, candidateIndex: 0, saved: savedValue };
    }
    const props = baseReviewProps(ctx, support, {
      mode: "policy",
      intent: "edit",
      coverage: item.coverage,
      includedSections: [...new Set([...effectiveSections(policy), ...item.sections])],
      resolved: stored,
      storedProvenance: prov.byField,
      lists: listRows(policy),
      documentId: read.document_id,
      readId,
      readIndex: index,
      documentFilename: filename,
      policyId: policy.id,
      expectedUpdatedAt: rowText(policy, "updated_at"),
      premiumBill: { exists: support.billByPolicy.has(policy.id), accounts: support.accounts, insuranceAccountId: support.insuranceAccountId },
      policyNumberRedacted: item.policyNumberRedacted,
      renewalReminderDays: policy.renewal_reminder_days,
      notes: rowText(policy, "notes"),
      legacyValues: legacyValuesOutside(policy),
      carrierName: policy.carrier_name,
      readDiffs,
      returnTo,
    });
    return (
      <div className="space-y-4">
        <BackLink href={back}>Back</BackLink>
        <ReviewForm {...props} />
      </div>
    );
  }

  const props = baseReviewProps(ctx, support, {
    mode: isQuote ? "quote" : "policy",
    intent: "import",
    coverage: item.coverage,
    includedSections: item.sections,
    resolved,
    initialMeta,
    lists: readListRows(item),
    documentId: read.document_id,
    readId,
    readIndex: index,
    documentFilename: filename,
    pagesLabel: pagesLabel(item.pages),
    defaultReplacesId:
      read.replaces_policy_id && support.replaceable.some((p) => p.id === read.replaces_policy_id && p.coverage === item.coverage)
        ? read.replaces_policy_id
        : null,
    quoteRequestId: read.quote_request_id,
    policyNumberRedacted: item.policyNumberRedacted,
    quoteMode: isQuote,
    returnTo,
  });

  return (
    <div className="space-y-4">
      <BackLink href={back}>Back</BackLink>
      <ReviewForm {...props} />
    </div>
  );
}
