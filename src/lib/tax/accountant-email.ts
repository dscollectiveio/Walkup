// The email to the association's accountant is a mailto: draft the board
// member opens in their own mail app. Walkup has no email-sending service,
// so nothing here sends anything — and a draft can't carry attachments, so
// the body names the files the person just downloaded instead. Pure.
//
// Three drafts: the 1120-H figures for review, the 1099-NEC contractor list,
// and an early-season heads-up. Every figure says nobody has checked it
// until a person has; every estimated date says "estimated"; and nothing
// shaped like a TIN, EIN or account number is ever written into the body — a
// mailto URL travels through the browser and the mail app in plain text. The
// body is kept under EMAIL_BODY_MAX so the URL opens in every mail client.

import { dateWords, scrubIdentifiers } from "./copy";
import type { DeadlineBasis } from "./deadlines";
import { formatMoney } from "./form1120h";

export type EmailVariant = "1120h" | "1099" | "heads_up";

/** One 1120-H test as the email reads it. */
export interface EmailTest {
  ratio: number | null;
  threshold: number;
  passed: boolean;
  /** Whether a person has checked the threshold against this year's instructions. */
  verified: boolean;
}

export interface AccountantEmailInput {
  variant: EmailVariant;
  association: { legalName: string; displayName: string };
  accountant: { firstName: string | null; email: string | null } | null;
  fiscalYear: { label: string; startsOn: string; endsOn: string };
  /** The fiscal year's tax year for 1120-H; the payment year for 1099s. */
  taxYear: number;
  figures: {
    exemptIncomeCents: number;
    nonexemptIncomeCents: number;
    grossIncomeCents: number;
    exemptExpendituresCents: number;
    totalExpendituresCents: number;
    nonexemptByAccount: { name: string; cents: number }[];
  };
  /** Null when the test thresholds aren't on file. */
  tests: { income: EmailTest; expenditure: EmailTest } | null;
  /** Walkup's provisional estimate (nonexempt income less the specific deduction, at the condo rate); null when a parameter isn't on file. */
  estimatedTaxCents: number | null;
  /** True when every tax_parameters row behind the estimate has a verified_on date. */
  parametersVerified: boolean;
  /** The rate and deduction behind the estimate, so the body can name them without a number written into code. */
  parameters?: { rateCondo: number | null; specificDeductionCents: number | null } | null;
  /** The deadline this draft is about: the 1120-H for 1120h/heads_up, the 1099-NEC for 1099. */
  due: { on: string | null; basis: DeadlineBasis; citation: string | null };
  /** Contractors paid for services in the payment year. The list is written as given, largest first. */
  contractors: { name: string; totalCents: number; w9OnFile: boolean }[];
  /** The 1099-NEC threshold as of Dec 31 of the payment year; null or absent when it isn't on file. */
  threshold?: { cents: number; verified: boolean } | null;
  /** Every deadline, for the heads-up list; when absent the 1120-H `due` stands alone. */
  deadlines?: { name: string; dueOn: string | null; basis: DeadlineBasis }[];
  openItems: string[];
  /** Filenames the person just downloaded — the draft can't attach them, so it names them. */
  attachments: string[];
  senderName: string;
}

/** Longest body a mailto: link reliably opens with (some clients drop the body near 2,000 characters of URL). */
export const EMAIL_BODY_MAX = 1_800;

const CARD_NOTE =
  "(Our contractor payment totals include every payment we recorded; tell us if any were by card, which the processor reports instead.)";
const NOT_FILED = "Nothing has been filed. The board will review your changes before signing.";

/** How much detail a rendering may use; stepped down until the body fits. */
interface Limits {
  items: number;
  itemChars: number;
  accounts: number;
  citationChars: number;
  attachments: number;
  contractors: number;
}

const LADDER: Limits[] = [
  { items: 5, itemChars: 140, accounts: 4, citationChars: 120, attachments: 6, contractors: 8 },
  { items: 5, itemChars: 90, accounts: 3, citationChars: 60, attachments: 4, contractors: 8 },
  { items: 3, itemChars: 60, accounts: 2, citationChars: 40, attachments: 3, contractors: 6 },
  { items: 0, itemChars: 0, accounts: 0, citationChars: 0, attachments: 2, contractors: 4 },
];

const money = formatMoney;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "95%" or "94.3%"; null when there's nothing to divide by. */
function pct(ratio: number | null): string | null {
  if (ratio === null) return null;
  return `${(ratio * 100).toFixed(1).replace(/\.0$/, "")}%`;
}

const needs = (threshold: number) => `${Math.round(threshold * 100)}%`;

function clip(text: string, max: number): string {
  const t = text.trim();
  if (max <= 0) return "";
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** ISO date minus a number of days, done in UTC so no local offset can move the day. */
function minusDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d - days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

function greeting(input: AccountantEmailInput): string {
  const first = input.accountant?.firstName?.trim();
  return `Hi ${first || "there"},`;
}

function signoff(input: AccountantEmailInput): string[] {
  const who = [input.senderName.trim(), input.association.displayName].filter(Boolean).join(", ");
  return ["Thanks,", who];
}

function dueLine(due: AccountantEmailInput["due"], citationChars: number): string {
  if (!due.on) return "Due date: not on file. Can you confirm it?";
  const when = dateWords(due.on);
  if (due.basis === "verified") {
    const cite = due.citation ? clip(due.citation, citationChars) : "";
    return `Due date on file: ${when}${cite ? ` (${cite})` : ""}`;
  }
  return `Due date on file: ${when} (estimated, please confirm)`;
}

function openItemsBlock(items: string[], limits: Limits): string[] {
  const shown = items.map((s) => s.trim()).filter(Boolean).slice(0, limits.items);
  if (shown.length === 0) return [];
  return ["Open items:", ...shown.map((s) => `- ${clip(s, limits.itemChars)}`)];
}

function attachmentsBlock(attachments: string[], limits: Limits): string[] {
  const names = attachments.map((s) => s.trim()).filter(Boolean);
  if (names.length === 0) return ["I'll send the files separately."];
  const shown = names.slice(0, limits.attachments);
  const more = names.length - shown.length;
  return ["I'm attaching:", ...shown.map((n) => `- ${n}`), ...(more > 0 ? [`- and ${more} more`] : [])];
}

/** The contractors at or above the threshold — or everyone given, when the caller already filtered and no threshold is on file. */
function overThreshold(input: AccountantEmailInput) {
  const t = input.threshold;
  return t ? input.contractors.filter((c) => c.totalCents >= t.cents) : input.contractors;
}

function body1120h(input: AccountantEmailInput, limits: Limits): string[] {
  const f = input.figures;
  const t = input.tests;
  const incomeRatio = t ? t.income.ratio : f.grossIncomeCents > 0 ? f.exemptIncomeCents / f.grossIncomeCents : null;
  const spendRatio = t ? t.expenditure.ratio : f.totalExpendituresCents > 0 ? f.exemptExpendituresCents / f.totalExpendituresCents : null;
  // "97.5% of $49,250.00 gross income" — the denominator is named so all five figures are in the body.
  const share = (ratio: number | null, totalCents: number, of: string) =>
    ratio === null ? `n/a, no ${of} recorded` : `${pct(ratio)} of ${money(totalCents)} ${of}`;
  const needsWords = (test: EmailTest | undefined) => (test ? ` (needs ${needs(test.threshold)})` : " (test threshold not on file in Walkup)");

  const byAccount = [...f.nonexemptByAccount]
    .filter((a) => a.cents !== 0)
    .sort((a, b) => b.cents - a.cents);
  const shownAccounts = byAccount.slice(0, limits.accounts);
  const moreAccounts = byAccount.length - shownAccounts.length;
  const accountWords =
    shownAccounts.length === 0
      ? ""
      : ` (${shownAccounts.map((a) => `${a.name} ${money(a.cents)}`).join(", ")}${moreAccounts > 0 ? `, and ${moreAccounts} more` : ""})`;

  const p = input.parameters;
  const rateWords = p?.rateCondo != null ? `${needs(p.rateCondo)} rate` : "tax rate";
  const deductionWords = p?.specificDeductionCents != null ? `${money(p.specificDeductionCents)} specific deduction` : "specific deduction";
  const estimate =
    input.estimatedTaxCents === null
      ? "not available. The rate or specific deduction isn't on file in Walkup; please work it out from this year's instructions"
      : `${money(input.estimatedTaxCents)} (provisional; the ${rateWords} and ${deductionWords} are ${input.parametersVerified ? "checked" : "not yet checked"} against this year's instructions)`;

  return [
    greeting(input),
    "",
    `Here are ${input.association.legalName}'s figures for Form 1120-H, fiscal year ${dateWords(input.fiscalYear.startsOn)} to ${dateWords(input.fiscalYear.endsOn)}, worked out on a cash basis from our books in Walkup. Nobody has checked them against this year's IRS instructions yet, that's what we're asking you to do.`,
    "",
    `Owner fees (exempt function income): ${money(f.exemptIncomeCents)}, ${share(incomeRatio, f.grossIncomeCents, "gross income")}${needsWords(t?.income)}`,
    `Spending on the building (exempt function expenditures): ${money(f.exemptExpendituresCents)}, ${share(spendRatio, f.totalExpendituresCents, "total spending")}${needsWords(t?.expenditure)}`,
    `Income that isn't owner fees: ${money(f.nonexemptIncomeCents)}${accountWords}`,
    `Walkup's estimate of tax due before any deductions: ${estimate}`,
    dueLine(input.due, limits.citationChars),
    "",
    ...openItemsBlock(input.openItems, limits),
    "",
    ...attachmentsBlock(input.attachments, limits),
    CARD_NOTE,
    "",
    NOT_FILED,
    "",
    ...signoff(input),
  ];
}

function body1099(input: AccountantEmailInput, limits: Limits): string[] {
  const year = input.taxYear;
  const sorted = [...input.contractors].sort((a, b) => b.totalCents - a.totalCents);
  const shown = sorted.slice(0, limits.contractors);
  const more = sorted.length - shown.length;
  const list =
    sorted.length === 0
      ? ["- nobody. We recorded no contractor payments for services"]
      : [
          ...shown.map((c) => `- ${c.name}: ${money(c.totalCents)}, W-9 on file: ${c.w9OnFile ? "yes" : "no"}`),
          ...(more > 0 ? [`- and ${more} more`] : []),
        ];

  const t = input.threshold;
  const over = overThreshold(input).length;
  const thresholdWords = t
    ? `The reporting threshold for payments made in ${year} is ${money(t.cents)} per contractor (${t.verified ? "checked" : "not yet checked"} against this year's instructions), and ${over} of the ${sorted.length} ${over === 1 ? "is" : "are"} at or above it.`
    : `The reporting threshold for payments made in ${year} isn't on file in Walkup. Can you tell us which of these need a 1099?`;

  return [
    greeting(input),
    "",
    `Here's who ${input.association.legalName} paid for services in ${year}, from our books in Walkup, for Form 1099-NEC:`,
    "",
    ...list,
    "",
    thresholdWords,
    "",
    "Their TINs are on the W-9s, which I'll send separately. Walkup stores only the last four digits. Copy A can't be printed from the IRS PDF. Should we file through IRIS or do you handle that?",
    "",
    dueLine(input.due, limits.citationChars),
    "",
    ...openItemsBlock(input.openItems, limits),
    "",
    ...attachmentsBlock(input.attachments, limits),
    CARD_NOTE,
    "",
    NOT_FILED,
    "",
    ...signoff(input),
  ];
}

function bodyHeadsUp(input: AccountantEmailInput): string[] {
  const deadlines = input.deadlines ?? [{ name: "Form 1120-H", dueOn: input.due.on, basis: input.due.basis }];
  const dates = deadlines.map((d) =>
    d.dueOn
      ? `- ${d.name}: ${dateWords(d.dueOn)}${d.basis === "verified" ? "" : " (estimated)"}`
      : `- ${d.name}: not on file. Can you confirm it?`,
  );

  const over = overThreshold(input);
  const missing = over.filter((c) => !c.w9OnFile).length;
  const thresholdCaveat = input.threshold && !input.threshold.verified ? " (threshold not yet checked against this year's instructions)" : "";
  const contractorWords =
    over.length === 0
      ? `No contractor is at or above the 1099 threshold so far${thresholdCaveat}.`
      : `${plural(over.length, "contractor")} ${over.length === 1 ? "is" : "are"} at or above the 1099 threshold so far${thresholdCaveat}; ${missing === 0 ? "every W-9 is on file" : `${plural(missing, "W-9")} still outstanding`}.`;

  const sendBy = input.due.on
    ? `We'll send the 1120-H figures by ${dateWords(minusDays(input.due.on, 60))}, worked out on a cash basis from our books in Walkup, for you to check against this year's instructions.`
    : "We'll send the 1120-H figures once the year's books are closed. Can you confirm the due date?";

  return [
    greeting(input),
    "",
    `A heads-up on ${input.association.legalName}'s tax season so you can plan. Nothing needs doing yet.`,
    "",
    "Dates on our list:",
    ...dates,
    "",
    contractorWords,
    "",
    sendBy,
    "",
    "Nothing on this list has been filed yet.",
    "",
    ...signoff(input),
  ];
}

function subjectFor(input: AccountantEmailInput): string {
  const name = input.association.displayName;
  switch (input.variant) {
    case "1120h":
      return `${name}: Form 1120-H ${input.taxYear}: figures for your review`;
    case "1099":
      return `${name}: 1099-NEC contractor list for ${input.taxYear}`;
    default:
      return `${name}: what's coming this tax season`;
  }
}

function render(input: AccountantEmailInput, limits: Limits): string {
  const lines =
    input.variant === "1120h" ? body1120h(input, limits)
    : input.variant === "1099" ? body1099(input, limits)
    : bodyHeadsUp(input);
  // Collapse the blank lines left by empty blocks so paragraphs stay one apart.
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return scrubIdentifiers(text);
}

/**
 * The subject and body for one draft. The body is rendered with less and
 * less detail (fewer open items, shorter citation, fewer accounts named)
 * until it fits EMAIL_BODY_MAX; the hard cut at the end is only reachable
 * with an absurd input and is there so the limit is a guarantee, not a hope.
 */
export function accountantEmail(input: AccountantEmailInput): { subject: string; body: string } {
  const subject = scrubIdentifiers(subjectFor(input));
  let body = "";
  for (const limits of LADDER) {
    body = render(input, limits);
    if (body.length <= EMAIL_BODY_MAX) break;
  }
  if (body.length > EMAIL_BODY_MAX) body = `${body.slice(0, EMAIL_BODY_MAX - 1).trimEnd()}…`;
  return { subject, body };
}

/**
 * A mailto: link, with or without a recipient (no accountant on file still
 * opens a draft). The shared builder: CRLF line breaks per RFC 6068, each
 * recipient encoded, optional Cc/Bcc.
 */
export { mailtoHref } from "@/lib/email/mailto";
