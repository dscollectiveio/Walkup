import Link from "next/link";
import { coverageShort } from "@/lib/insurance/coverage";
import { formatMoney, periodLabel } from "@/lib/insurance/format";
import { StatusChip, type ChipPolicy } from "./status-chip";

export interface PolicyRowData extends ChipPolicy {
  id: string;
  coverage: string;
  carrier_name: string;
  annual_premium: string;
  policy_number?: unknown;
}

/** One policy in a list (§9.2): a link to its detail page, with its status chip. */
export function PolicyRow({ policy, todayIso }: { policy: PolicyRowData; todayIso: string }) {
  const premium = formatMoney(policy.annual_premium);
  const number = typeof policy.policy_number === "string" && policy.policy_number.trim() ? policy.policy_number.trim() : null;
  return (
    <li>
      <Link
        href={`/insurance/policies/${policy.id}`}
        className="flex min-h-[56px] items-start justify-between gap-3 py-3 hover:bg-fill/60 sm:px-1"
      >
        <span className="min-w-0">
          <span className="block text-[13px] font-medium text-ink">
            {coverageShort(policy.coverage)} · {policy.carrier_name}
          </span>
          <span className="mt-0.5 block text-[12px] text-mute">
            {periodLabel(policy.effective_from, policy.effective_to)}
            {premium ? <> · <span className="figures">{premium}</span> a year</> : null}
            {number ? ` · ${number}` : null}
          </span>
        </span>
        <StatusChip policy={policy} todayIso={todayIso} />
      </Link>
    </li>
  );
}
