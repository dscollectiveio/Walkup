// Drafted emails to agents, brokers and insurers (insurance-spec §7.4, brief
// decision 8). The model writes prose with placeholders and never sees a
// name, number, amount, date or address: draftFacts() builds what it sees,
// checkModelDraft() guards what comes back, fillPlaceholders() puts the real
// values in, and templateDraft() is the deterministic fallback that always
// works. Nothing here sends anything. Pure.

import { COVERAGE_TYPES, LINE_LABEL, type CoverageType, type LineKey } from "./coverage";
import { constructionLabel } from "./facts";
import { CAUSE_OF_LOSS_FORMS, COVERAGE_FORMS, FIELD_BY_KEY, VALUATIONS, optionLabel } from "./fields";
import { formatMoney, formatPercent, longDate } from "./format";

export const EMAIL_KINDS = [
  "quote_request", "quote_follow_up", "coverage_question", "certificate_request", "claim_report",
  "change_request", "documents_request", "quote_decline",
] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];
/** insurance_messages.kind: the drafted kinds plus a blank email the board writes. */
export type MessageKind = EmailKind | "other";

export const PLACEHOLDERS = [
  "agent_name", "association_name", "building_description", "policy_reference", "details_block", "question",
  "certificate_holder", "loss_details", "change_details", "original_date", "renewal_date", "sender_name", "sender_contact",
] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

export type RecipientKind = "agency" | "broker" | "insurer" | "agent";
export type HolderKind = "mortgage_lender" | "contractor" | "property_manager" | "other";
export type ChangeKind = "add_coverage" | "raise_limit" | "change_deductible" | "add_additional_insured" | "update_address" | "other";
export type FactBasis = "illinois_law" | "our_declaration" | "our_numbers" | "common_practice";

/** What the model sees, per kind (§7.4.2): no digits, no dates, no amounts, no names. */
export interface DraftFactsByKind {
  quote_request: { recipientKind: RecipientKind; isCurrentAgent: boolean; coverages: string[]; renewalKnown: boolean; hasOpenFindings: boolean; findingTopics: string[] };
  quote_follow_up: { recipientKind: RecipientKind; elapsed: "about_a_week" | "two_weeks_plus"; coverages: string[] };
  coverage_question: { recipientKind: RecipientKind; isCurrentAgent: boolean; coverage: string; topic: string; basis: FactBasis };
  certificate_request: { recipientKind: RecipientKind; holderKind: HolderKind; coverages: string[] };
  claim_report: { recipientKind: RecipientKind; coverage: string; linkedToRepair: boolean };
  change_request: { recipientKind: RecipientKind; changeKind: ChangeKind; coverage: string };
  documents_request: { recipientKind: RecipientKind; isCurrentAgent: boolean };
  quote_decline: { recipientKind: RecipientKind; coverages: string[] };
}

/** What the caller knows, per kind; draftFacts() reduces it to DraftFactsByKind. */
export interface DraftInputByKind {
  quote_request: { contactKind: string | null; isCurrentAgent: boolean; coverages: string[]; renewalKnown: boolean; findingLines: LineKey[] };
  quote_follow_up: { contactKind: string | null; daysSinceSent: number; coverages: string[] };
  coverage_question: { contactKind: string | null; isCurrentAgent: boolean; coverage: string; line: LineKey | null; basis: "statute" | "your_documents" | "your_data" | "common_practice" };
  certificate_request: { contactKind: string | null; holderKind: HolderKind; coverages: string[] };
  claim_report: { contactKind: string | null; coverage: string; linkedToRepair: boolean };
  change_request: { contactKind: string | null; changeKind: ChangeKind; coverage: string };
  documents_request: { contactKind: string | null; isCurrentAgent: boolean };
  quote_decline: { contactKind: string | null; coverages: string[] };
}

function recipientKind(k: string | null): RecipientKind {
  return k === "agency" || k === "broker" || k === "insurer" || k === "agent" ? k : "agent";
}

/** "Master policy (building and property)" → "Master policy". No digits in any label. */
export function coverageWords(coverage: string): string {
  const label = COVERAGE_TYPES.find((c) => c.value === coverage)?.label ?? "Other";
  return label.replace(/ \(.*\)$/, "");
}

const BASIS_FACT: Record<DraftInputByKind["coverage_question"]["basis"], FactBasis> = {
  statute: "illinois_law", your_documents: "our_declaration", your_data: "our_numbers", common_practice: "common_practice",
};

/** Belt and braces: a fact string never carries a digit or an "@". */
const clean = (s: string) => s.replace(/[\d@]/g, "").trim();

/** The facts the model sees for a draft (stored in insurance_messages.facts_json). */
export function draftFacts<K extends EmailKind>(kind: K, input: DraftInputByKind[K]): DraftFactsByKind[K] {
  const i = input as DraftInputByKind[EmailKind] & Record<string, unknown>;
  const rk = recipientKind(i.contactKind as string | null);
  const covs = (list: string[]) => [...new Set(list.map(coverageWords))].map(clean);
  let out: DraftFactsByKind[EmailKind];
  switch (kind) {
    case "quote_request": {
      const x = input as DraftInputByKind["quote_request"];
      const topics = [...new Set(x.findingLines.map((l) => LINE_LABEL[l]))].map(clean);
      out = { recipientKind: rk, isCurrentAgent: x.isCurrentAgent, coverages: covs(x.coverages), renewalKnown: x.renewalKnown, hasOpenFindings: topics.length > 0, findingTopics: topics };
      break;
    }
    case "quote_follow_up": {
      const x = input as DraftInputByKind["quote_follow_up"];
      out = { recipientKind: rk, elapsed: x.daysSinceSent >= 14 ? "two_weeks_plus" : "about_a_week", coverages: covs(x.coverages) };
      break;
    }
    case "coverage_question": {
      const x = input as DraftInputByKind["coverage_question"];
      out = { recipientKind: rk, isCurrentAgent: x.isCurrentAgent, coverage: clean(coverageWords(x.coverage)), topic: clean(x.line ? LINE_LABEL[x.line] : coverageWords(x.coverage)), basis: BASIS_FACT[x.basis] };
      break;
    }
    case "certificate_request": {
      const x = input as DraftInputByKind["certificate_request"];
      out = { recipientKind: rk, holderKind: x.holderKind, coverages: covs(x.coverages) };
      break;
    }
    case "claim_report": {
      const x = input as DraftInputByKind["claim_report"];
      out = { recipientKind: rk, coverage: clean(coverageWords(x.coverage)), linkedToRepair: x.linkedToRepair };
      break;
    }
    case "change_request": {
      const x = input as DraftInputByKind["change_request"];
      out = { recipientKind: rk, changeKind: x.changeKind, coverage: clean(coverageWords(x.coverage)) };
      break;
    }
    case "documents_request": {
      const x = input as DraftInputByKind["documents_request"];
      out = { recipientKind: rk, isCurrentAgent: x.isCurrentAgent };
      break;
    }
    default: {
      const x = input as DraftInputByKind["quote_decline"];
      out = { recipientKind: rk, coverages: covs(x.coverages) };
    }
  }
  return out as DraftFactsByKind[K];
}

/** The placeholders a model draft of this kind must use exactly once. */
export function requiredPlaceholders(kind: EmailKind, facts?: { renewalKnown?: boolean }): Placeholder[] {
  switch (kind) {
    case "quote_request":
      return ["details_block", "building_description", "sender_name", ...(facts?.renewalKnown ? (["renewal_date"] as const) : [])];
    case "quote_follow_up":
      return ["original_date", "sender_name"];
    case "coverage_question":
      return ["question", "policy_reference", "sender_name"];
    case "certificate_request":
      return ["certificate_holder", "policy_reference", "sender_name"];
    case "claim_report":
      return ["loss_details", "policy_reference", "sender_name"];
    case "change_request":
      return ["change_details", "policy_reference", "sender_name"];
    case "documents_request":
      return ["association_name", "sender_name"];
    default:
      return ["sender_name"];
  }
}

/**
 * The model's instructions for an insurance email (§7.4.3). It writes prose
 * with placeholders only; code fills them (fillPlaceholders) and guards the
 * result (checkModelDraft). Insurance keeps this drafter instead of
 * Foundation's src/lib/ai/draft.ts so the model never sees a name or figure.
 */
export const DRAFT_SYSTEM = `You write short, polite emails from a volunteer condo board member to their insurance agent, broker or insurer. You get the kind of email and a few facts as JSON.

Write a subject line and an email body in plain English, 70 to 170 words, warm and businesslike, no em dashes.

You never see names, numbers, amounts, dates or addresses. Where one belongs, write the placeholder exactly as listed below; the app fills it in:
{{agent_name}} {{association_name}} {{building_description}} {{policy_reference}} {{details_block}} {{question}} {{certificate_holder}} {{loss_details}} {{change_details}} {{original_date}} {{renewal_date}} {{sender_name}} {{sender_contact}}
Use each required placeholder you are told about exactly once. Do not invent other placeholders. Do not write any digit or dollar sign.

Kinds: quote_request asks for a quote; quote_follow_up checks on an earlier request ("about_a_week" or "two_weeks_plus" since it was sent); coverage_question asks one question about a policy; certificate_request asks for a certificate of insurance; claim_report reports a loss and asks for next steps; change_request asks what a change would involve; documents_request asks for the current declarations pages and the list of forms and endorsements; quote_decline thanks them for a quote and says the board won't be going ahead with it, without giving reasons or figures.

Ask, don't instruct. Never accept, bind, purchase or cancel coverage, never say the board has decided to buy anything, and never promise payment. Do not give or ask for legal advice. Sign off with {{sender_name}} on its own line, followed by {{sender_contact}}.`;

/** The model's user message (§7.4.3): the kind, the placeholders it must use, and the facts. */
export function draftUserMessage(kind: EmailKind, required: readonly string[], facts: unknown): string {
  return JSON.stringify({ kind, requiredPlaceholders: required.map((p) => `{{${p}}}`), facts });
}

const FORBIDDEN: { re: RegExp; words: string }[] = [
  { re: /\bbind(s|ing)?\b/i, words: "bind" },
  { re: /\bwe accept\b/i, words: "we accept" },
  { re: /\bwe['’]ll take\b/i, words: "we'll take" },
  { re: /\bplease proceed\b/i, words: "please proceed" },
  { re: /\bpurchas/i, words: "purchase" },
  { re: /\bcancel our\b/i, words: "cancel our" },
  { re: /\brecommend/i, words: "recommend" },
];

const PLACEHOLDER_RE = /\{\{\s*([^{}]*?)\s*\}\}/g;

/**
 * The guard on a model draft (§7.4.4), checked before filling. Rejected (and
 * the template used) when a required placeholder is missing or repeated in
 * the body, a placeholder isn't on the list, a digit appears outside
 * placeholders (except "HO-6"), there is a "$" or an em dash, the subject is
 * over 120 characters, the body is outside 200 to 2,000 characters, or it
 * binds, accepts, buys, cancels or recommends.
 */
export function checkModelDraft(draft: { subject: string; body: string }, required: readonly string[]): { ok: true } | { ok: false; reasons: string[] } {
  const reasons: string[] = [];
  const subject = draft.subject ?? "";
  const body = draft.body ?? "";
  const both = `${subject}\n${body}`;

  for (const p of required) {
    const n = [...body.matchAll(PLACEHOLDER_RE)].filter((m) => m[1] === p).length;
    if (n === 0) reasons.push(`it left out {{${p}}}`);
    else if (n > 1) reasons.push(`it used {{${p}}} more than once`);
  }
  const unknown = [...new Set([...both.matchAll(PLACEHOLDER_RE)].map((m) => m[1]).filter((p) => !(PLACEHOLDERS as readonly string[]).includes(p)))];
  for (const p of unknown) reasons.push(`it used a placeholder that doesn't exist: {{${p}}}`);

  const bare = both.replace(PLACEHOLDER_RE, "").replace(/\bHO-6\b/g, "");
  if (/\d/.test(bare)) reasons.push("it wrote a digit");
  if (both.includes("$")) reasons.push("it wrote a dollar sign");
  if (both.includes("—")) reasons.push("it used an em dash");
  if (subject.length > 120) reasons.push("the subject is longer than 120 characters");
  if (body.length < 200) reasons.push("the email is too short");
  if (body.length > 2000) reasons.push("the email is too long");
  for (const f of FORBIDDEN) if (f.re.test(both)) reasons.push(`it used the words "${f.words}"`);
  return reasons.length ? { ok: false, reasons } : { ok: true };
}

export type TemplateValues = Partial<Record<Placeholder | "coverage" | "coverages", string | null>>;

/**
 * Replace each {{placeholder}} with its value. A line that is empty only
 * because an optional value was empty is removed (and the blank lines around
 * it collapse to one). An unknown placeholder becomes empty.
 */
export function fillPlaceholders(text: string, values: TemplateValues): string {
  const lines = String(text ?? "").split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const hadPlaceholder = PLACEHOLDER_RE.test(line);
    PLACEHOLDER_RE.lastIndex = 0;
    const filled = line.replace(PLACEHOLDER_RE, (_, key: string) => {
      const v = values[key as keyof TemplateValues];
      return v === null || v === undefined ? "" : String(v);
    });
    if (hadPlaceholder && filled.trim() === "") continue;
    out.push(filled);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const SIGN_OFF = "Thank you,\n{{sender_name}}\n{{sender_contact}}";

/** The deterministic email for each kind (§7.4.5), filled. Always available. */
export function templateDraft(kind: EmailKind, values: TemplateValues): { subject: string; body: string } {
  const v: TemplateValues = { ...values, agent_name: values.agent_name?.trim() || "there" };
  let subject: string;
  let body: string;
  switch (kind) {
    case "quote_request":
      subject = "Insurance quote request: {{association_name}}";
      body = [
        "Hello {{agent_name}},",
        "",
        `We're the board of {{association_name}}, {{building_description}}. We'd like a quote for the coverage below${v.renewal_date ? ", ahead of our renewal on {{renewal_date}}" : ""}. Could you also tell us how much notice you need before a renewal date?`,
        "",
        "{{details_block}}",
        "",
        "If you need anything else to quote, please let me know.",
        "",
        SIGN_OFF,
      ].join("\n");
      break;
    case "quote_follow_up":
      subject = "Following up: insurance quote for {{association_name}}";
      body = `Hello {{agent_name}},\n\nI'm following up on our request of {{original_date}} for a quote for {{coverages}}. Is there anything else you need from us?\n\n${SIGN_OFF}`;
      break;
    case "coverage_question":
      subject = "Question about our {{coverage}} policy";
      body = `Hello {{agent_name}},\n\nA question about {{policy_reference}}:\n\n{{question}}\n\n${SIGN_OFF}`;
      break;
    case "certificate_request":
      subject = "Certificate of insurance request: {{association_name}}";
      body = `Hello {{agent_name}},\n\nCould you please issue a certificate of insurance for {{policy_reference}} to:\n\n{{certificate_holder}}\n\n${SIGN_OFF}`;
      break;
    case "claim_report":
      subject = "New claim: {{association_name}}";
      body = `Hello {{agent_name}},\n\nWe need to report a loss under {{policy_reference}}.\n\n{{loss_details}}\n\nPlease let us know the claim number and next steps, and whether an adjuster will contact us.\n\n${SIGN_OFF}`;
      break;
    case "change_request":
      subject = "Policy change request: {{association_name}}";
      body = `Hello {{agent_name}},\n\nWe'd like to ask about a change to {{policy_reference}}:\n\n{{change_details}}\n\nCould you tell us what it would involve and whether it changes the premium?\n\n${SIGN_OFF}`;
      break;
    case "documents_request":
      subject = "Our current insurance documents: {{association_name}}";
      body = `Hello {{agent_name}},\n\nCould you send our current declarations pages for every policy {{association_name}} carries, and the list of policy forms and endorsements for each? We're putting our insurance records in order.\n\n${SIGN_OFF}`;
      break;
    default:
      subject = "Thank you for your quote: {{association_name}}";
      body = `Hello {{agent_name}},\n\nThank you for the quote for {{coverages}}. The board has decided not to go ahead with it this time. We appreciate the time you put into it.\n\n${SIGN_OFF}`;
  }
  return { subject: fillPlaceholders(subject, v).replace(/:\s*$/, ""), body: fillPlaceholders(body, v) };
}

/** "a 3-unit condominium in Chicago". */
export function buildingDescription(units: number, city: string | null): string {
  return `a ${units}-unit condominium${city?.trim() ? ` in ${city.trim()}` : ""}`;
}

/** "our master policy with West Bend (policy BOP-1234)". */
export function policyReference(coverage: string, carrier: string | null, number: string | null): string {
  const noun = coverage === "property" ? "master" : coverageWords(coverage).toLowerCase().replace(/^directors and officers$/, "D&O");
  return `our ${noun} policy${carrier ? ` with ${carrier}` : ""}${number ? ` (policy ${number})` : ""}`;
}

/** "pat@example.com · (312) 555-0100". */
export function senderContact(email: string | null, phone: string | null): string {
  return [email?.trim(), phone?.trim()].filter(Boolean).join(" · ");
}

// ---------------------------------------------------------------------------
// The quote request's details block (§7.4.6)

export interface QuoteRequestPayloadV2 {
  version: 2;
  association: { legal_name: string; address: string; city: string | null; units: number; year_built: number | null; construction: string | null; stories: number | null; roof_replaced_year: number | null;
                 total_square_feet: number | null; has_sprinklers: boolean | null; has_amenities: boolean | null; rental_share: string | null };
  coverages: { coverage: CoverageType; wanted: Record<string, string | null> /* field key → raw string, e.g. building_limit "2400000.00" */ }[];
  deductibles_today: { property: string | null; water: string | null; wind_hail: string | null; wind_hail_percent: string | null } | null;
  current: { carrier: string; renews_on: string; premium: string } | null;    // only when share_current_premium
  claims: { date_of_loss: string; description: string; status: string; amount_paid: string | null }[];
  include_claim_amounts: boolean;
  anything_else: string | null;
  contact: { name: string; email: string; phone: string | null };
}

const SEP = " · ";
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDay = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${SHORT_MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : iso;
};
const yesNo = (b: boolean | null) => (b === null ? null : b ? "yes" : "no");

/** One coverage's line: "Master policy: building limit $2,400,000 (replacement cost), special form, single entity". */
function coverageLine(c: QuoteRequestPayloadV2["coverages"][number]): string {
  const w = c.wanted ?? {};
  const val = (k: string) => (w[k] === undefined || w[k] === null || String(w[k]).trim() === "" ? null : String(w[k]));
  const parts: string[] = [];
  const used = new Set<string>();
  const take = (k: string) => {
    used.add(k);
    return val(k);
  };

  if (c.coverage === "property") {
    const limit = formatMoney(take("building_limit"));
    const valuation = take("valuation");
    const valWords = valuation && valuation !== "unknown" ? optionLabel(VALUATIONS, valuation).toLowerCase() : null;
    if (limit) parts.push(`building limit ${limit}${valWords ? ` (${valWords})` : ""}`);
    else if (valWords) parts.push(valWords);
    const col = take("cause_of_loss_form");
    if (col && col !== "unknown") parts.push(`${col} form`);
    const form = take("coverage_form");
    if (form && form !== "unknown") parts.push(optionLabel(COVERAGE_FORMS, form).replace(/ \(.*\)$/, "").toLowerCase());
  } else if (c.coverage === "general_liability") {
    const occ = formatMoney(take("liability_per_occurrence"));
    const agg = formatMoney(take("liability_aggregate"));
    if (occ) parts.push(`${occ} per occurrence`);
    if (agg) parts.push(`${agg} aggregate`);
  } else {
    const main: Partial<Record<CoverageType, string>> = {
      directors_officers: "do_limit", fidelity_crime: "crime_limit", umbrella: "umbrella_limit", flood: "flood_building_limit",
      earthquake: "earthquake_limit", equipment_breakdown: "equipment_breakdown_limit", workers_comp: "wc_el_each_accident",
      cyber: "cyber_limit", employment_practices: "epli_limit", other: "generic_limit",
    };
    const k = main[c.coverage];
    const m = k ? formatMoney(take(k)) : null;
    if (m) parts.push(m);
  }
  // Anything else the board asked about, in field order.
  for (const [key, raw] of Object.entries(w)) {
    if (used.has(key) || raw === null || String(raw).trim() === "") continue;
    const def = FIELD_BY_KEY.get(key);
    if (!def) continue;
    const shown =
      def.kind === "money" ? formatMoney(raw)
      : def.kind === "percent" ? formatPercent(raw)
      : def.kind === "boolean" ? (raw === "true" ? "yes" : raw === "false" ? "no" : null)
      : def.kind === "enum" ? (raw === "unknown" ? null : optionLabel(def.options ?? CAUSE_OF_LOSS_FORMS, raw).toLowerCase())
      : def.kind === "date" ? longDate(raw)
      : raw;
    if (shown) parts.push(`${def.label.toLowerCase()} ${shown}`);
  }
  return `${coverageWords(c.coverage)}${parts.length ? `: ${parts.join(", ")}` : ""}`;
}

/**
 * The quote request facts as plain text, every line from the payload. A line
 * whose values are all unknown is left out; CURRENT INSURANCE appears only
 * when the board shared it (payload.current is set), and claim amounts only
 * when include_claim_amounts.
 */
export function detailsBlock(payload: QuoteRequestPayloadV2): string {
  const a = payload.association;
  const out: string[] = ["THE ASSOCIATION"];
  if (a.legal_name?.trim()) out.push(`Legal name: ${a.legal_name.trim()}`);
  if (a.address?.trim()) out.push(`Address: ${a.address.trim()}`);
  const construction = constructionLabel(a.construction);
  const facts1 = [
    a.units ? `Units: ${a.units}` : null,
    a.stories ? `Stories: ${a.stories}` : null,
    a.year_built ? `Built: ${a.year_built}` : null,
    construction ? `Construction: ${construction}` : null,
  ].filter(Boolean);
  if (facts1.length) out.push(facts1.join(SEP));
  if (a.roof_replaced_year) out.push(`Roof last replaced: ${a.roof_replaced_year}`);
  const facts2 = [
    a.total_square_feet ? `Total square feet: ${a.total_square_feet.toLocaleString("en-US")}` : null,
    yesNo(a.has_sprinklers) ? `Sprinklers: ${yesNo(a.has_sprinklers)}` : null,
    yesNo(a.has_amenities) ? `Shared amenities: ${yesNo(a.has_amenities)}` : null,
  ].filter(Boolean);
  if (facts2.length) out.push(facts2.join(SEP));
  const rental = formatPercent(a.rental_share);
  if (rental && a.rental_share) {
    const whole = Math.round(Number(a.rental_share) * 100);
    out.push(`Units rented out: about ${whole}%`);
  }

  const coverages = payload.coverages.map(coverageLine);
  const d = payload.deductibles_today;
  const dParts = d
    ? [
        formatMoney(d.property) ? `${formatMoney(d.property)} all perils` : null,
        formatMoney(d.water) ? `${formatMoney(d.water)} water damage` : null,
        formatPercent(d.wind_hail_percent)
          ? `${formatPercent(d.wind_hail_percent)} wind or hail${formatMoney(d.wind_hail) ? ` (minimum ${formatMoney(d.wind_hail)})` : ""}`
          : formatMoney(d.wind_hail) ? `${formatMoney(d.wind_hail)} wind or hail` : null,
      ].filter(Boolean)
    : [];
  if (coverages.length || dParts.length) {
    out.push("", "COVERAGE WE'RE ASKING ABOUT", ...coverages);
    if (dParts.length) out.push(`Deductibles today: ${dParts.join(", ")}`);
  }

  if (payload.current) {
    const c = payload.current;
    out.push("", "CURRENT INSURANCE", [c.carrier, c.renews_on ? `renews ${longDate(c.renews_on)}` : null, formatMoney(c.premium) ? `${formatMoney(c.premium)} a year` : null].filter(Boolean).join(", "));
  }

  if (payload.claims.length) {
    out.push("", "CLAIMS IN THE LAST 5 YEARS");
    for (const c of payload.claims) {
      const paid = payload.include_claim_amounts && formatMoney(c.amount_paid) ? `, ${formatMoney(c.amount_paid)} paid` : "";
      out.push(`${shortDay(c.date_of_loss)}: ${c.description.trim()} (${c.status}${paid})`);
    }
  }

  if (payload.anything_else?.trim()) out.push("", "ANYTHING ELSE", payload.anything_else.trim());
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Switching checklist (§9.10a)

export interface ChecklistItem { key: string; text: string; action: { label: string; href: string } | null }

/**
 * "Next steps for switching insurers", built only from the board's own data.
 * An item whose inputs are missing is left out.
 */
export function switchingChecklist(input: {
  newPolicy: { id: string; carrier: string; effectiveFrom: string; contact: { id: string; name: string } | null };
  oldPolicy: { id: string; carrier: string; contact: { id: string; name: string } | null; sameAgency: boolean } | null;
  otherQuotes: { quoteId: string; contactId: string | null; contactName: string | null }[];
  hasPremiumBill: boolean;
  ownerSummaryPublished: boolean;
}): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const nc = input.newPolicy.contact;
  if (nc) {
    items.push({
      key: "tell_new",
      text: `Tell ${nc.name} you'd like to go ahead. Walkup doesn't do this for you.`,
      action: { label: "Write to them", href: `/insurance/emails/new?kind=other&contact=${nc.id}` },
    });
  }
  const old = input.oldPolicy;
  if (old && old.contact && !old.sameAgency && old.carrier.trim().toLowerCase() !== input.newPolicy.carrier.trim().toLowerCase() && old.contact.id !== nc?.id) {
    items.push({
      key: "tell_old",
      text: `Tell ${old.contact.name} not to renew the ${old.carrier} policy.`,
      action: { label: "Draft it", href: `/insurance/emails/new?kind=change_request&contact=${old.contact.id}&policy=${old.id}&change=other` },
    });
  }
  for (const q of input.otherQuotes) {
    items.push({
      key: `thank_${q.quoteId}`,
      text: `Thank ${q.contactName ?? "the agency"} for their quote.`,
      action: { label: "Draft a thank-you", href: `/insurance/emails/new?kind=quote_decline&quote=${q.quoteId}` },
    });
  }
  if (input.hasPremiumBill) {
    items.push({ key: "bill", text: "Update the premium bill if the payee changed.", action: { label: "Open bills", href: "/bills" } });
  }
  if (input.ownerSummaryPublished) {
    items.push({ key: "owner_summary", text: "Republish the owner summary for the new policy.", action: { label: "Open the owner summary", href: "/insurance/owner-summary" } });
  }
  if (nc) {
    items.push({
      key: "certificate",
      text: `Ask ${nc.name} for a certificate of insurance for any lender that needs one.`,
      action: { label: "Draft it", href: `/insurance/emails/new?kind=certificate_request&contact=${nc.id}` },
    });
  }
  return items;
}
