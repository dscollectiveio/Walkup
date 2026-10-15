import { shortDate } from "@/lib/dates";
import { daysBetween, type PolicyStatus } from "@/lib/insurance/status";

/**
 * A small status pill. The words carry the status; the tint only repeats it
 * (§11.7: never colour alone).
 */

export type ChipTone = "good" | "warning" | "bad" | "info" | "neutral";

const TONE: Record<ChipTone, string> = {
  good: "border-good-line bg-good-tint text-good-text",
  warning: "border-warning-line bg-warning-tint text-warning-text",
  bad: "border-bad-line bg-bad-tint text-bad-text",
  info: "border-info-line bg-info-tint text-info-text",
  neutral: "border-neutral-line bg-neutral-tint text-neutral-text",
};

export function Chip({ tone, children }: { tone: ChipTone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${TONE[tone]}`}>
      {children}
    </span>
  );
}

export interface ChipPolicy {
  status: PolicyStatus;
  renewed: boolean;
  effective_from: string;
  effective_to: string;
  renewal_reminder_days: number;
}

/** The Policies tab chip (§9.2): words and tone for one policy. */
export function policyChip(p: ChipPolicy, todayIso: string): { tone: ChipTone; text: string } {
  switch (p.status) {
    case "archived":
      return { tone: "neutral", text: "Archived" };
    case "replaced":
      return { tone: "neutral", text: "Replaced" };
    case "upcoming":
      return { tone: "info", text: `Starts ${shortDate(p.effective_from, todayIso)}` };
    case "expired":
      return { tone: "bad", text: `Ended ${shortDate(p.effective_to, todayIso)}` };
    default: {
      if (p.renewed) return { tone: "info", text: "Renewal saved" };
      const days = daysBetween(todayIso, p.effective_to);
      if (days <= p.renewal_reminder_days) {
        return { tone: "warning", text: days === 1 ? "Renews in 1 day" : `Renews in ${days} days` };
      }
      return { tone: "good", text: "Active" };
    }
  }
}

export function StatusChip({ policy, todayIso }: { policy: ChipPolicy; todayIso: string }) {
  const c = policyChip(policy, todayIso);
  return <Chip tone={c.tone}>{c.text}</Chip>;
}

const CLAIM_STATUS: Record<string, { text: string; tone: ChipTone }> = {
  open: { text: "Open", tone: "warning" },
  paid: { text: "Paid", tone: "good" },
  denied: { text: "Denied", tone: "bad" },
  withdrawn: { text: "Withdrawn", tone: "neutral" },
};

/** A claim's status as a chip (§9.4.3). */
export function ClaimStatusChip({ status }: { status: string }) {
  const c = CLAIM_STATUS[status] ?? { text: status, tone: "neutral" as ChipTone };
  return <Chip tone={c.tone}>{c.text}</Chip>;
}
