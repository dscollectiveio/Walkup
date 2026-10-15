import { createClient } from "@/lib/supabase/server";
import { Empty, Restricted } from "@/components/ui";
import { coverageShort } from "@/lib/insurance/coverage";
import { rowText } from "@/lib/insurance/fields";
import { loadInsuranceContext, loadPolicies } from "@/lib/insurance/queries";
import { BackLink } from "../../components/page-header";
import { NewClaim } from "./new-claim";

export const dynamic = "force-dynamic";

const isUuid = (v: string | undefined): v is string =>
  !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** /insurance/claims/new?ticket=&policy= (§9.4.3): a new claim, from a repair or the Overview. */
export default async function NewClaimPage({ searchParams }: { searchParams: Promise<{ ticket?: string; policy?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const ctx = await loadInsuranceContext(supabase);
  if (!ctx || !ctx.isBoard) return <Restricted what="insurance records" />;
  const assoc = ctx.association.id;

  const [policies, tickets, ticket] = await Promise.all([
    loadPolicies(supabase, assoc, ctx.todayIso),
    supabase.from("tickets").select("id, reference, title").eq("association_id", assoc).order("opened_on", { ascending: false }).limit(50),
    isUuid(sp.ticket)
      ? supabase.from("tickets").select("id, reference, title").eq("id", sp.ticket).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  // In-force policies first (master first), then the rest that aren't archived.
  const usable = policies
    .filter((p) => p.status !== "archived")
    .sort(
      (a, b) =>
        Number(b.status === "active") - Number(a.status === "active") ||
        Number(b.coverage === "property") - Number(a.coverage === "property") ||
        b.effective_from.localeCompare(a.effective_from),
    );
  const t = (ticket.data ?? null) as { id: string; reference: number; title: string } | null;
  const ticketList = ((tickets.data ?? []) as { id: string; reference: number; title: string }[]).map((x) => ({
    id: x.id,
    label: `#${x.reference} ${x.title}`,
  }));
  if (t && !ticketList.some((x) => x.id === t.id)) ticketList.unshift({ id: t.id, label: `#${t.reference} ${t.title}` });
  const claimsLines: Record<string, { carrier: string; phone: string }> = {};
  for (const p of usable) {
    const phone = rowText(p, "claims_phone");
    if (phone) claimsLines[p.id] = { carrier: p.carrier_name, phone };
  }
  const defaultPolicyId = isUuid(sp.policy) && usable.some((p) => p.id === sp.policy) ? sp.policy : usable[0]?.id ?? null;

  return (
    <div className="space-y-6">
      <BackLink href={t ? `/maintenance/${t.id}` : "/insurance"}>{t ? "Back to the problem" : "Insurance"}</BackLink>
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Record an insurance claim</h1>
        {t ? <p className="mt-1 text-mute">For problem #{t.reference}: {t.title}</p> : null}
      </div>
      {usable.length === 0 ? (
        <Empty>Add the policy first, then record the claim against it.</Empty>
      ) : (
        <NewClaim
          policies={usable.map((p) => ({ id: p.id, label: `${coverageShort(p.coverage)}, ${p.carrier_name}` }))}
          defaultPolicyId={defaultPolicyId}
          tickets={ticketList}
          defaultTicketId={t?.id ?? null}
          defaultDescription={t?.title ?? null}
          claimsLines={claimsLines}
        />
      )}
    </div>
  );
}
