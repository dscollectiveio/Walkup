import Link from "next/link";
import type { ReactNode } from "react";

/** Small shared pieces for the import wizard. Tokens and spacing follow the rest of the app. */

export const BTN_PRIMARY =
  "inline-flex min-h-[44px] items-center justify-center rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass";
export const BTN_SECONDARY =
  "inline-flex min-h-[44px] items-center justify-center rounded-md border border-line-strong bg-paper px-4 py-2 text-[13px] font-medium text-ink hover:bg-fill disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass";
export const INPUT =
  "w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass";
export const LABEL = "block text-[12px] font-medium text-ink";
export const HELP = "mt-1 text-[12px] leading-relaxed text-mute";

const PILL_TONE = {
  neutral: "bg-fill text-mute",
  good: "bg-good-tint text-good-text",
  warning: "bg-warning-tint text-warning-text",
  bad: "bg-bad-tint text-bad-text",
  info: "bg-info-tint text-info-text",
} as const;

export function Pill({ tone = "neutral", children }: { tone?: keyof typeof PILL_TONE; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${PILL_TONE[tone]}`}>{children}</span>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="border-l-[3px] border-bad bg-bad-tint px-3 py-2 text-[13px] text-bad-text">
      {children}
    </p>
  );
}

export function InfoNote({ children }: { children: ReactNode }) {
  return <p className="border-l-[3px] border-info bg-info-tint px-3 py-2 text-[13px] text-info-text">{children}</p>;
}

/** The page for someone who is not a board admin. */
export function BoardOnly({ what, why }: { what: string; why: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong bg-paper px-5 py-10 text-center">
      <p className="text-ink">{what} is for the board.</p>
      <p className="mt-2 text-[13px] text-mute">{why}</p>
      <Link href="/building" className={`${BTN_SECONDARY} mt-4`}>
        Back to Building & Owners
      </Link>
    </div>
  );
}

export function PageHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div>
      <h1 className="text-[20px] font-bold tracking-tight text-ink">{title}</h1>
      {sub ? <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-mute">{sub}</p> : null}
    </div>
  );
}

export function longDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
