import { createClient } from "@/lib/supabase/server";
import { Restricted } from "@/components/ui";
import { coverageShort } from "@/lib/insurance/coverage";
import { periodLabel } from "@/lib/insurance/format";
import { buildOwnerSummaryDraft, type OwnerSummaryContent } from "@/lib/insurance/owner-summary";
import { certificateInstructions } from "@/lib/insurance/owner-summary-text";
import {
  loadFacts, loadInsuranceContext, loadOwnerSummary, loadPolicies, ownerSummaryStalenessFor, stalenessSentence,
} from "@/lib/insurance/queries";
import { CITATIONS } from "@/lib/insurance/statute";
import { BackLink } from "../components/page-header";
import { OwnerSummaryView } from "../components/owner-summary-view";
import { loadContacts } from "../quotes-data";
import { OwnerSummaryEditor, type MasterOption } from "./editor";

export const dynamic = "force-dynamic";

/**
 * /insurance/owner-summary (insurance-spec §9.9, §10.10): the board edits,
 * previews and publishes "what the master policy means for you". Accountants
 * see the published version, read-only.
 */
export default async function OwnerSummaryPage() {
  const supabase = await createClient();
  const ctx = await loadInsuranceContext(supabase);
  if (!ctx || !ctx.canRead) return <Restricted what="the owner summary" />;
  const assoc = ctx.association;
  const [summary, policies, facts, contacts] = await Promise.all([
    loadOwnerSummary(supabase, assoc.id),
    loadPolicies(supabase, assoc.id, ctx.todayIso),
    loadFacts(supabase, assoc.id),
    loadContacts(supabase, assoc.id),
  ]);

  if (!ctx.isBoard) {
    return (
      <div className="space-y-6">
        <BackLink href="/insurance">Insurance</BackLink>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">What owners see</h1>
        {summary?.published ? (
          <OwnerSummaryView content={summary.published} publishedAt={summary.published_at} todayIso={ctx.todayIso} />
        ) : (
          <p className="text-[13px] text-mute">The board hasn&rsquo;t published an owner summary yet.</p>
        )}
      </div>
    );
  }

  const associationName = assoc.legal_name?.trim() || assoc.display_name?.trim() || "The association";
  const masters = policies
    .filter((p) => p.coverage === "property" && (p.status === "active" || p.status === "upcoming"))
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  const currentMaster = masters.find((p) => p.status === "active") ?? masters[0] ?? null;
  const agent = contacts.find((c) => c.is_current_agent) ?? null;

  const staleness = summary?.published ? await ownerSummaryStalenessFor(supabase, summary, ctx.todayIso) : { stale: false as const };
  const staleText = stalenessSentence(staleness);
  const keepSource = summary?.source_policy_id && masters.some((p) => p.id === summary.source_policy_id) && !staleness.stale;
  const defaultMasterId = keepSource ? (summary?.source_policy_id as string) : (currentMaster?.id ?? null);

  // Per candidate master: the parts the editor shows read-only, and Walkup's wording for its coverage form.
  const masterOptions: MasterOption[] = masters.map((p) => {
    const built = buildOwnerSummaryDraft({ associationName, master: p, facts, agent: null });
    return {
      id: p.id,
      label: `${coverageShort(p.coverage)}, ${p.carrier_name}, ${periodLabel(p.effective_from, p.effective_to)}`,
      master: built.master,
      deductibles: built.deductibles,
      claimsLine: built.claims_line,
      leftToOwners: built.left_to_owners,
      tips: built.tips,
    };
  });

  const certificateContacts = contacts.map((c) => {
    const one = buildOwnerSummaryDraft({ associationName, master: null, facts: null, agent: c }).certificate_contact;
    return { id: c.id, name: c.name, contact: one, instructions: certificateInstructions(one) };
  });

  const fresh = buildOwnerSummaryDraft({
    associationName,
    master: masters.find((p) => p.id === defaultMasterId) ?? null,
    facts,
    agent,
  });
  // The saved draft, when there is one; its master parts follow the chosen policy.
  const saved = summary?.draft && summary.draft.version === 1 && (summary.draft.left_to_owners.length || summary.draft.master) ? summary.draft : null;
  const initial: OwnerSummaryContent = saved
    ? {
        ...saved,
        association_name: associationName,
        master: fresh.master,
        deductibles: fresh.deductibles,
        claims_line: fresh.claims_line,
      }
    : fresh;
  const initialContactId =
    certificateContacts.find((c) => c.contact && initial.certificate_contact && c.contact.name === initial.certificate_contact.name)?.id ??
    (initial.certificate_contact ? agent?.id ?? null : null);

  return (
    <div className="space-y-6">
      <BackLink href="/insurance">Insurance</BackLink>
      <OwnerSummaryEditor
        initial={initial}
        published={summary?.published ?? null}
        publishedAt={summary?.published_at ?? null}
        staleText={staleText}
        masters={masterOptions}
        defaultMasterId={defaultMasterId}
        contacts={certificateContacts}
        defaultContactId={initialContactId}
        todayIso={ctx.todayIso}
        illinois={(assoc.state_code ?? "").toUpperCase() === "IL"}
        citation={{ section: CITATIONS.ICPA_22_1_A7.section, url: CITATIONS.ICPA_22_1_A7.url }}
      />
    </div>
  );
}
