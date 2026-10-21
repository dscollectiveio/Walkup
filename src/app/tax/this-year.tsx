"use client";

import { useState, useTransition } from "react";
import { Answer } from "@/components/ui";
import { btnPrimary, btnSecondary } from "@/components/repairs/styles";
import { ESTIMATED_NOTE, dateWords } from "@/lib/tax/copy";
import { nextDeadline, type Deadline } from "@/lib/tax/deadlines";
import type { FormCode } from "@/lib/tax/determine";

/**
 * The one answer at the top of the Taxes tab: what needs the board right now,
 * in this order — a missing EIN, unclassified income, a missing W-9, an
 * overdue form, the next date within 90 days, or nothing until a month. The
 * decision is pure (thisYearAnswer) and runs in the browser on a small
 * serializable input, so the page can pass the deadlines straight through and
 * a test can check the order without rendering anything.
 */
export interface ThisYearInput {
  todayIso: string;
  ein: string | null;
  unconfirmedIncomeAccounts: string[];
  /** Contractors at or above the 1099 threshold with no W-9 on file. */
  missingW9: string[];
  /** ctx.deadlines — every open deadline for the filing year, soonest first. */
  deadlines: Deadline[];
  accountantSet: boolean;
  /** Per started form, keyed like a deadline: what its next step depends on. */
  forms: Record<string, { hasPdfTemplate: boolean; openLines: number; sent: boolean }>;
}

export type NextStep =
  | { label: string; href: string }
  | { label: string; start: { formCode: FormCode; taxYear: number; vendorId: string | null } };

export interface ThisYearAnswer {
  status: "good" | "attention" | "bad" | "neutral";
  headline: string;
  detail: string | null;
  step: NextStep | null;
}

/** How many days until a form is due, as the board would say it. */
export const START_WINDOW_DAYS = 90;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "April 2027" from "2027-04-15". */
function monthWords(iso: string): string {
  const [y, m] = iso.slice(0, 10).split("-").map(Number);
  return m >= 1 && m <= 12 ? `${MONTHS[m - 1]} ${y}` : iso;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The board's next move on one deadline: start it, send it to the accountant,
 * confirm the lines, export and sign, or record that it was filed. A form
 * Walkup never fills (no PDF template) has nothing to confirm, so once it is
 * started the step is to mark it filed.
 */
export function nextStepFor(d: Deadline, input: Pick<ThisYearInput, "forms" | "accountantSet">): NextStep | null {
  const form = input.forms[d.key] ?? { hasPdfTemplate: false, openLines: 0, sent: false };
  switch (d.status) {
    case "not_started":
      return { label: `Start ${d.name}`, start: { formCode: d.formCode, taxYear: d.taxYear, vendorId: d.vendorId ?? null } };
    case "ready_to_sign":
      return { label: d.formCode === "irs_1099_nec" ? "Export the contractor's copies" : "Export, sign and file", href: d.href };
    case "filed":
      return null;
    default: {
      if (input.accountantSet && !form.sent) return { label: "Send it to your accountant", href: d.href };
      if (form.openLines > 0 || form.hasPdfTemplate) return { label: "Confirm each line", href: d.href };
      return { label: "Mark it filed", href: d.href };
    }
  }
}

export function thisYearAnswer(input: ThisYearInput): ThisYearAnswer {
  if (!input.ein) {
    return {
      status: "attention",
      headline: "Needs you: add your EIN",
      detail: "Every federal form asks for the association's employer identification number. Add it in Building & Owners.",
      step: { label: "Add your EIN", href: "/building" },
    };
  }
  const unconfirmed = input.unconfirmedIncomeAccounts.length;
  if (unconfirmed > 0) {
    return {
      status: "attention",
      headline: `Needs you: classify ${plural(unconfirmed, "income account")}`,
      detail: "Walkup can't run the 1120-H check until a board member confirms which income is owner fees and which isn't. It takes one click per account.",
      step: { label: "Classify your income", href: "#income" },
    };
  }
  if (input.missingW9.length > 0) {
    const [first, ...rest] = input.missingW9;
    return {
      status: "attention",
      headline: `Needs you: get a W-9 from ${first}${rest.length > 0 ? ` and ${plural(rest.length, "other")}` : ""}`,
      detail: "They were paid at or above the 1099 threshold this year, and their 1099-NEC needs the taxpayer ID from the W-9. Ask now rather than in January.",
      step: { label: "Open Contractors", href: "/repairs?view=contractors" },
    };
  }

  const overdue = input.deadlines.find((d) => d.overdue && d.dueOn && d.status !== "filed");
  if (overdue?.dueOn) {
    const step = nextStepFor(overdue, input);
    const tail = " If it was filed outside Walkup, mark it filed on the form page so this clears.";
    if (overdue.basis === "verified") {
      return {
        status: "bad",
        headline: `Overdue: ${overdue.name} was due ${dateWords(overdue.dueOn)}`,
        detail: `${overdue.citation ? `From ${overdue.citation}.` : "From a rule a person has checked."}${tail}`,
        step,
      };
    }
    return {
      status: "attention",
      headline: `${overdue.name} may be overdue, estimated`,
      detail: `Walkup's estimate was ${dateWords(overdue.dueOn)}. ${ESTIMATED_NOTE}${tail}`,
      step,
    };
  }

  const next = nextDeadline(input.deadlines);
  if (next?.dueOn && next.daysLeft !== null && next.daysLeft <= START_WINDOW_DAYS) {
    const step = nextStepFor(next, input);
    const when = next.daysLeft === 0 ? "today" : plural(next.daysLeft, "day");
    const basis = next.basis === "verified" ? (next.citation ? `From ${next.citation}.` : "From a rule a person has checked.") : ESTIMATED_NOTE;
    return {
      status: "neutral",
      headline: `${next.name} is due ${dateWords(next.dueOn)}, ${when}`,
      detail: `${basis}${step ? ` Next step: ${step.label.toLowerCase()}.` : ""}`,
      step,
    };
  }

  if (next?.dueOn) {
    // Quiet until the first thing to do: the send/start milestone if one is
    // ahead, otherwise the due month itself.
    const milestone = next.milestones.map((m) => m.on).filter((on) => on >= input.todayIso).sort()[0] ?? null;
    const firstMove = next.milestones.find((m) => m.on === milestone) ?? null;
    return {
      status: "good",
      headline: `Nothing to do until ${monthWords(milestone ?? next.dueOn)}`,
      detail: `${next.name} is due ${dateWords(next.dueOn)}${next.basis === "verified" ? "" : " (estimated)"}.${firstMove ? ` ${firstMove.label} by ${dateWords(firstMove.on)}.` : ""}`,
      step: null,
    };
  }

  return {
    status: "good",
    headline: "Nothing on the calendar yet",
    detail:
      input.deadlines.length > 0
        ? "Walkup can't work out a due date for this year's forms yet. The cards below say why. Ask your CPA what applies."
        : "No form has a due date Walkup can work out yet. Ask your CPA what applies this year.",
    step: null,
  };
}

const STATUS_WORDS: Record<Deadline["status"], string> = {
  not_started: "not started",
  started: "started",
  with_accountant: "with your accountant",
  ready_to_sign: "ready to sign",
  filed: "filed",
};

const primary = btnPrimary;
const secondary = btnSecondary;

export function ThisYear({
  input,
  calendarHref,
  boardHref,
  boardNote,
  canWrite,
  onStart,
}: {
  input: ThisYearInput;
  calendarHref: string;
  /** mailto: to the other board members; null when there is nobody else with an email on file. */
  boardHref: string | null;
  boardNote: string | null;
  canWrite: boolean;
  /** startForm, passed from the page so this module stays free of server imports. */
  onStart: (formCode: string, taxYear: number, vendorId: string | null) => Promise<{ error?: string } | undefined>;
}) {
  // The things to do before the tab works well (EIN, income classification, W-9s) have their own section
  // above (SetupChecklist), so this banner speaks to the dates.
  const answer = thisYearAnswer({ ...input, ein: input.ein ?? "on file", unconfirmedIncomeAccounts: [], missingW9: [] });
  const [showAll, setShowAll] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const step = answer.step;

  let stepButton: React.ReactNode = null;
  if (step && "href" in step) {
    stepButton = (
      <a href={step.href} className={primary}>
        {step.label}
      </a>
    );
  } else if (step && canWrite) {
    stepButton = (
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await onStart(step.start.formCode, step.start.taxYear, step.start.vendorId);
            if (r?.error) setError(r.error);
          })
        }
        className={primary}
      >
        {pending ? "Starting…" : step.label}
      </button>
    );
  }

  return (
    <section id="this-year" className="space-y-3">
      <Answer status={answer.status} headline={answer.headline} detail={answer.detail ?? undefined}>
        <div className="flex flex-wrap items-center gap-2">
          {stepButton}
          <a href={calendarHref} className={secondary}>
            Add these dates to your calendar
          </a>
          <a href={boardHref ?? undefined} aria-disabled={boardHref ? undefined : true} className={`${secondary} ${boardHref ? "" : "pointer-events-none opacity-50"}`}>
            Send the dates to the board
          </a>
          <button type="button" onClick={() => setShowAll((v) => !v)} className="text-[13px] font-medium text-ink underline underline-offset-2">
            {showAll ? "Hide the dates" : "See every date →"}
          </button>
        </div>
        {error ? <p className="mt-2 text-[12px] text-bad-text">{error}</p> : null}
        {boardNote ? <p className="mt-2 text-[11px] text-mute">{boardNote}</p> : null}
        {showAll ? (
          <ul className="mt-3 divide-y divide-line border-t border-line text-[13px]">
            {input.deadlines.length === 0 ? <li className="py-2 text-mute">No dates yet.</li> : null}
            {input.deadlines.map((d) => (
              <li key={d.key} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
                <span className="min-w-0">
                  <a href={d.href} className="font-medium text-ink underline-offset-2 hover:underline">
                    {d.name}
                  </a>
                  <span className="text-mute">
                    {" "}
                    · {d.kind} · {STATUS_WORDS[d.status]}
                  </span>
                  {d.milestones.map((m) => (
                    <span key={m.key} className="block text-[11px] text-mute-soft">
                      {m.label} by {dateWords(m.on)}
                    </span>
                  ))}
                </span>
                <span className={`tabular text-[12px] ${d.overdue ? "font-medium text-bad-text" : "text-mute"}`}>
                  {d.dueOn ? (
                    <>
                      {dateWords(d.dueOn)}
                      {d.basis === "verified" ? (d.citation ? ` · ${d.citation}` : "") : " · estimated, not yet checked"}
                      {d.overdue ? " · overdue" : ""}
                    </>
                  ) : (
                    "not on file, ask your CPA"
                  )}
                </span>
                {!d.dueOn && d.note ? <span className="w-full text-[11px] text-mute-soft">{d.note}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </Answer>
    </section>
  );
}
