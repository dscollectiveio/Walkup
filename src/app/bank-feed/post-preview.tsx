"use client";

import { money, moneyRounded } from "@/components/ui";

/** The little a bulk post needs to know about each row to say what it is about to do. */
export interface PreviewRow {
  id: string;
  description: string;
  amount: string | number;
  /** Null when the board has never filed this payee before (recommend.ts typicalAmountCents). */
  typicalCents: number | null;
}

/** Bulk posts of more rows than this get a look first. */
export const PREVIEW_ABOVE = 10;

/** Money in and out across a set of rows, as positive numbers. */
export function sumInOut(rows: { amount: string | number }[]): { moneyIn: number; moneyOut: number } {
  let moneyIn = 0;
  let moneyOut = 0;
  for (const r of rows) {
    const n = Number(r.amount);
    if (n > 0) moneyIn += n;
    else moneyOut += -n;
  }
  return { moneyIn, moneyOut };
}

/** "$4,310 out · $2,800 in", leaving out a side that is zero. */
export function inOutLabel(rows: { amount: string | number }[]): string {
  const { moneyIn, moneyOut } = sumInOut(rows);
  const parts: string[] = [];
  if (moneyOut > 0) parts.push(`${moneyRounded(moneyOut)} out`);
  if (moneyIn > 0) parts.push(`${moneyRounded(moneyIn)} in`);
  return parts.join(" · ");
}

const UNUSUAL_RATIO = 3;

/**
 * Up to three things worth a glance before posting, from what the rows
 * already carry: payees the board has never filed before, and amounts more
 * than three times what that payee usually costs. Nudges only — nothing here
 * blocks a post.
 */
export function previewFlags(rows: PreviewRow[]): string[] {
  const flags: string[] = [];
  const firstTime = rows.filter((r) => r.typicalCents === null);
  if (firstTime.length > 0) {
    const names = [...new Set(firstTime.map((r) => r.description.trim()))];
    const shown = names.slice(0, 3).join(", ");
    const more = names.length > 3 ? ` and ${names.length - 3} more` : "";
    flags.push(
      `${firstTime.length === 1 ? "First time for this payee" : `${firstTime.length} first-time payees`}: ${shown}${more}`,
    );
  }
  for (const r of rows) {
    if (flags.length >= 3) break;
    if (r.typicalCents === null) continue;
    const c = Math.abs(Math.round(Number(r.amount) * 100));
    if (c > UNUSUAL_RATIO * r.typicalCents) {
      const ratio = Math.round(c / r.typicalCents);
      flags.push(`${r.description.trim()} ${money(c / 100)} is ${ratio}× its usual ${moneyRounded(r.typicalCents / 100)}`);
    }
  }
  return flags.slice(0, 3);
}

/**
 * "Post 23 transactions? $4,310 out · $2,800 in" with the flags, pinned to
 * the bottom of the screen where the toast lives. Post runs what the caller
 * was about to do; Cancel just closes it.
 */
export function PostPreview({
  rows,
  busy = false,
  onPost,
  onCancel,
}: {
  rows: PreviewRow[];
  busy?: boolean;
  onPost: () => void;
  onCancel: () => void;
}) {
  const flags = previewFlags(rows);
  const sums = inOutLabel(rows);
  return (
    <div
      role="dialog"
      aria-label="Confirm posting"
      className="fixed bottom-4 left-1/2 z-40 w-[min(34rem,92vw)] -translate-x-1/2 rounded-xl border border-brass bg-paper p-4 text-ink shadow-xl"
    >
      <p className="text-[13px] font-medium">
        Post {rows.length} transaction{rows.length === 1 ? "" : "s"}?
        {sums ? <span className="figures ml-2 font-normal text-mute">{sums}</span> : null}
      </p>
      {flags.length > 0 ? (
        <ul className="mt-2 space-y-1 border-l-[3px] border-warning-line pl-3 text-[12px] text-warning-text">
          {flags.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          autoFocus
          disabled={busy}
          onClick={onPost}
          className="rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
        >
          {busy ? "Posting…" : "Post"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="rounded-md border border-line-strong px-3 py-1.5 text-[12px] text-ink hover:bg-fill disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
