import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Restricted } from "@/components/ui";
import { FIELD_DEFS, POLICY_TYPES, resolveAll, type RawField, type ResolvedField } from "@/lib/insurance/declarations";
import type { DeclarationsRead } from "@/lib/documents/pipeline";
import { ReviewForm } from "./review-form";
import { Waiting } from "./waiting";

export const dynamic = "force-dynamic";

const typeLabel = (v: string) => POLICY_TYPES.find((p) => p.value === v)?.label ?? v;

/** A chosen quote's figures become the starting point for a new policy — still reviewed before saving. */
function fromQuote(q: Record<string, unknown>): ResolvedField[] {
  const col: Record<string, unknown> = { ...q, coverage: q.coverage, effective_from: q.covers_from };
  return FIELD_DEFS.map((def) => {
    const v = col[def.column];
    const has = v !== null && v !== undefined && v !== "" && !(def.key === "coverage_form" && v === "unknown");
    return {
      key: def.key,
      status: has ? "high" : "blank",
      value: has ? (def.kind === "money" ? Number(v).toFixed(2) : String(v)) : null,
      candidates: [],
      page: null,
      snippet: null,
      confidence: null,
      reason: null,
    } as ResolvedField;
  });
}

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ documentId: string }>;
  searchParams: Promise<{ mode?: string; request?: string; quote?: string; manual?: string }>;
}) {
  const { documentId } = await params;
  const sp = await searchParams;
  const mode = sp.mode === "quote" ? "quote" : "policy";
  const supabase = await createClient();

  const [{ data: associations }, { data: docs }] = await Promise.all([
    supabase.from("associations").select("id, legal_name").limit(1),
    documentId === "manual"
      ? Promise.resolve({ data: [] as { id: string; filename: string; extraction_state: string; extraction: unknown }[] })
      : supabase.from("documents").select("id, filename, extraction_state, extraction").eq("id", documentId).limit(1),
  ]);
  const association = associations?.[0];
  if (!association) return <Restricted what="insurance records" />;
  const { data: isBoard } = await supabase.rpc("is_board", { assoc: association.id });
  if (isBoard !== true) return <Restricted what="insurance records" />;

  const doc = docs?.[0] ?? null;
  if (documentId !== "manual" && !doc) return <Restricted what="this document" />;

  const { data: current } = await supabase
    .from("insurance_policies")
    .select("id, coverage, carrier_name, effective_to")
    .is("replaced_at", null)
    .gte("effective_to", new Date().toISOString().slice(0, 10));
  const replaceable = (current ?? []).map((p) => ({
    id: p.id,
    coverage: p.coverage,
    label: `${typeLabel(p.coverage)} — ${p.carrier_name}, through ${p.effective_to}`,
  }));

  const manualHref = `/insurance/review/manual?mode=${mode}${sp.request ? `&request=${sp.request}` : ""}`;
  const title = mode === "quote" ? "Review the quote" : sp.quote ? "Start a policy from this quote" : "Review your policy";

  let body: React.ReactNode;
  let resolved: ResolvedField[] | null = null;
  let deductiblesPage: number | null = null;
  let initialSource: "extracted" | "quote" = "extracted";
  let note: string | null = null;

  if (sp.quote) {
    const { data: quotes } = await supabase.from("insurance_quotes").select("*").eq("id", sp.quote).limit(1);
    if (!quotes?.[0]) return <Restricted what="this quote" />;
    resolved = fromQuote(quotes[0] as Record<string, unknown>);
    initialSource = "quote";
    note = "These figures come from the quote. Check them against the policy the insurer issues before relying on them.";
  } else if (!doc) {
    resolved = FIELD_DEFS.map((d) => ({ key: d.key, status: "blank", value: null, candidates: [], page: null, snippet: null, confidence: null, reason: null }));
  } else {
    // The pipeline writes the declarations in the same update that marks the
    // document done, so "not done yet" is the only thing worth waiting for.
    const declarations = (doc.extraction as { declarations?: DeclarationsRead } | null)?.declarations;
    if (["pending", "running"].includes(doc.extraction_state)) {
      body = <Waiting manualHref={manualHref} />;
    } else if (!declarations || declarations.state !== "done") {
      note =
        declarations?.reason ??
        (doc.extraction_state === "skipped" || doc.extraction_state === "failed"
          ? "Walkup couldn't read this file — it may be a scan. Enter the details by hand below."
          : "Walkup didn't read the details from this file. Enter them by hand below.");
      resolved = FIELD_DEFS.map((d) => ({ key: d.key, status: "blank", value: null, candidates: [], page: null, snippet: null, confidence: null, reason: null }));
    } else {
      resolved = resolveAll((declarations.fields ?? []) as RawField[]);
      deductiblesPage =
        resolved.find((r) => ["property_deductible", "wind_hail_deductible"].includes(r.key) && r.page)?.page ?? null;
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href={mode === "quote" ? "/insurance?view=quotes" : "/insurance"} className="text-[13px] text-mute hover:underline">
          ← Insurance
        </Link>
        <h1 className="mt-2 text-[20px] font-bold tracking-tight text-ink">{title}</h1>
        <p className="mt-1 text-mute">
          {doc ? (
            <>
              From{" "}
              <Link href={`/documents/${doc.id}`} className="underline underline-offset-2">
                {doc.filename}
              </Link>
              . Check each figure; anything Walkup wasn&rsquo;t sure of is highlighted.
            </>
          ) : sp.quote ? null : (
            "Enter what's on the declarations page. Leave anything that isn't stated blank."
          )}
        </p>
      </div>
      {note ? <p className="rounded-lg border border-line bg-fill px-4 py-3 text-[13px] text-ink">{note}</p> : null}
      {body ??
        (resolved ? (
          <ReviewForm
            mode={mode}
            documentId={doc?.id ?? null}
            requestId={sp.request ?? null}
            acceptedQuoteId={sp.quote ?? null}
            resolved={resolved}
            initialSource={initialSource}
            legalName={association.legal_name}
            replaceable={replaceable}
            deductiblesPage={deductiblesPage}
          />
        ) : null)}
    </div>
  );
}
