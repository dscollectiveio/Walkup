"use client";

import { useState, useTransition } from "react";
import { confirmIncomeClassification, startForm } from "./form-actions";

/** The determination pill. `eligible` is the 1120-H election: both tests pass, the board chooses to file it. */
const DETERMINATION: Record<string, { label: string; cls: string }> = {
  required: { label: "Required", cls: "border-info-line bg-info-tint text-info-text" },
  likely_required: { label: "Likely required", cls: "border-warning-line bg-warning-tint text-warning-text" },
  eligible: { label: "You qualify", cls: "border-info-line bg-info-tint text-info-text" },
  optional: { label: "Optional", cls: "border-line bg-fill text-mute" },
  not_required: { label: "Not required", cls: "border-line bg-fill text-mute" },
  ask_cpa: { label: "Ask your CPA", cls: "border-warning-line bg-warning-tint text-warning-text" },
};

export type CardTone = "ink" | "mute" | "warning" | "bad" | "good";

const TONE: Record<CardTone, string> = {
  ink: "text-ink",
  mute: "text-mute",
  warning: "text-warning-text",
  bad: "text-bad-text",
  good: "text-good-text",
};

/** One official link on a card, with the words that say who has checked it. */
export interface CardLink {
  label: string;
  href: string;
  /** linkStatusWords() for this link — on hover and for screen readers. */
  words: string;
}

export type CardAction =
  | { kind: "filed"; href: string; label: string }
  | { kind: "link"; href: string; label: string; primary: boolean }
  /** Starts the form (startForm) and opens its page. */
  | { kind: "start"; label: string; primary: boolean }
  | { kind: "none" };

/**
 * Everything a form card shows, worded on the server from the one tax
 * context so the card can't disagree with the deadlines list or the form
 * page. The card itself only renders and starts.
 */
export interface FormCardView {
  key: string;
  formCode: string;
  taxYear: number;
  vendorId: string | null;
  title: string;
  plain: string;
  determination: string;
  reason: string;
  /** The verified template's notes, when there is one. */
  note: string | null;
  warnings: string[];
  /** "Due April 15, 2027 (citation)" / "Estimated … — not yet checked" / "Due date not on file — ask your CPA." */
  due: { text: string; tone: CardTone } | null;
  links: CardLink[];
  /** The words after the links: "checked Oct 11, 2026" / "retrieved … · not yet checked by a person". */
  linksWords: string | null;
  status: { text: string; tone: CardTone };
  action: CardAction;
  /** "File online ↗" beside the action, for forms filed on a portal. */
  fileOnline: CardLink | null;
  /** not_required forms stay on the list, quietly. */
  muted: boolean;
}

const btn = "inline-flex min-h-[44px] items-center rounded-md px-4 text-[13px] font-medium disabled:opacity-50";
const primaryBtn = `${btn} bg-ink text-paper hover:bg-ink-mid`;
const secondaryBtn = `${btn} border border-line-strong bg-paper text-ink hover:bg-fill`;

export function FormCard({ view, canWrite, children }: { view: FormCardView; canWrite: boolean; children?: React.ReactNode }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const d = DETERMINATION[view.determination] ?? DETERMINATION.ask_cpa;
  const a = view.action;

  let action: React.ReactNode = null;
  if (a.kind === "filed") {
    action = (
      <a href={a.href} className="text-[13px] text-good-text underline underline-offset-2">
        {a.label}
      </a>
    );
  } else if (a.kind === "link") {
    action = (
      <a href={a.href} className={a.primary ? primaryBtn : secondaryBtn}>
        {a.label}
      </a>
    );
  } else if (a.kind === "start" && canWrite) {
    action = (
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await startForm(view.formCode, view.taxYear, view.vendorId);
            if (r?.error) setError(r.error);
          })
        }
        className={a.primary ? primaryBtn : secondaryBtn}
      >
        {pending ? "Starting…" : a.label}
      </button>
    );
  }

  return (
    <div className={`flex flex-col justify-between gap-3 rounded-xl border border-line bg-paper px-4 py-4 ${view.muted ? "opacity-70" : ""}`}>
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[14px] font-medium text-ink">{view.title}</span>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] ${d.cls}`}>{d.label}</span>
        </div>
        <p className="mt-0.5 text-[12px] text-mute">{view.plain}</p>
        <p className="mt-2 text-[12px] text-ink">{view.reason}</p>
        {view.due ? <p className={`mt-1 text-[12px] ${TONE[view.due.tone]}`}>{view.due.text}</p> : null}
        {view.note ? <p className="mt-1 text-[12px] text-mute">{view.note}</p> : null}
        {view.warnings.map((w) => (
          <p key={w} className="mt-1 text-[12px] text-warning-text">
            {w}
          </p>
        ))}
        <p className="mt-2 text-[12px] text-mute">
          {view.links.length === 0 ? (
            "Walkup has no links on file for this form yet."
          ) : (
            <>
              {view.links.map((l, i) => (
                <span key={l.href}>
                  {i > 0 ? " · " : ""}
                  <a href={l.href} target="_blank" rel="noreferrer" title={l.words} className="text-ink underline-offset-2 hover:underline">
                    {l.label} ↗<span className="sr-only"> ({l.words})</span>
                  </a>
                </span>
              ))}
              {view.linksWords ? <span className="text-mute-soft"> — {view.linksWords}</span> : null}
            </>
          )}
        </p>
        <p className={`mt-2 text-[12px] font-medium ${TONE[view.status.tone]}`}>{view.status.text}</p>
        {children ? <div className="mt-2">{children}</div> : null}
      </div>
      {action || view.fileOnline ? (
        <div className="flex flex-wrap items-center gap-2">
          {view.fileOnline && a.kind !== "filed" ? (
            <a href={view.fileOnline.href} target="_blank" rel="noreferrer" title={view.fileOnline.words} className={a.kind === "none" ? primaryBtn : secondaryBtn}>
              File online ↗
            </a>
          ) : null}
          {action}
        </div>
      ) : null}
      {error ? <p className="text-[12px] text-bad-text">{error}</p> : null}
    </div>
  );
}

/** Confirm once whether an income account is member income (exempt) or not. Walkup remembers. */
export function ClassifyIncomeRow({
  accountId,
  name,
  total,
  isExempt,
  confirmedAt,
  canWrite,
}: {
  accountId: string;
  name: string;
  total: string;
  isExempt: boolean;
  confirmedAt: string | null;
  canWrite: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const choose = (exempt: boolean) =>
    start(async () => {
      setError(null);
      const r = await confirmIncomeClassification(accountId, exempt);
      if (r.error) setError(r.error);
      else setChanging(false);
    });
  const choice = "min-h-[36px] rounded-md border px-3 text-[12px] font-medium disabled:opacity-50";

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div>
        <div className="text-[13px] font-medium text-ink">{name}</div>
        <div className="text-[12px] text-mute">
          {total} this year ·{" "}
          {confirmedAt ? (
            <span className="text-good-text">
              Confirmed as {isExempt ? "member income (exempt)" : "not member income (taxable)"}
            </span>
          ) : (
            <span className="text-warning-text">
              Suggested: {isExempt ? "member income (exempt)" : "not member income (taxable)"} — not yet confirmed
            </span>
          )}
        </div>
      </div>
      {canWrite && (!confirmedAt || changing) ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={pending} onClick={() => choose(true)} className={`${choice} border-line-strong bg-paper text-ink hover:bg-fill`}>
            Member income
          </button>
          <button type="button" disabled={pending} onClick={() => choose(false)} className={`${choice} border-line-strong bg-paper text-ink hover:bg-fill`}>
            Not member income
          </button>
        </div>
      ) : canWrite ? (
        <button type="button" onClick={() => setChanging(true)} className="text-[12px] text-mute underline underline-offset-2">
          Change
        </button>
      ) : null}
      {error ? <p className="w-full text-[12px] text-bad-text">{error}</p> : null}
      {!confirmedAt && canWrite ? (
        <p className="w-full text-[11px] text-mute">
          Member income is what owners pay as owners — dues, assessments, their late fees. Interest, rent from outsiders,
          and laundry or vending usually isn&rsquo;t. If unsure, ask your CPA.
        </p>
      ) : null}
    </li>
  );
}
