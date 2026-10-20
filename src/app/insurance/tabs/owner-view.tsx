import { Card } from "@/components/ui";
import { ownerSummarySchema } from "@/lib/insurance/owner-summary";
import type { InsuranceContext, Supabase } from "@/lib/insurance/queries";
import { OwnerSummaryView } from "../components/owner-summary-view";
import { ProofRequestCard } from "./proof-request-card";

/**
 * The owner view of /insurance (insurance-spec §9.9, §10.11, decision 9).
 * Owners never read insurance_* tables: the page reads only the published
 * summary and the owner's own proof requests, each through its SECURITY
 * DEFINER function. No tabs.
 */
export async function OwnerView({ supabase, ctx, canAsk = true }: { supabase: Supabase; ctx: InsuranceContext; canAsk?: boolean }) {
  const [summaryRes, requestsRes] = await Promise.all([
    supabase.rpc("owner_insurance_summary", { p_association: ctx.association.id }),
    supabase.rpc("my_insurance_proof_requests", { p_association: ctx.association.id }),
  ]);
  const raw = (summaryRes.data ?? null) as Record<string, unknown> | null;
  const parsed = raw ? ownerSummarySchema.safeParse(raw) : null;
  const summary = parsed?.success ? parsed.data : null;
  const publishedAt = typeof raw?.published_at === "string" ? raw.published_at : null;
  const requests = ((requestsRes.data ?? []) as { id: string; kind: string; status: string; created_at: string; handled_at: string | null }[]);
  // The property manager, attorney and observer roles read the summary but do not file requests (0080).
  const ask = canAsk ? <ProofRequestCard requests={requests} todayIso={ctx.todayIso} /> : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Insurance</h1>
        {summary ? (
          <p className="mt-1 text-mute">What the building&rsquo;s master policy covers, and what it leaves for your own condo (HO-6) policy.</p>
        ) : null}
      </div>
      {summary ? (
        <OwnerSummaryView content={summary} publishedAt={publishedAt} todayIso={ctx.todayIso} askCard={ask} />
      ) : (
        <>
          <Card navy title="The building's insurance">
            <p className="text-[13px] text-ink">The board hasn&rsquo;t published an insurance summary yet.</p>
          </Card>
          {ask}
        </>
      )}
    </div>
  );
}
