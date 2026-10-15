import { createClient } from "@/lib/supabase/server";
import { Restricted } from "@/components/ui";
import { coverageShort } from "@/lib/insurance/coverage";
import { runCoverageCheck } from "@/lib/insurance/coverage-check";
import { formatMoney, longDate } from "@/lib/insurance/format";
import { loadCheckInput, loadInsuranceContext, loadPolicies } from "@/lib/insurance/queries";
import { BackLink } from "../../components/page-header";
import { loadContacts, loadQuoteList, loadRequests } from "../../quotes-data";
import { ComposeForm, type ComposeKind } from "./compose-form";

export const dynamic = "force-dynamic";
// composeInsuranceEmail drafts with the model (insurance-spec §3.1).
export const maxDuration = 300;

const isUuid = (v: string | undefined): v is string => !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

const KINDS: ComposeKind[] = [
  "certificate_request", "claim_report", "change_request", "coverage_question", "documents_request", "quote_follow_up", "quote_decline", "other",
];
const CHANGE_KINDS = ["add_coverage", "raise_limit", "change_deductible", "add_additional_insured", "update_address", "other"];

/**
 * /insurance/emails/new (insurance-spec §9.7.1): who and what, then the
 * draft. Query: ?kind=&contact=&policy=&claim=&finding=&request=&quote=
 * &owner_request=&change=&question=own.
 */
export default async function ComposePage({
  searchParams,
}: {
  searchParams: Promise<{
    kind?: string; contact?: string; policy?: string; claim?: string; finding?: string; request?: string;
    quote?: string; owner_request?: string; change?: string; question?: string;
  }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const ctx = await loadInsuranceContext(supabase);
  if (!ctx || !ctx.isBoard) return <Restricted what="insurance emails" />;
  const assoc = ctx.association.id;

  const [contacts, policies, claims, requests, quotes, checkInput, ownerReq] = await Promise.all([
    loadContacts(supabase, assoc),
    loadPolicies(supabase, assoc, ctx.todayIso),
    supabase
      .from("insurance_claims")
      .select("id, policy_id, date_of_loss, description, status")
      .eq("association_id", assoc)
      .order("date_of_loss", { ascending: false })
      .limit(50),
    loadRequests(supabase, assoc),
    loadQuoteList(supabase, assoc),
    loadCheckInput(supabase, ctx.association, ctx.todayIso),
    isUuid(sp.owner_request)
      ? supabase.from("insurance_owner_requests").select("id, note, created_at, status, persons(full_name)").eq("id", sp.owner_request).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const check = runCoverageCheck(checkInput);
  const visible = policies.filter((p) => p.status !== "archived");
  const master = visible
    .filter((p) => p.status === "active" && p.coverage === "property")
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ?? null;
  const policyLabel = (p: (typeof policies)[number]) => `${coverageShort(p.coverage)}, ${p.carrier_name} (ends ${longDate(p.effective_to)})`;

  type OwnerReq = { id: string; note: string | null; created_at: string; status: string; persons: { full_name: string } | { full_name: string }[] | null };
  const or = ownerReq.data as OwnerReq | null;
  const ownerName = or ? (Array.isArray(or.persons) ? or.persons[0]?.full_name : or.persons?.full_name) ?? "An owner" : null;

  const kind: ComposeKind = (KINDS as string[]).includes(sp.kind ?? "") ? (sp.kind as ComposeKind) : "coverage_question";
  const contactId = isUuid(sp.contact) && contacts.some((c) => c.id === sp.contact) ? sp.contact : null;

  return (
    <div className="space-y-4">
      <BackLink href="/insurance?view=quotes">Insurance</BackLink>
      <ComposeForm
        initialKind={kind}
        contacts={contacts.map((c) => ({ id: c.id, name: c.name, email: c.email, isCurrentAgent: c.is_current_agent }))}
        defaultContactId={contactId}
        policies={visible.map((p) => ({ id: p.id, label: policyLabel(p) }))}
        defaultPolicyId={isUuid(sp.policy) && visible.some((p) => p.id === sp.policy) ? sp.policy : null}
        masterPolicyId={master?.id ?? null}
        claims={((claims.data ?? []) as { id: string; date_of_loss: string; description: string; status: string }[]).map((c) => ({
          id: c.id,
          label: `${longDate(c.date_of_loss)}: ${c.description.length > 60 ? `${c.description.slice(0, 60)}…` : c.description}`,
        }))}
        defaultClaimId={isUuid(sp.claim) ? sp.claim : null}
        findings={check.findings
          .filter((f) => !f.dismissed && (f.severity === "gap" || f.severity === "ask"))
          .map((f) => ({ id: f.id, label: f.title, policyId: f.policyId }))}
        defaultFindingId={sp.finding ?? null}
        ownQuestion={sp.question === "own"}
        requests={requests
          .filter((r) => r.status === "sent" && r.sent_at)
          .map((r) => ({ id: r.id, label: `${r.contactName}: ${r.coverages.map(coverageShort).join(", ")} (sent ${longDate(r.sent_at as string)})`, contactId: r.contact_id }))}
        defaultRequestId={isUuid(sp.request) ? sp.request : null}
        quotes={quotes
          .filter((q) => !q.was_selected)
          .map((q) => ({
            id: q.id,
            label: `${q.carrier_name}, ${coverageShort(q.coverage)}, ${formatMoney(q.annual_premium) ?? ""}${q.contactName ? ` (${q.contactName})` : ""}`,
            contactId: q.contact_id,
          }))}
        defaultQuoteId={isUuid(sp.quote) ? sp.quote : null}
        defaultChange={CHANGE_KINDS.includes(sp.change ?? "") ? (sp.change as string) : null}
        ownerRequest={
          or && or.status === "open"
            ? { id: or.id, text: `${ownerName} asked on ${longDate(or.created_at)}${or.note ? `: “${or.note}”` : "."}` }
            : null
        }
      />
    </div>
  );
}
