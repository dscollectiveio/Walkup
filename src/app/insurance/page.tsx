import { aiConfigured } from "@/lib/ai/client";
import { createClient } from "@/lib/supabase/server";
import { Restricted } from "@/components/ui";
import { runCoverageCheck } from "@/lib/insurance/coverage-check";
import { stateNameFor } from "@/lib/insurance/market-verify";
import { loadCheckInput, loadInsuranceContext, loadPolicies } from "@/lib/insurance/queries";
import { InsuranceTabs, viewFor } from "./components/insurance-tabs";
import { InsuranceHeader } from "./components/page-header";
import { CheckTab } from "./tabs/check";
import { MarketTab } from "./tabs/market";
import { OverviewTab } from "./tabs/overview";
import { OwnerView } from "./tabs/owner-view";
import { PoliciesTab } from "./tabs/policies";
import { QuotesTab, type QuotesSearch } from "./tabs/quotes";

export const dynamic = "force-dynamic";
// Uploads on Overview start reads; Marketplace search, quote requests and
// composing from a finding call the model (insurance-spec §3.1).
export const maxDuration = 300;

/**
 * /insurance (insurance-spec §3, §9): one page, five tabs. Readers (board and
 * accountant) see the tabs; owners see the owner view; anyone else sees
 * Restricted.
 */
export default async function InsurancePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string } & QuotesSearch>;
}) {
  const sp = await searchParams;
  const view = viewFor(sp.view === "policy" ? "overview" : sp.view);
  const supabase = await createClient();
  const ctx = await loadInsuranceContext(supabase);
  if (!ctx) return <Restricted what="insurance records" />;
  if (!ctx.canRead) {
    if (ctx.isMember) return <OwnerView supabase={supabase} ctx={ctx} />;
    return <Restricted what="insurance records" />;
  }

  const assoc = ctx.association.id;
  const [policies, checkInput, drafts, awaiting] = await Promise.all([
    loadPolicies(supabase, assoc, ctx.todayIso),
    loadCheckInput(supabase, ctx.association, ctx.todayIso),
    supabase.from("insurance_messages").select("id", { count: "exact", head: true }).eq("association_id", assoc).eq("status", "draft"),
    supabase.from("insurance_quote_requests").select("id", { count: "exact", head: true }).eq("association_id", assoc).eq("status", "sent"),
  ]);
  const check = runCoverageCheck(checkInput);
  const stateCode = (ctx.association.state_code ?? "").toUpperCase();
  const stateName = stateCode ? stateNameFor(stateCode) : "your state";
  const aiOn = aiConfigured();
  const inForce = policies.filter((p) => p.status === "active").length;

  const overview = <OverviewTab supabase={supabase} ctx={ctx} policies={policies} check={check} aiOn={aiOn} stateName={stateName} />;
  let body: React.ReactNode;
  switch (view) {
    case "policies":
      body = <PoliciesTab supabase={supabase} ctx={ctx} policies={policies} empty={overview} />;
      break;
    case "check":
      body = <CheckTab supabase={supabase} ctx={ctx} policies={policies} check={check} stateName={stateName} />;
      break;
    case "market":
      body = <MarketTab supabase={supabase} ctx={ctx} policies={policies} check={check} aiOn={aiOn} />;
      break;
    case "quotes":
      body = <QuotesTab supabase={supabase} ctx={ctx} policies={policies} check={check} aiOn={aiOn} sp={sp} />;
      break;
    default:
      body = overview;
  }

  return (
    <div className="space-y-6">
      <InsuranceHeader isBoard={ctx.isBoard} />
      <InsuranceTabs
        active={view}
        badges={{ policies: inForce, gaps: check.counts.gap, quotes: (drafts.count ?? 0) + (awaiting.count ?? 0) }}
      />
      {body}
    </div>
  );
}
