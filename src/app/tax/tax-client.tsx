"use client";

import { useState, useTransition } from "react";
import { btnPrimary } from "@/components/repairs/styles";
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
  /** The date alone, for the column on the right of the card; null when there is no date to show. */
  dueDate: { label: string; tone: CardTone; caption: string } | null;
  /** How to find the real date, and what to set in Walkup so it can be worked out; null for a checked date. */
  dueGuide: { how: string; set: { label: string; href: string }[] } | null;
  /** Numbers to type into the form or the portal, shown with a copy button (EIN, Illinois file number). */
  copyables: { label: string; value: string }[];
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

const primaryBtn = btnPrimary;
// Every button on a form card is a filled blue button with white text.
const secondaryBtn = btnPrimary;

export function FormCard({ view, canWrite, children }: { view: FormCardView; canWrite: boolean; children?: React.ReactNode }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const d = DETERMINATION[view.determination] ?? DETERMINATION.ask_cpa;
  const a = view.action;
  // The reason can run long (it carries the test figures): the first sentence shows, the rest sits under "More".
  const reasonSplit = view.reason.match(/^(.+?[.!?])(\s+[\s\S]*)?$/);
  const reasonFirst = reasonSplit ? reasonSplit[1] : view.reason;
  const reasonRest = reasonSplit?.[2]?.trim() ?? "";

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
    <div className={`overflow-hidden rounded-xl border border-line bg-paper ${view.muted ? "opacity-70" : ""}`}>
      {/* A lighter blue header band for each form, so the cards read as a list of forms. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-ink/[0.09] px-4 py-2.5">
        <span className="text-[15px] font-bold text-ink">{view.title}</span>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${d.cls}`}>{d.label}</span>
        {/* The due date, on the right of the header bar. */}
        <div className="ml-auto text-right">
          {view.dueDate ? (
            <p className={`text-[14px] font-bold tabular ${TONE[view.dueDate.tone]}`}>
              <span className="mr-1.5 text-[11px] font-medium uppercase tracking-wide text-mute">Due</span>
              {view.dueDate.label}
              <span className="ml-2 text-[11px] font-normal text-mute">{view.dueDate.caption}</span>
            </p>
          ) : (
            <p className="text-[12px] text-mute">{view.muted ? "Not required" : "No due date on file"}</p>
          )}
        </div>
      </div>
      <div className="flex flex-col md:flex-row md:items-stretch">
        {/* Left: plain words, in short blocks. */}
        <div className="min-w-0 flex-1 divide-y divide-line px-4">
          <div className="space-y-1 py-3 text-[13px]">
            <p className="text-ink">
              <span className="font-semibold">What this does:</span> {view.plain}.
            </p>
            <p className="text-ink">
              <span className="font-semibold">Why it applies:</span> {reasonFirst}
            </p>
            {reasonRest || view.note ? (
              <details className="text-mute">
                <summary className="cursor-pointer text-[12px] font-medium text-ink underline underline-offset-2">More</summary>
                {reasonRest ? <p className="mt-1">{reasonRest}</p> : null}
                {view.note ? <p className="mt-1">{view.note}</p> : null}
              </details>
            ) : null}
          </div>
          {view.warnings.length > 0 ? (
            <div className="space-y-1 py-3 text-[13px] text-warning-text">
              {view.warnings.map((w) => (
                <p key={w}>
                  <span className="font-semibold">Watch out:</span> {w}
                </p>
              ))}
            </div>
          ) : null}
          <div className="py-3 text-[13px] text-mute">
            <span className="font-semibold text-ink">Official links:</span>{" "}
            {view.links.length === 0 ? (
              "none on file yet."
            ) : (
              <>
                {view.links.map((l, i) => (
                  <span key={l.href}>
                    {i > 0 ? " · " : ""}
                    <a href={l.href} target="_blank" rel="noreferrer" title={l.words} className="text-ink underline underline-offset-2 hover:no-underline">
                      {l.label} ↗<span className="sr-only"> ({l.words})</span>
                    </a>
                  </span>
                ))}
                {view.linksWords ? <span className="text-mute-soft"> ({view.linksWords})</span> : null}
              </>
            )}
          </div>
          <div className={`py-3 text-[13px] ${TONE[view.status.tone]}`}>
            <span className="font-semibold">Where you are:</span> {view.status.text}
            {children ? <div className="mt-2">{children}</div> : null}
          </div>
        </div>
        {/* Right: the date, the numbers to copy, and the buttons. */}
        <div className="flex shrink-0 flex-col gap-3 border-t border-line px-4 py-3 md:w-72 md:border-l md:border-t-0">
          {view.dueGuide ? (
            <p className="text-[12px] text-ink">
              {view.dueGuide.how}
              {view.dueGuide.set.map((st) => (
                <span key={st.href}>
                  {" "}
                  <a href={st.href} className="font-medium text-ink underline underline-offset-2 hover:no-underline">
                    {st.label} →
                  </a>
                </span>
              ))}
            </p>
          ) : null}
          {view.copyables.length > 0 ? (
            <ul className="space-y-1.5">
              {view.copyables.map((c) => (
                <li key={c.label}>
                  <CopyValue label={c.label} value={c.value} />
                </li>
              ))}
            </ul>
          ) : null}
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
      </div>
    </div>
  );
}

/** A number the board types into a form or a portal (an EIN, a file number), with a one-click copy. */
export function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Older browsers: select-and-copy through a temporary field.
      const t = document.createElement("textarea");
      t.value = value;
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      document.body.removeChild(t);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-fill/40 px-2.5 py-1.5">
      <div className="min-w-0">
        <p className="text-[10px] font-medium uppercase tracking-wide text-mute">{label}</p>
        <p className="figures truncate text-[13px] font-medium text-ink">{value}</p>
      </div>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label}`}
        className="shrink-0 rounded-md border border-line-strong bg-paper px-2 py-1 text-[11px] font-medium text-ink hover:bg-fill"
      >
        {copied ? "Copied" : "Copy"}
      </button>
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
              Suggested: {isExempt ? "member income (exempt)" : "not member income (taxable)"}, not yet confirmed
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
          Member income is what owners pay as owners: dues, assessments, their late fees. Interest, rent from outsiders,
          and laundry or vending usually isn&rsquo;t. If unsure, ask your CPA.
        </p>
      ) : null}
    </li>
  );
}
