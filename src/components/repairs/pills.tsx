import { STATUS_LABEL, type TicketStatus } from "@/lib/repairs/labels";
import { STAGE_LABEL, type Stage } from "@/lib/repairs/stage";

/**
 * Small labelled pills for Repairs (repairs-spec §5.3, §5.7). Every pill
 * carries its meaning in words; the tint only repeats it.
 */

export type PillTone = "bad" | "warning" | "good" | "neutral" | "outline" | "info";

const TONE: Record<PillTone, string> = {
  bad: "border-bad-line bg-bad-tint text-bad-text",
  warning: "border-warning-line bg-warning-tint text-warning-text",
  good: "border-good-line bg-good-tint text-good-text",
  info: "border-info-line bg-info-tint text-info-text",
  neutral: "border-neutral-line bg-neutral-tint text-neutral-text",
  outline: "border-line-strong bg-paper text-mute",
};

export function Pill({ tone = "neutral", children }: { tone?: PillTone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${TONE[tone]}`}>
      {children}
    </span>
  );
}

const STATUS_TONE: Record<TicketStatus, PillTone> = {
  open: "neutral",
  in_progress: "info",
  waiting_on_contractor: "info",
  resolved: "good",
  closed: "outline",
};

/** Owners see statuses. */
export function StatusPill({ status }: { status: TicketStatus }) {
  return <Pill tone={STATUS_TONE[status] ?? "neutral"}>{STATUS_LABEL[status] ?? status}</Pill>;
}

/** The board sees stages, neutral (the stage is information, not a warning). */
export function StagePill({ stage, outline = false }: { stage: Stage; outline?: boolean }) {
  return <Pill tone={outline ? "outline" : "neutral"}>{STAGE_LABEL[stage]}</Pill>;
}
