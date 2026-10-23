import Link from "next/link";
import { Answer, Card, Empty, Stat } from "@/components/ui";
import { LINE_KEYS, LINE_LABEL, coverageShort, type LineKey } from "@/lib/insurance/coverage";
import type { Finding, runCoverageCheck } from "@/lib/insurance/coverage-check";
import { FACT_LABEL } from "@/lib/insurance/facts";
import { rowText } from "@/lib/insurance/fields";
import { formatMoney, formatPhone, longDate, telHref } from "@/lib/insurance/format";
import { addMonthsClamped, perUnitCost, premiumTotals } from "@/lib/insurance/premium";
import {
  INSURER_PAYEE_PATTERN, loadInsuranceBanners, loadOwnerSummary, ownerSummaryStalenessFor, stalenessSentence,
  type InsuranceBanner, type InsuranceContext, type PolicyWithStatus, type Supabase,
} from "@/lib/insurance/queries";
import { linesInForce, renewalFor } from "@/lib/insurance/status";
import { fromCents, toCents } from "@/lib/money/cents";
import { ContactCard, type ContactCardContact } from "../components/contact-card";
import { PolicyDocument } from "../components/policy-document";
import { previewKind } from "@/lib/documents/preview";
import { FindingCard } from "../components/finding-card";
import { ImportUploader } from "../components/insurance-uploader";
import { MarkRequestDone } from "../components/mark-request-done";
import { ReadBanners } from "../components/read-banner";
import { btnGhost, btnPrimary, linkClass } from "../components/styles";
import { TrackPremium } from "../track-premium";
import { mailtoLink } from "@/lib/email/mailto";

/**
 * The Overview tab (insurance-spec §9.1): banners, the renewal answer, what
 * the building is covered for, what it costs, the top of the coverage check,
 * the agent, and what owners can see.
 */

type Check = ReturnType<typeof runCoverageCheck>;

const STALE_BANNER_ORDER = ["read:", "owner_requests", "owner_summary", "dup_bills:"];

function bannerRank(b: InsuranceBanner): number {
  const i = STALE_BANNER_ORDER.findIndex((p) => b.key === p || b.key.startsWith(p));
  return i === -1 ? STALE_BANNER_ORDER.length : i;
}

function lineStatus(findings: Finding[], line: LineKey): { dot: string; text: string } | null {
  const on = findings.filter((f) => f.line === line && !f.dismissed);
  if (on.some((f) => f.severity === "gap" && !f.notOnFile)) return { dot: "bg-bad", text: "Gap: see Coverage check" };
  if (on.some((f) => f.notOnFile)) return { dot: "bg-warning", text: "Not on file yet" };
  if (on.some((f) => f.severity === "ask")) return { dot: "bg-warning", text: "Worth asking about" };
  return null;
}

export async function OverviewTab({
  supabase,
  ctx,
  policies,
  check,
  aiOn,
  stateName,
}: {
  supabase: Supabase;
  ctx: InsuranceContext;
  policies: PolicyWithStatus[];
  check: Check;
  aiOn: boolean;
  stateName: string;
}) {
  const assoc = ctx.association.id;
  const today = ctx.todayIso;
  const nonArchived = policies.filter((p) => p.status !== "archived");
  const inForce = nonArchived.filter((p) => p.status === "active");

  const [agentRes, bankRes] = await Promise.all([
    supabase
      .from("insurance_contacts")
      .select("id, name, person_name, kind, email, phone, website_url")
      .eq("association_id", assoc)
      .eq("is_current_agent", true)
      .is("archived_at", null)
      .maybeSingle(),
    ctx.canRead
      ? supabase
          .from("bank_transactions")
          .select("description, posted_on, amount::text")
          .eq("association_id", assoc)
          .lt("amount", 0)
          .gte("posted_on", addMonthsClamped(today, -18))
          .order("posted_on", { ascending: false })
          .limit(500)
      : Promise.resolve({ data: [] }),
  ]);
  let agent = (agentRes.data ?? null) as ContactCardContact | null;
  const master = inForce
    .filter((p) => p.coverage === "property")
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ?? null;
  if (!agent && master && rowText(master, "agent_contact_id")) {
    const { data } = await supabase
      .from("insurance_contacts")
      .select("id, name, person_name, kind, email, phone, website_url")
      .eq("id", rowText(master, "agent_contact_id") as string)
      .maybeSingle();
    agent = (data ?? null) as ContactCardContact | null;
  }

  // -------------------------------------------------------------------------
  // Empty state: no policies at all.
  if (nonArchived.length === 0 && policies.length === 0) {
    if (!ctx.isBoard) {
      return (
        <Card navy title="Policies">
          <Empty>No policies are recorded yet. A board member can add them.</Empty>
        </Card>
      );
    }
    const hint = !agent
      ? ((bankRes.data ?? []) as { description: string; posted_on: string }[]).find((t) => INSURER_PAYEE_PATTERN.test(t.description)) ?? null
      : null;
    return (
      <div className="space-y-6">
        <Card navy title="Start with your declarations page">
          <div className="max-w-2xl space-y-4">
            <p className="text-[13px] text-ink">
              {aiOn
                ? "Upload the declarations page from each policy (master, liability, D&O, and any others). Walkup reads the limits, deductibles and dates, and you check them before anything is saved."
                : "Upload your declarations page to keep it on file, then enter the key figures. It takes about 5 minutes."}
            </p>
            <ImportUploader aiOn={aiOn} />
            <p className="text-[12px] text-mute">
              Which pages? The declarations page is usually the first 1 to 3 pages. A whole renewal package works too: Walkup finds each
              policy in it. Taking photos? Add every page of the declarations in one go.
            </p>
            <div className="flex flex-col gap-2 text-[13px]">
              <Link
                href={agent ? `/insurance/emails/new?kind=documents_request&contact=${agent.id}` : "/insurance/emails/new?kind=documents_request"}
                className={linkClass}
              >
                Don&rsquo;t have them? Ask your agent to send them.
              </Link>
              {hint ? (
                <p className="text-mute">
                  Your books show a payment to &ldquo;{hint.description}&rdquo; on {longDate(hint.posted_on)}. That may be your insurer.
                </p>
              ) : null}
              <Link href="/insurance/policies/new" className={linkClass}>
                Or enter a policy by hand
              </Link>
            </div>
          </div>
        </Card>
        <Card navy title="While you're here">
          <p className="text-[13px] text-ink">
            Tell Walkup about the building so it can check your coverage.{" "}
            <Link href="/insurance/facts" className={linkClass}>
              About the building
            </Link>
          </p>
        </Card>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Banners (board).
  const [banners, ownerSummary, bills, budget] = await Promise.all([
    ctx.isBoard ? loadInsuranceBanners(supabase, assoc, today) : Promise.resolve([] as InsuranceBanner[]),
    ctx.isBoard ? loadOwnerSummary(supabase, assoc) : Promise.resolve(null),
    supabase
      .from("recurring_bills")
      .select("id, name, insurance_policy_id, is_active")
      .eq("association_id", assoc)
      .eq("is_active", true),
    (async () => {
      const { data: years } = await supabase
        .from("fiscal_years")
        .select("id")
        .eq("association_id", assoc)
        .lte("starts_on", today)
        .gte("ends_on", today);
      const ids = ((years ?? []) as { id: string }[]).map((y) => y.id);
      if (ids.length === 0) return [] as { name: string; type: string; budgeted: string }[];
      const { data } = await supabase.from("budget_vs_actual").select("name, type, budgeted::text").in("fiscal_year_id", ids);
      return (data ?? []) as unknown as { name: string; type: string; budgeted: string }[];
    })(),
  ]);
  const billRows = (bills.data ?? []) as { id: string; name: string; insurance_policy_id: string | null }[];
  const allBanners = [...banners];
  if (ctx.isBoard) {
    for (const p of inForce) {
      const carrier = p.carrier_name.trim().toLowerCase();
      const mine = billRows.filter(
        (b) => b.name.trim().toLowerCase().startsWith(carrier) && (b.insurance_policy_id === null || b.insurance_policy_id === p.id),
      );
      if (carrier && mine.length > 1) {
        allBanners.push({
          key: `dup_bills:${p.id}`, tone: "attention", text: `You may be tracking the ${p.carrier_name} premium twice.`,
          href: "/bills", action: "Review bills",
        });
      }
    }
  }
  allBanners.sort((a, b) => bannerRank(a) - bannerRank(b));
  const ownerRequest = allBanners.find((b) => b.key === "owner_requests");

  // Renewal answer (§9.1 item 1).
  let renewal: React.ReactNode = null;
  const covered = new Set(nonArchived.filter((p) => p.status === "active" || p.status === "upcoming").map((p) => p.coverage));
  const lapsed = nonArchived
    .filter((p) => p.status === "expired" && !p.renewed && !covered.has(p.coverage))
    .sort((a, b) => b.effective_to.localeCompare(a.effective_to))[0];
  const soon = renewalFor(inForce, today);
  const renewedSoon = inForce
    .filter((p) => p.renewed && p.successor_id)
    .map((p) => ({ p, next: policies.find((x) => x.id === p.successor_id) }))
    .filter((x) => x.next && x.next.status === "upcoming")
    .sort((a, b) => a.p.effective_to.localeCompare(b.p.effective_to))[0];
  if (lapsed) {
    renewal = (
      <Answer status="bad" headline={`Your ${coverageShort(lapsed.coverage).toLowerCase()} policy ended on ${longDate(lapsed.effective_to)}.`}>
        {ctx.isBoard ? (
          <Link href={`/insurance/policies/${lapsed.id}/renew`} className={btnGhost}>
            Add the renewal
          </Link>
        ) : null}
      </Answer>
    );
  } else if (soon && soon.withinReminder) {
    const c = soon.policy.coverage;
    renewal = (
      <Answer
        status={soon.daysToEnd <= 30 ? "bad" : "attention"}
        headline={`${coverageShort(c)} renews in ${soon.daysToEnd} ${soon.daysToEnd === 1 ? "day" : "days"}, on ${longDate(soon.policy.effective_to)}.`}
        detail={`Other agencies can quote the same coverage. Ask them how much notice they need before ${longDate(soon.policy.effective_to)}.`}
      >
        {ctx.isBoard ? (
          <div className="flex flex-wrap gap-2">
            <Link href={`/insurance?view=quotes&new=1&coverage=${c}`} className={btnGhost}>
              Ask for quotes
            </Link>
            <Link href="/insurance?view=market" className={btnGhost}>
              Find agencies
            </Link>
          </div>
        ) : null}
      </Answer>
    );
  } else if (renewedSoon?.next) {
    renewal = (
      <Answer
        status="good"
        headline={`${coverageShort(renewedSoon.p.coverage)} renewal is saved. The new policy starts ${longDate(renewedSoon.next.effective_from)}.`}
      />
    );
  }

  // Coverage map (§9.1 item 2).
  const lines = linesInForce(inForce);
  const live = check.findings.filter((f) => !f.dismissed);
  const named = new Set(live.map((f) => f.line).filter((l): l is LineKey => l !== null));
  const shown = LINE_KEYS.filter((l) => lines[l] || named.has(l));
  const others = LINE_KEYS.filter((l) => !shown.includes(l));

  // Cost (§9.1 item 3).
  const total = premiumTotals(inForce);
  const perUnit = perUnitCost(total, ctx.unitCount);
  let lastChange: string | null = null;
  if (master) {
    const { data } = await supabase
      .from("insurance_year_over_year")
      .select("change_percent::text")
      .eq("policy_id", master.id)
      .maybeSingle();
    lastChange = (data as { change_percent: string | null } | null)?.change_percent ?? null;
  }
  const sumLines = (rows: { budgeted: string }[]) => rows.reduce((s, r) => s + (r.budgeted ? toCents(r.budgeted) : 0), 0);
  const assessments = sumLines(budget.filter((b) => b.type === "income" && /assessment|dues/i.test(b.name)));
  const insuranceBudget = budget.filter((b) => b.type === "expense" && /insurance/i.test(b.name));
  const budgeted = sumLines(insuranceBudget);
  const totalCents = toCents(total);
  const share = assessments > 0 ? ((totalCents * 1000) / assessments) : null;
  const tracked = new Set(billRows.map((b) => b.insurance_policy_id).filter(Boolean));
  const untracked = inForce.filter((p) => !tracked.has(p.id));
  let accounts: { id: string; name: string }[] = [];
  if (ctx.isBoard && untracked.length > 0) {
    const { data } = await supabase.from("accounts").select("id, name").eq("association_id", assoc).eq("type", "expense").eq("is_active", true).order("code");
    accounts = (data ?? []) as { id: string; name: string }[];
  }

  // Each policy in force with a document on file: the declarations page it was read from. Previewed in a pop-out, or downloaded.
  const sourceIds = [...new Set(inForce.map((p) => rowText(p, "source_document_id")).filter((v): v is string => !!v))];
  const docRows = sourceIds.length
    ? (
        await supabase
          .from("documents")
          .select("id, title, filename, mime_type")
          .in("id", sourceIds)
          .is("deleted_at", null)
      ).data ?? []
    : [];
  const docById = new Map((docRows as { id: string; title: string | null; filename: string; mime_type: string | null }[]).map((d) => [d.id, d]));
  const policyDocs = inForce
    .map((p) => {
      const id = rowText(p, "source_document_id");
      const doc = id ? docById.get(id) : null;
      return doc ? { policy: p, doc } : null;
    })
    .filter((x): x is { policy: PolicyWithStatus; doc: { id: string; title: string | null; filename: string; mime_type: string | null } } => x !== null);

  // Owners card (§9.1 item 6).
  let ownersText: string | null = null;
  let ownersStale: string | null = null;
  if (ctx.isBoard && ownerSummary?.published && ownerSummary.published_at) {
    ownersStale = stalenessSentence(await ownerSummaryStalenessFor(supabase, ownerSummary, today));
    ownersText = ownersStale ?? `Owners can see your insurance summary, published ${longDate(ownerSummary.published_at)}.`;
  }

  const counts = check.counts;
  const top = live.slice(0, 3);
  const claimsPhone = master ? rowText(master, "claims_phone") : null;
  const claimsTel = claimsPhone ? telHref(claimsPhone) : null;
  const agentTel = agent?.phone ? telHref(agent.phone) : null;
  const policyLabel = (id: string | null) => {
    const p = id ? policies.find((x) => x.id === id) : null;
    return p ? `${p.carrier_name} ${coverageShort(p.coverage).toLowerCase()}` : null;
  };

  return (
    <div className="space-y-6">
      {ctx.isBoard ? (
        <ReadBanners
          banners={allBanners}
          extra={ownerRequest?.ownerRequestId ? { owner_requests: <MarkRequestDone requestId={ownerRequest.ownerRequestId} /> } : undefined}
        />
      ) : null}
      {renewal}

      <Card title="Coverage on file" navy>
        {shown.length === 0 ? (
          <p className="text-[13px] text-mute">No policy is in force right now.</p>
        ) : (
          <ul className="grid gap-x-8 sm:grid-cols-2">
            {shown.map((l) => {
              const cover = lines[l];
              const status = lineStatus(check.findings, l);
              return (
                <li key={l} className="border-b border-line py-3 text-[13px] last:border-0 sm:[&:nth-last-child(2)]:border-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium text-ink">{LINE_LABEL[l]}</span>
                    <span className={cover ? "figures text-ink" : "text-mute"}>
                      {cover ? (cover.limit ? formatMoney(cover.limit) : "Included") : "Not on file"}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px]">
                    {cover?.policies.map((p) => (
                      <Link key={p.id} href={`/insurance/policies/${p.id}`} className="rounded-full border border-line px-2 py-0.5 text-mute hover:text-ink">
                        {p.carrier} {coverageShort(p.coverage).toLowerCase()}
                      </Link>
                    ))}
                    {status ? (
                      <span className="inline-flex items-center gap-1.5 text-ink">
                        <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${status.dot}`} />
                        {status.text}
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {policyDocs.length > 0 ? (
          <div className="mt-3 border-t border-line pt-3">
            <h3 className="text-[13px] font-bold text-ink">Policy documents</h3>
            <ul className="mt-1 divide-y divide-line">
              {policyDocs.map(({ policy, doc }) => {
                const name = `${policy.carrier_name} ${coverageShort(policy.coverage).toLowerCase()}`;
                return (
                  <li key={policy.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
                    <span className="min-w-0">
                      <span className="font-medium text-ink">{name}</span>
                      <span className="ml-2 break-all text-[12px] text-mute">{doc.title || doc.filename}</span>
                    </span>
                    <PolicyDocument documentId={doc.id} heading={name} filename={doc.filename} kind={previewKind(doc.mime_type)} />
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        {others.length > 0 ? (
          <details className="mt-3 text-[13px]">
            <summary className="min-h-[44px] cursor-pointer py-2 text-ink">Other kinds of coverage ({others.length})</summary>
            <p className="text-[12px] text-mute">Not on file. The coverage check asks about these only when your answers point to them.</p>
            <ul className="mt-1 list-disc pl-5 text-mute">
              {others.map((l) => (
                <li key={l}>{LINE_LABEL[l]}</li>
              ))}
            </ul>
          </details>
        ) : null}
        <p className="mt-3 text-[13px]">
          <Link href="/insurance?open=check#coverage-check" className={linkClass}>
            See the full coverage check
          </Link>
        </p>
      </Card>

      <Card navy title="Cost">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Premiums a year" value={formatMoney(total) ?? "$0"} />
            {perUnit ? (
              <Stat label="Per unit" value={`${formatMoney(perUnit.perYear)} a year`} note={`About ${formatMoney(perUnit.perMonth, { cents: true })} a month`} />
            ) : null}
            {lastChange !== null ? (
              <Stat
                label="Change at last renewal"
                value={`${lastChange.startsWith("-") ? "" : "+"}${lastChange.replace(/\.0$/, "")}%`}
                note="For the master policy"
              />
            ) : null}
          </div>
          {share !== null ? (
            <p className="text-[13px] text-ink">
              Insurance is {(Math.round(share) / 10).toFixed(1)}% of this year&rsquo;s budgeted assessments.
            </p>
          ) : null}
          {insuranceBudget.length > 0 ? (
            <p className="text-[13px] text-ink">
              Budgeted for insurance this year: {formatMoney(fromCents(budgeted))}. Your current premiums total {formatMoney(total)}.
              {totalCents > budgeted ? (
                <span className="text-warning-text"> {formatMoney(fromCents(totalCents - budgeted))} more than budgeted.</span>
              ) : null}
            </p>
          ) : (
            <p className="text-[13px] text-mute">
              No insurance line in this year&rsquo;s budget.{" "}
              <Link href="/budget" className={linkClass}>
                Open the budget
              </Link>
            </p>
          )}
          {inForce.length > 0 ? (
            <div className="space-y-3">
              <p className="text-[13px] text-ink">
                Tracked as bills: {inForce.length - untracked.length} of {inForce.length} {inForce.length === 1 ? "policy" : "policies"}.
              </p>
              {ctx.isBoard
                ? untracked.map((p) => (
                    <div key={p.id} className="rounded-lg border border-line px-4 py-3">
                      <p className="mb-2 text-[13px] text-ink">
                        {coverageShort(p.coverage)}, {p.carrier_name}
                      </p>
                      <TrackPremium
                        policyId={p.id}
                        categories={accounts}
                        defaultCategoryId={accounts.find((a) => /insurance/i.test(a.name))?.id ?? null}
                      />
                    </div>
                  ))
                : null}
            </div>
          ) : null}
        </div>
      </Card>

      <Card navy title="Coverage check">
        {top.length > 0 ? (
          <div className="space-y-3">
            {top.map((f) => (
              <FindingCard key={f.id} finding={f} stateName={stateName} policyLabel={policyLabel(f.policyId)} canEdit={false} compact answerPolicy={null} />
            ))}
            <p className="text-[13px] text-ink">
              {counts.gap} {counts.gap === 1 ? "gap" : "gaps"}, {check.notOnFileCount} not on file yet, {counts.ask} worth asking about.{" "}
              <Link href="/insurance?open=check#coverage-check" className={linkClass}>
                See all
              </Link>
            </p>
          </div>
        ) : check.missingFacts.length === 0 ? (
          <p className="text-[13px] text-ink">Nothing missing that Walkup can check.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-[13px] text-ink">
              Nothing missing so far. Walkup can&rsquo;t check {check.missingFacts.length} things until you answer a few questions.
            </p>
            {ctx.isBoard ? (
              <Link href={`/insurance/facts?only=${check.missingFacts.join(",")}`} className={btnGhost}>
                Answer {check.missingFacts.length} questions
              </Link>
            ) : (
              <p className="text-[12px] text-mute">{check.missingFacts.map((k) => FACT_LABEL[k]).join("; ")}</p>
            )}
          </div>
        )}
      </Card>

      <Card navy title="Your agent">
        <div className="space-y-3">
          {master && claimsPhone ? (
            <p className="text-[13px] text-ink">
              To report damage, call {master.carrier_name} claims at{" "}
              {claimsTel ? (
                <a href={claimsTel} className="figures font-medium underline underline-offset-2">
                  {formatPhone(claimsPhone)}
                </a>
              ) : (
                <span className="figures">{claimsPhone}</span>
              )}
              .
            </p>
          ) : null}
          {agent ? (
            <ContactCard contact={agent}>
              {agentTel ? (
                <a href={agentTel} className={btnPrimary}>
                  Call {formatPhone(agent.phone as string)}
                </a>
              ) : null}
              {agent.email ? (
                <a href={mailtoLink(agent.email)} className={btnGhost}>
                  Email
                </a>
              ) : null}
              {ctx.isBoard ? (
                <>
                  <Link href={`/insurance/emails/new?kind=certificate_request&contact=${agent.id}`} className={btnGhost}>
                    Ask for a certificate
                  </Link>
                  <Link href="/insurance/claims/new" className={btnGhost}>
                    Report a claim
                  </Link>
                </>
              ) : null}
              <Link href="/insurance/sheet" className={btnGhost}>
                Print the insurance facts sheet
              </Link>
            </ContactCard>
          ) : (
            <p className="text-[13px] text-mute">No agent recorded. {ctx.isBoard ? "Add one from a policy, or in Marketplace." : "A board member can add one."}</p>
          )}
        </div>
      </Card>

      {ctx.isBoard ? (
        <Card navy title="For owners">
          <div className="space-y-3">
            <p className="text-[13px] text-ink">
              {ownersText ??
                "Owners can't see anything about the building's insurance yet. Publish a short summary of what the master policy covers and what it leaves to their own condo (HO-6) policy."}
            </p>
            <Link href="/insurance/owner-summary" className={btnGhost}>
              {ownersText ? "Update it" : "Write the owner summary"}
            </Link>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
