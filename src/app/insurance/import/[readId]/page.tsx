import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Restricted } from "@/components/ui";
import { OPTIONAL_SECTIONS, SECTION_LABEL, coverageLabel, coverageShort } from "@/lib/insurance/coverage";
import { parseDate, resolveAll } from "@/lib/insurance/declarations";
import { fieldsFor } from "@/lib/insurance/fields";
import { longDate, periodLabel } from "@/lib/insurance/format";
import { loadInsuranceContext, loadPolicies } from "@/lib/insurance/queries";
import { truncatedNote, type StoredPolicy } from "@/lib/insurance/read-schema";
import { BackLink } from "../../components/page-header";
import { Chip } from "../../components/status-chip";
import { btnGhost, btnPrimary } from "../../components/styles";
import { Toast } from "../../components/toast";
import { READ_SELECT, canRetry, effectiveState, itemCounts, itemState, readFilename, type ReadRow } from "../read-state";
import { ItemActions, RereadButton } from "./item-actions";
import { ReadProgress, type ProgressState } from "./read-progress";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** The first candidate of a field, parsed as a date, or null. */
function readDate(item: StoredPolicy, key: string): string | null {
  const f = item.fields.find((x) => x.name === key);
  const c = f?.candidates[0];
  return c ? parseDate(c.value) : null;
}

/** /insurance/import/[readId]: progress, then the policies found in the file (§9.3.2, §9.3.3). */
export default async function ReadPage({
  params,
  searchParams,
}: {
  params: Promise<{ readId: string }>;
  searchParams: Promise<{ update?: string; saved?: string }>;
}) {
  const { readId } = await params;
  const sp = await searchParams;
  if (!isUuid(readId)) notFound();
  const supabase = await createClient();
  const ctx = await loadInsuranceContext(supabase);
  if (!ctx || !ctx.isBoard) return <Restricted what="insurance imports" />;

  const { data } = await supabase.from("insurance_document_reads").select(READ_SELECT).eq("id", readId).maybeSingle();
  const read = (data ?? null) as unknown as ReadRow | null;
  if (!read) notFound();

  const filename = readFilename(read);
  const state = effectiveState(read);
  const update = sp.update && isUuid(sp.update) ? sp.update : null;
  const policies = read.result?.policies ?? [];

  if (state === "done" && policies.length === 1) {
    redirect(`/insurance/import/${readId}/0${update ? `?update=${update}` : ""}`);
  }

  if (state !== "done" || policies.length === 0) {
    let progress: ProgressState;
    if (state === "done") progress = read.result?.documentKind === "not_insurance" ? "not_insurance" : "empty";
    else progress = state;
    // Quota: "Try again" only from the next day (§9.3.2).
    const quotaWait = state === "quota" && !!read.started_at && ctx.todayIso <= read.started_at.slice(0, 10);
    return (
      <div className="space-y-6">
        <BackLink href="/insurance">Insurance</BackLink>
        <ReadProgress
          readId={read.id}
          state={progress}
          filename={filename}
          since={read.started_at ?? read.created_at}
          attempts={read.attempts}
          error={read.error}
          documentId={read.document_id}
          mode={read.mode}
          canRetry={canRetry(read, state) && !quotaWait}
        />
      </div>
    );
  }

  // The package list.
  const all = await loadPolicies(supabase, ctx.association.id, ctx.todayIso);
  const result = read.result!;
  const counts = itemCounts(read);
  const finished = counts.open === 0;
  const isQuote = read.mode === "quote";
  const notes = result.notes?.trim() || "";
  const truncated = truncatedNote(result);

  return (
    <div className="space-y-6">
      <BackLink href="/insurance">Insurance</BackLink>
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">
          Walkup found {policies.length} {isQuote ? "quotes" : "policies"} in {filename}
        </h1>
      </div>

      {notes ? (
        <section className="rounded-lg bg-fill px-4 py-3 text-[13px] text-ink">
          <h2 className="text-[12px] font-medium text-mute">Notes from reading the file</h2>
          <p className="mt-1">&ldquo;{notes}&rdquo;</p>
        </section>
      ) : null}
      {truncated ? <p className="text-[13px] text-ink">{truncated}</p> : null}
      {result.redactedCount > 0 ? (
        <p className="text-[13px] text-mute">
          Walkup removed {result.redactedCount} {result.redactedCount === 1 ? "number that looked like a tax ID" : "numbers that looked like tax IDs"} before saving anything.
        </p>
      ) : null}

      <ul className="space-y-4">
        {policies.map((item, index) => {
          const s = itemState(read, index);
          const defs = fieldsFor(item.coverage, item.sections, read.mode);
          const resolved = resolveAll(item.fields, defs);
          const readCount = resolved.filter((r) => r.status !== "blank").length;
          const toCheck = resolved.filter((r) => r.status === "review").length;
          const from = readDate(item, "effective_on");
          const to = readDate(item, "expires_on");
          const extras = item.sections.filter((x) => (OPTIONAL_SECTIONS[item.coverage] ?? []).includes(x));
          const manualQuery = new URLSearchParams({
            document: read.document_id,
            coverage: item.coverage,
            ...(item.carrierName ? { carrier: item.carrierName } : {}),
            ...(item.policyNumber ? { number: item.policyNumber } : {}),
          }).toString();
          const updateOptions = all
            .filter((p) => p.coverage === item.coverage && (p.status === "active" || p.status === "upcoming" || p.status === "expired"))
            .map((p) => ({ id: p.id, label: `${coverageShort(p.coverage)}, ${p.carrier_name}, ends ${longDate(p.effective_to)}` }));
          return (
            <li key={index} className="rounded-xl border border-line bg-paper px-5 py-4">
              <h2 className="text-[15px] font-bold tracking-tight text-ink">
                {coverageLabel(item.coverage)} · {item.carrierName ?? "Insurer not found"}
              </h2>
              {item.label ? <p className="mt-0.5 text-[12px] text-mute">Described in the file as: {item.label}</p> : null}
              <p className="mt-2 text-[12px] text-mute">
                {[
                  item.policyNumber ?? (isQuote ? "Quote number not found" : "Policy number not found"),
                  from && to ? periodLabel(from, to) : null,
                  item.pages.length ? `Pages ${item.pages.join(", ")}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {extras.length > 0 ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-mute">
                  <span>Also covers:</span>
                  {extras.map((x) => (
                    <Chip key={x} tone="neutral">
                      {SECTION_LABEL[x]}
                    </Chip>
                  ))}
                </div>
              ) : null}
              {item.detailError ? (
                <div className="mt-3 space-y-2">
                  <p className="text-[13px] text-warning-text">Walkup found this policy but couldn&rsquo;t read its details.</p>
                  <div className="flex flex-wrap gap-2">
                    <Link href={`${isQuote ? "/insurance/quotes/new" : "/insurance/policies/new"}?${manualQuery}`} className={btnGhost}>
                      Enter it by hand
                    </Link>
                    {read.attempts < 3 && Object.keys(read.saved ?? {}).length === 0 ? <RereadButton readId={read.id} /> : null}
                  </div>
                </div>
              ) : (
                <>
                  <p className="mt-2 text-[13px] text-ink">
                    {readCount} {readCount === 1 ? "detail" : "details"} read, {toCheck} to check.
                  </p>
                  <div className="mt-3">
                    <ItemActions
                      readId={read.id}
                      index={index}
                      state={s.kind}
                      isQuote={isQuote}
                      savedHref={
                        s.kind === "saved"
                          ? s.policyId
                            ? `/insurance/policies/${s.policyId}`
                            : s.quoteId
                              ? `/insurance/quotes/${s.quoteId}`
                              : null
                          : null
                      }
                      reviewHref={`/insurance/import/${read.id}/${index}${update ? `?update=${update}` : ""}`}
                      updateOptions={updateOptions}
                    />
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>

      <div>
        <Link href={finished ? "/insurance?view=policies" : "/insurance"} className={finished ? btnPrimary : btnGhost}>
          {finished ? "Done" : "Finish later"}
        </Link>
        {!finished ? <p className="mt-2 text-[12px] text-mute">Walkup keeps what it read for 30 days.</p> : null}
      </div>
      <Toast message={sp.saved === "1" ? "Saved." : null} />
    </div>
  );
}
