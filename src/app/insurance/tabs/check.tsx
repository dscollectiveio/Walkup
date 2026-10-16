import Link from "next/link";
import { Answer, Card } from "@/components/ui";
import { LINE_LABEL, coverageShort } from "@/lib/insurance/coverage";
import { dismissalFor, type Basis, type Finding, type runCoverageCheck } from "@/lib/insurance/coverage-check";
import { FACT_LABEL } from "@/lib/insurance/facts";
import { rowText } from "@/lib/insurance/fields";
import { longDate } from "@/lib/insurance/format";
import type { InsuranceContext, PolicyWithStatus, Supabase } from "@/lib/insurance/queries";
import { FindingCard, RestoreButton } from "../components/finding-card";
import { Disclaimer } from "../components/page-header";
import { btnGhost } from "../components/styles";

/**
 * The Coverage check tab (insurance-spec §9.5): an answer, the facts the
 * check still needs, findings grouped by what they rest on, and the ones the
 * board marked not relevant.
 */

type Check = ReturnType<typeof runCoverageCheck>;

function joinWords(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export async function CheckTab({
  supabase,
  ctx,
  policies,
  check,
  stateName,
}: {
  supabase: Supabase;
  ctx: InsuranceContext;
  policies: PolicyWithStatus[];
  check: Check;
  stateName: string;
}) {
  const illinois = (ctx.association.state_code ?? "").toUpperCase() === "IL";
  const nonArchived = policies.filter((p) => p.status !== "archived");
  if (nonArchived.length === 0) {
    return (
      <div className="space-y-6">
        <Card navy title="Coverage check">
          <div className="space-y-3">
            <p className="text-[13px] text-ink">
              {illinois
                ? `Add your policies first. The check compares them with ${stateName} law (Illinois only), your declaration and the building's facts.`
                : "Add your policies first. The check compares them with your declaration and the building's facts."}
            </p>
            {ctx.isBoard ? (
              <Link href="/insurance/import" className={btnGhost}>
                Import a policy
              </Link>
            ) : null}
          </div>
        </Card>
        <Disclaimer />
      </div>
    );
  }

  const { data: dismissalRows } = await supabase
    .from("insurance_finding_dismissals")
    .select("id, rule_id, policy_id, finding_key, reason, dismissed_by, created_at")
    .eq("association_id", ctx.association.id);
  const dismissals = (dismissalRows ?? []) as {
    id: string; rule_id: string; policy_id: string | null; finding_key: string; reason: string; dismissed_by: string | null; created_at: string;
  }[];
  const userIds = [...new Set(dismissals.map((d) => d.dismissed_by).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (userIds.length) {
    const { data } = await supabase.from("persons").select("auth_user_id, full_name").in("auth_user_id", userIds);
    for (const p of (data ?? []) as { auth_user_id: string; full_name: string }[]) names.set(p.auth_user_id, p.full_name);
  }

  const live = check.findings.filter((f) => !f.dismissed);
  const dismissed = check.findings.filter((f) => f.dismissed);
  const gaps = live.filter((f) => f.severity === "gap" && !f.notOnFile);
  const notOnFile = live.filter((f) => f.notOnFile);
  const asks = live.filter((f) => f.severity === "ask");
  const missing = check.missingFacts;
  const factsHref = `/insurance/facts?only=${missing.join(",")}`;

  // 1. The answer.
  let answer: React.ReactNode;
  let answerAskedFacts = false;
  if (gaps.length > 0) {
    answer = (
      <Answer
        status="bad"
        headline={`${gaps.length} ${gaps.length === 1 ? "gap" : "gaps"} in your coverage records.`}
        detail="Each one says what Walkup compared and why. Your agent can confirm."
      />
    );
  } else if (notOnFile.length > 0) {
    const lineNames = [...new Set(notOnFile.map((f) => (f.line ? LINE_LABEL[f.line].toLowerCase() : null)).filter((x): x is string => !!x))];
    const one = notOnFile.length === 1;
    answer = (
      <Answer
        status="attention"
        headline={`Walkup has no ${joinWords(lineNames)} policy on file. If you have ${one ? "it" : "them"}, add ${one ? "it" : "them"}.${ctx.isBoard ? "" : " A board member can add them."}`}
      >
        {ctx.isBoard ? (
          <Link href="/insurance/import" className={btnGhost}>
            Import a policy
          </Link>
        ) : null}
      </Answer>
    );
  } else if (asks.length > 0) {
    answer = (
      <Answer
        status="attention"
        headline={`Nothing required looks missing. ${asks.length} ${asks.length === 1 ? "thing is" : "things are"} worth asking your agent about.`}
      />
    );
  } else if (missing.length > 0) {
    answerAskedFacts = true;
    answer = (
      <Answer status="attention" headline={`Nothing missing so far. Walkup can't check ${missing.length} things until you answer a few questions.`}>
        {ctx.isBoard ? (
          <Link href={factsHref} className={btnGhost}>
            Answer {missing.length} questions
          </Link>
        ) : null}
      </Answer>
    );
  } else {
    answer = <Answer status="good" headline="Nothing missing that Walkup can check." />;
  }

  // 4. Groups by basis; gaps first, then not on file.
  const GROUPS: { basis: Basis; title: string }[] = [
    { basis: "statute", title: `Required by ${stateName} law` },
    { basis: "your_documents", title: "From your declaration" },
    { basis: "your_data", title: "From your own numbers" },
    { basis: "common_practice", title: "Commonly carried: worth asking about" },
  ];
  const order = (f: Finding) => (f.severity === "gap" && !f.notOnFile ? 0 : f.notOnFile ? 1 : 2);

  const policyLabel = (id: string | null) => {
    const p = id ? policies.find((x) => x.id === id) : null;
    return p ? `${p.carrier_name} ${coverageShort(p.coverage).toLowerCase()}` : null;
  };
  const master = policies
    .filter((p) => p.status === "active" && p.coverage === "property")
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
  const answerPolicy = (f: Finding) => {
    const p = (f.policyId ? policies.find((x) => x.id === f.policyId) : null) ?? master ?? null;
    const updatedAt = p ? rowText(p, "updated_at") : null;
    return p && updatedAt ? { id: p.id, updatedAt } : null;
  };

  return (
    <div className="space-y-6">
      {answer}

      {check.legalChecks === "not_illinois" ? (
        <Card navy title="Legal checks">
          <p className="text-[13px] text-ink">Walkup&rsquo;s legal checks cover Illinois only. The other checks still apply.</p>
        </Card>
      ) : null}

      {missing.length > 0 && !answerAskedFacts ? (
        <Card navy title="Facts needed">
          <div className="space-y-3">
            <p className="text-[13px] text-ink">Walkup needs {missing.length} more facts to check everything.</p>
            <ul className="flex flex-wrap gap-2">
              {missing.map((k) => (
                <li key={k} className="rounded-full border border-line px-3 py-1 text-[12px] text-ink">
                  {FACT_LABEL[k]}
                </li>
              ))}
            </ul>
            {ctx.isBoard ? (
              <Link href={factsHref} className={btnGhost}>
                Answer {missing.length} questions
              </Link>
            ) : null}
          </div>
        </Card>
      ) : null}

      {GROUPS.map((g) => {
        const items = live.filter((f) => f.basis === g.basis).sort((a, b) => order(a) - order(b));
        if (items.length === 0) return null;
        return (
          <section key={g.basis} className="space-y-3">
            <h2 className="eyebrow text-mute">{g.title}</h2>
            {items.map((f) => (
              <FindingCard
                key={f.id}
                finding={f}
                stateName={stateName}
                policyLabel={policyLabel(f.policyId)}
                canEdit={ctx.isBoard}
                answerPolicy={answerPolicy(f)}
              />
            ))}
          </section>
        );
      })}

      {dismissed.length > 0 ? (
        <details className="rounded-xl border border-line bg-paper px-5 py-3">
          <summary className="min-h-[44px] cursor-pointer py-2 text-[13px] font-bold text-ink">Dismissed ({dismissed.length})</summary>
          <ul className="divide-y divide-line">
            {dismissed.map((f) => {
              const d = dismissalFor(
                dismissals.map((x) => ({ ...x, ruleId: x.rule_id, policyId: x.policy_id, findingKey: x.finding_key })),
                f,
              );
              const who = d?.dismissed_by ? names.get(d.dismissed_by) : null;
              return (
                <li key={f.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-[13px]">
                  <div className="min-w-0">
                    <div className="font-medium text-ink">{f.title}</div>
                    <div className="mt-0.5 text-mute">
                      &ldquo;{f.dismissed?.reason}&rdquo;
                      {who ? ` · ${who}` : ""}
                      {d ? ` · ${longDate(d.created_at)}` : ""}
                    </div>
                  </div>
                  {ctx.isBoard && d ? <RestoreButton dismissalId={d.id} /> : null}
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}

      <Disclaimer />
    </div>
  );
}
