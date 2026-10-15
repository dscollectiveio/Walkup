import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Restricted } from "@/components/ui";
import { isCoverageType, type CoverageType, type SectionKey } from "@/lib/insurance/coverage";
import { isSectionKey } from "@/lib/insurance/coverage";
import { FIELD_DEFS, rowText } from "@/lib/insurance/fields";
import type { ResolvedField } from "@/lib/insurance/declarations";
import { addMonthsClamped } from "@/lib/insurance/premium";
import { loadInsuranceContext, loadPolicy, loadQuote } from "@/lib/insurance/queries";
import { effectiveSections } from "@/lib/insurance/status";
import { BackLink } from "../../components/page-header";
import { ReviewForm } from "../../components/review-form";
import type { ReviewFormProps } from "../../components/review-types";
import { baseReviewProps, documentFilename, initialMetaFor, listRows, loadReviewSupport, resolvedFromRow } from "../../review-data";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const isUuid = (v: string | undefined): v is string =>
  !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

const blankResolved = (): ResolvedField[] =>
  FIELD_DEFS.map((d) => ({
    key: d.key, status: "blank", value: null, candidates: [], page: null, snippet: null, confidence: null, reason: null, suggested: null,
  }));

/** Mark a field as something Walkup assumed (or needs), with the reason shown under it. */
function flag(resolved: ResolvedField[], key: string, value: string | null, reason: string): ResolvedField[] {
  return resolved.map((r) => (r.key === key ? { ...r, status: "review", value, reason, candidates: [] } : r));
}

function setValue(resolved: ResolvedField[], key: string, value: string | null): ResolvedField[] {
  return resolved.map((r) => (r.key === key ? { ...r, status: value === null ? "blank" : "high", value } : r));
}

/**
 * /insurance/policies/new (§3.1, §9.3.4, §9.4.1, §9.4.2): manual entry, start
 * from a quote (?from_quote), copy last term (?renews), and the AI-off path
 * with an uploaded file linked (?document).
 */
export default async function NewPolicyPage({
  searchParams,
}: {
  searchParams: Promise<{ coverage?: string; from_quote?: string; renews?: string; document?: string; carrier?: string; number?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const ctx = await loadInsuranceContext(supabase);
  if (!ctx || !ctx.isBoard) return <Restricted what="insurance records" />;
  const support = await loadReviewSupport(supabase, ctx);
  const documentId = isUuid(sp.document) ? sp.document : null;
  const filename = await documentFilename(supabase, documentId);
  if (documentId && !filename) notFound();

  let props: ReviewFormProps;

  if (isUuid(sp.from_quote)) {
    // §9.4.2: the quote's figures, checked against the policy the insurer issues.
    const quote = await loadQuote(supabase, sp.from_quote);
    if (!quote) notFound();
    const coverage: CoverageType = isCoverageType(quote.coverage) ? quote.coverage : "other";
    let resolved = resolvedFromRow(quote, "quote");
    const initialMeta = initialMetaFor(resolved, "quote");
    delete initialMeta.policy_type;
    const current = support.replaceable
      .filter((p) => p.coverage === coverage)
      .sort((a, b) => a.endsOn.localeCompare(b.endsOn))[0] ?? null;
    const from = rowText(quote, "covers_from");
    const to = rowText(quote, "covers_to");
    let start = from;
    if (!from && current) {
      start = current.endsOn;
      resolved = flag(resolved, "effective_on", start, "The quote doesn't give a start date. Walkup used the day your current policy ends.");
      initialMeta.effective_on = { source: "quote", candidateIndex: null };
    }
    if (!to && start) {
      resolved = flag(resolved, "expires_on", addMonthsClamped(start, 12), "The quote doesn't give an end date. Walkup assumed 12 months.");
      initialMeta.expires_on = { source: "quote", candidateIndex: null };
    }
    const quoteDoc = quote.document_id;
    props = baseReviewProps(ctx, support, {
      mode: "policy",
      intent: "from_quote",
      coverage,
      includedSections: ((quote.included_sections as string[] | null) ?? []).filter(isSectionKey) as SectionKey[],
      resolved,
      initialMeta,
      lists: listRows(quote),
      documentId: quoteDoc ?? documentId,
      documentFilename: quoteDoc ? await documentFilename(supabase, quoteDoc) : filename,
      defaultReplacesId: current?.id ?? null,
      renewalReminderDays: current?.reminderDays ?? 60,
      acceptedQuoteId: quote.id,
      carrierName: quote.carrier_name,
    });
  } else if (isUuid(sp.renews)) {
    // §9.4.1 "Copy last term and edit": dates shifted and flagged, premium blank.
    const old = await loadPolicy(supabase, sp.renews, ctx.todayIso);
    if (!old) notFound();
    const coverage: CoverageType = isCoverageType(old.coverage) ? old.coverage : "other";
    let resolved = resolvedFromRow(old, "previous_policy");
    const initialMeta = initialMetaFor(resolved, "previous_policy");
    delete initialMeta.policy_type;
    const start = old.effective_to;
    resolved = flag(resolved, "effective_on", start, "Walkup assumed a 12-month term.");
    resolved = flag(resolved, "expires_on", addMonthsClamped(start, 12), "Walkup assumed a 12-month term.");
    resolved = flag(resolved, "annual_premium", null, "Enter the renewal premium. Walkup doesn't carry last year's price forward.");
    resolved = setValue(resolved, "taxes_and_fees", null);
    delete initialMeta.annual_premium;
    delete initialMeta.taxes_and_fees;
    props = baseReviewProps(ctx, support, {
      mode: "policy",
      intent: documentId ? "manual" : "renew_copy",
      coverage,
      includedSections: effectiveSections(old),
      resolved,
      initialMeta,
      lists: { ...listRows(old), premiumBreakdown: [] },
      documentId,
      documentFilename: filename,
      defaultReplacesId: old.id,
      renewalReminderDays: old.renewal_reminder_days,
      carrierName: old.carrier_name,
    });
  } else {
    const coverage: CoverageType = sp.coverage && isCoverageType(sp.coverage) ? sp.coverage : "property";
    let resolved = setValue(blankResolved(), "policy_type", coverage);
    const initialMeta: ReviewFormProps["initialMeta"] = {};
    if (sp.carrier?.trim()) {
      resolved = setValue(resolved, "carrier_name", sp.carrier.trim().slice(0, 200));
      initialMeta.carrier_name = { source: "manual", candidateIndex: null };
    }
    if (sp.number?.trim()) {
      resolved = setValue(resolved, "policy_number", sp.number.trim().slice(0, 100));
      initialMeta.policy_number = { source: "manual", candidateIndex: null };
    }
    props = baseReviewProps(ctx, support, {
      mode: "policy",
      intent: "manual",
      coverage,
      resolved,
      initialMeta,
      documentId,
      documentFilename: filename,
    });
  }

  return (
    <div className="space-y-4">
      <BackLink href="/insurance?view=policies">Insurance</BackLink>
      <ReviewForm {...props} />
    </div>
  );
}
