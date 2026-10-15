import Link from "next/link";
import { Card } from "@/components/ui";
import { Pill, type PillTone } from "@/components/repairs/pills";
import { btnSecondary } from "@/components/repairs/styles";
import { deductibleHint } from "@/lib/insurance/status";
import { humanDate, moneyText } from "@/lib/repairs/format";
import { toCents } from "@/lib/tax/form1120h";
import type { EmergencyKind } from "@/lib/repairs/emergency";

/**
 * Insurance (repairs-spec §5.3 card 10, insurance-spec §12 R-1 and R-5),
 * financial readers: the claims this problem is part of, with their amounts
 * and policy; when there's no claim, the deductible nudge (Insurance's
 * deductibleHint, else a short prompt when damage like this is often a
 * claim). States the deductible the board recorded; never estimates one.
 * The board can start a claim from any problem.
 */

export function insuranceLine(p: {
  emergencyKind: EmergencyKind | null;
  actualCost: string | null;
  policy: { propertyDeductible: string | null; waterDeductible: string | null } | null;
}): string | null {
  const water = p.emergencyKind === "flooding" || p.emergencyKind === "sewage";
  const deductible = water ? (p.policy?.waterDeductible ?? p.policy?.propertyDeductible ?? null) : (p.policy?.propertyDeductible ?? null);
  const ded = deductible ? `Your master policy deductible is ${moneyText(deductible)}.` : "Your master policy's deductible isn't recorded in Walkup.";
  if (water) return `Water damage is sometimes an insurance claim. ${ded}`;
  if (p.emergencyKind === "fire") return `Fire damage is often an insurance claim. ${ded}`;
  if (p.actualCost && deductible && toCents(p.actualCost) > toCents(deductible)) {
    return `The final cost is above your master policy deductible (${moneyText(deductible)}).`;
  }
  return null;
}

const CLAIM_STATUS: Record<string, { label: string; tone: PillTone }> = {
  open: { label: "Open", tone: "warning" },
  paid: { label: "Paid", tone: "good" },
  denied: { label: "Denied", tone: "bad" },
  withdrawn: { label: "Withdrawn", tone: "outline" },
};

export interface ClaimView {
  id: string;
  policyId: string | null;
  claimNumber: string | null;
  status: string;
  dateOfLoss: string;
  amountClaimed: string | null;
  amountPaid: string | null;
}

export function InsurancePrompt(props: {
  ticketId: string;
  todayIso: string;
  canWrite: boolean;
  trade: string | null;
  emergencyKind: EmergencyKind | null;
  estimatedCost: string | null;
  actualCost: string | null;
  claims: ClaimView[];
  policy: { id: string; propertyDeductible: string | null; waterDeductible: string | null } | null;
}) {
  const startHref = `/insurance/claims/new?${props.policy ? `policy=${props.policy.id}&` : ""}ticket=${props.ticketId}`;
  const start = props.canWrite ? (
    <Link href={startHref} className={btnSecondary}>
      Start an insurance claim
    </Link>
  ) : null;

  if (props.claims.length > 0) {
    return (
      <Card navy title="Insurance claims">
        <ul className="divide-y divide-line">
          {props.claims.map((c) => {
            const st = CLAIM_STATUS[c.status] ?? { label: c.status, tone: "neutral" as PillTone };
            const amounts = [
              c.amountClaimed ? `Claimed ${moneyText(c.amountClaimed)}` : null,
              c.amountPaid ? `Paid ${moneyText(c.amountPaid)}` : null,
            ].filter(Boolean);
            const label = `Claim ${c.claimNumber ?? "without a number"}`;
            return (
              <li key={c.id} className="flex flex-col gap-1 py-2 text-[14px]">
                <span className="flex flex-wrap items-center gap-2">
                  <Pill tone={st.tone}>{st.label}</Pill>
                  {c.policyId ? (
                    <Link href={`/insurance/policies/${c.policyId}`} className="text-ink underline-offset-2 hover:underline">
                      {label}
                    </Link>
                  ) : (
                    <span className="text-ink">{label}</span>
                  )}
                </span>
                <span className="text-[13px] text-mute">
                  Loss on {humanDate(c.dateOfLoss, props.todayIso)}
                  {amounts.length > 0 ? ` · ${amounts.join(" · ")}` : ""}
                </span>
              </li>
            );
          })}
        </ul>
        {start ? <div className="mt-3">{start}</div> : null}
      </Card>
    );
  }

  // R-5: the repair's cost (final, else estimate) against the right deductible.
  const hint = props.policy
    ? deductibleHint(
        {
          trade: props.trade,
          emergency_kind: props.emergencyKind,
          actual_cost: props.actualCost,
          estimated_cost: props.estimatedCost,
          has_claim: false,
        },
        { id: props.policy.id, property_deductible: props.policy.propertyDeductible, water_damage_deductible: props.policy.waterDeductible },
      )
    : null;
  const line = hint?.text ?? insuranceLine(props);

  if (!line) {
    if (!start) return null;
    return (
      <Card navy title="Insurance">
        <p className="text-[13px] text-mute">No insurance claim for this problem.</p>
        <div className="mt-3">{start}</div>
      </Card>
    );
  }
  return (
    <Card navy title="Insurance">
      <p className="text-[14px] text-ink">{line}</p>
      {props.canWrite ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {start}
          {props.policy ? (
            <Link href={`/insurance/emails/new?kind=coverage_question&policy=${props.policy.id}`} className={btnSecondary}>
              Ask your agent
            </Link>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
