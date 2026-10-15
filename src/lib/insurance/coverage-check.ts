// The coverage check (insurance-spec §6.8; brief decision 2): a pure rules
// engine that compares the building's facts with its policies and reports
// findings, each with a stated basis. Statute findings cite a section verified
// on ilga.gov (statute.ts) and run only for Illinois; common-practice findings
// end in a question for the agent, never a recommendation. Findings say "Your
// records don't show …", never "your policy is illegal": Walkup may simply
// lack the data. Comparisons are in integer cents (and bp4 for percents).

import { COVERAGE_TYPES, LINE_KEYS, LINE_LABEL, coverageShort, lineForCoverage, type LineKey } from "./coverage";
import { emptyFacts, factUnknown, type BuildingFacts, type FactKey } from "./facts";
import { optionLabel, COVERAGE_FORMS, rowBool, rowText, type PolicyRow } from "./fields";
import { bp4OrNull, centsOrNull, formatMoney, formatPercent, longDate, mulCentsBp4 } from "./format";
import { addMonthsClamped } from "./premium";
import { effectiveSections, linesInForce, renewalFor, type LineCover, type PolicyStatus } from "./status";
import { CITATIONS, type Citation, type CitationKey } from "./statute";
import { fromCents } from "@/lib/money/cents";

export type Basis = "statute" | "your_documents" | "your_data" | "common_practice";
export type Severity = "gap" | "ask" | "needs_info" | "info";

export interface CheckPolicy extends PolicyRow {
  status: PolicyStatus;
  renewed: boolean;
}

export interface CheckInput {
  todayIso: string;
  stateCode: string;                     // associations.state_code; statute rules need "IL"
  unitCount: number;
  facts: BuildingFacts | null;           // null → every fact unknown, is_condominium true
  policies: CheckPolicy[];               // all non-archived rows with status
  fundsTotal: string | null;             // sum of positive fund_cash_balances.cash_balance (text); null if no books
  history: { coverage: string; policyId: string; changePercent: string | null; previousPremium: string | null; annualPremium: string; quotesObtained: number }[];
  legalName: string | null;
  quotesThisTerm: Record<string, number>; // coverage → quotes with quoted_on in [effective_to-120d, today]
  /** findingKey is the finding's id; '' (a hand-made row) covers every finding of that rule and policy. */
  dismissals: { ruleId: string; policyId: string | null; findingKey?: string; reason: string }[];
  /** Received quotes (CP-DO-01 needs a D&O quote's carrier). Optional; absent = none. */
  quotes?: { coverage: string; carrierName: string; declined: boolean }[];
}

export interface Finding {
  id: string;                    // `${ruleId}` or `${ruleId}:${policyId}` (DOC-REQ-01: `:${coverage}`)
  ruleId: string;
  severity: Severity;
  basis: Basis;
  line: LineKey | null;
  policyId: string | null;
  title: string;
  detail: string;
  question: string | null;
  citation: Citation | null;
  /** How a non-statute rule's citation relates to it (§6.8 CP-EB-01), shown above the quote. */
  citationNote?: string | null;
  missingFacts: FactKey[];
  notOnFile: boolean;
  answerableFields: string[];
  dismissed: { reason: string } | null;
}

export type LegalChecks = "illinois" | "condo_act_off" | "not_illinois";

export interface RuleContext {
  input: CheckInput;
  today: string;
  facts: BuildingFacts;
  isCondo: boolean;
  legalChecks: LegalChecks;
  inForce: CheckPolicy[];
  lines: Record<LineKey, LineCover | null>;
  /** The in-force property policy with the latest effective_from. */
  master: CheckPolicy | null;
  /** In-force policies whose effective sections give this line's section. */
  policiesWithSection(section: string): CheckPolicy[];
  /** Record facts the rule needs and doesn't have (they go into missingFacts, deduplicated). */
  missing(...keys: FactKey[]): void;
  unknown(key: FactKey): boolean;
}

export interface Rule {
  id: string;
  basis: Basis;
  line: LineKey | null;
  needs: FactKey[];
  citation: CitationKey | null;  // the one key every finding of this rule cites; statute rules must have one
  run(ctx: RuleContext): Finding[];
}

// ---------------------------------------------------------------------------
// Helpers

const money = (t: string | null): string => formatMoney(t) ?? "";
const cents = centsOrNull;

/** The coverage as a noun inside a sentence: "master", "general liability", "D&O". */
const COVERAGE_NOUN: Record<string, string> = {
  property: "master", general_liability: "general liability", directors_officers: "D&O",
  fidelity_crime: "crime and fidelity", umbrella: "umbrella", flood: "flood", earthquake: "earthquake",
  equipment_breakdown: "equipment breakdown", workers_comp: "workers' compensation", cyber: "cyber",
  employment_practices: "employment practices", other: "other",
};
const coverageNoun = (c: string) => COVERAGE_NOUN[c] ?? c;

/** "12.5" → "12.5", "20.0" → "20". */
const pctWords = (p: string) => p.replace(/\.0$/, "");

const normaliseName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function formWords(form: string): string {
  return form === "bare_walls" ? "bare walls" : form === "single_entity" ? "single entity" : form === "all_in" ? "all-in" : form;
}

function unknownEnum(v: string | null): boolean {
  return v === null || v === "unknown";
}

function listWords(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

type Draft = Omit<Finding, "id" | "ruleId" | "basis" | "citation" | "dismissed" | "line" | "missingFacts" | "notOnFile" | "answerableFields" | "question"> & {
  line?: LineKey | null; idSuffix?: string; question?: string | null;
  missingFacts?: FactKey[]; notOnFile?: boolean; answerableFields?: string[]; citationNote?: string;
};

function make(rule: Rule, ctx: RuleContext, d: Draft): Finding {
  const suffix = d.idSuffix ?? d.policyId;
  // A non-statute rule's citation is context from the Illinois Condominium
  // Property Act, so it is shown only when that Act's checks run.
  const showCitation = rule.basis === "statute" || ctx.legalChecks === "illinois";
  return {
    id: suffix ? `${rule.id}:${suffix}` : rule.id,
    ruleId: rule.id,
    severity: d.severity,
    basis: rule.basis,
    line: d.line === undefined ? rule.line : d.line,
    policyId: d.policyId,
    title: d.title,
    detail: d.detail,
    question: d.question ?? null,
    citation: rule.citation && showCitation ? CITATIONS[rule.citation] : null,
    ...(d.citationNote && rule.citation && showCitation ? { citationNote: d.citationNote } : {}),
    missingFacts: d.missingFacts ?? [],
    notOnFile: d.notOnFile ?? false,
    answerableFields: d.answerableFields ?? [],
    dismissed: null,
  };
}

const r = (rule: Omit<Rule, "run">, run: (self: Rule, ctx: RuleContext) => Finding[]): Rule => {
  const self: Rule = { ...rule, run: (ctx) => run(self, ctx) };
  return self;
};

const ONE_MILLION = 100_000_000; // cents
const FIVE_HUNDRED_K = 50_000_000;

// ---------------------------------------------------------------------------
// Rules (the table in §6.8)

export const RULES: Rule[] = [
  r({ id: "IL-PROP-01", basis: "statute", line: "property", needs: [], citation: "ICPA_12_A1_PROPERTY" }, (self, ctx) => {
    if (ctx.lines.property) return [];
    return [make(self, ctx, {
      severity: "gap", policyId: null, notOnFile: true,
      title: "Walkup has no master (building) policy on file for you.",
      detail: "If you have one, add it. The Act requires property insurance covering the common elements and the units.",
      question: "Can you send the current declarations page for the association's master property policy?",
    })];
  }),

  r({ id: "IL-PROP-02", basis: "statute", line: "property", needs: [], citation: "ICPA_12_A1_SPECIAL" }, (self, ctx) => {
    const m = ctx.master;
    if (!m) return [];
    const form = rowText(m, "cause_of_loss_form");
    const question = "Is our master policy written on a special (all-risk) causes-of-loss form?";
    if (form === "basic" || form === "broad") {
      return [make(self, ctx, {
        severity: "gap", policyId: m.id, question, answerableFields: ["cause_of_loss_form"],
        title: `The master policy is on a ${form} form, not special form.`,
        detail: "The Act requires special form causes of loss on the property policy.",
      })];
    }
    if (unknownEnum(form)) {
      return [make(self, ctx, {
        severity: "ask", policyId: m.id, question, answerableFields: ["cause_of_loss_form"],
        title: "Check that the master policy is special form.",
        detail: "The declarations Walkup read don't say which causes-of-loss form applies.",
      })];
    }
    return [];
  }),

  r({ id: "IL-PROP-03", basis: "statute", line: "property", needs: ["replacement_cost_estimate"], citation: "ICPA_12_A1_RC" }, (self, ctx) => {
    const m = ctx.master;
    if (!m) return [];
    if (rowText(m, "valuation") === "actual_cash_value") {
      return [make(self, ctx, {
        severity: "gap", policyId: m.id,
        title: "The building is insured at actual cash value.",
        detail: "The Act requires coverage of at least the full insurable replacement cost. Actual cash value pays less than the cost to rebuild.",
        question: "Can you confirm our building limit meets full insurable replacement cost, and tell us when the last valuation was done?",
      })];
    }
    if (ctx.unknown("replacement_cost_estimate")) {
      ctx.missing("replacement_cost_estimate");
      return [];
    }
    const estimate = ctx.facts.replacement_cost_estimate as string;
    const limit = rowText(m, "building_limit");
    const lc = cents(limit);
    const ec = cents(estimate);
    if (lc === null || ec === null || lc >= ec) return [];
    const source = ctx.facts.replacement_cost_source !== "unknown"
      ? optionLabel([...SOURCE_WORDS], ctx.facts.replacement_cost_source) : null;
    const asOf = ctx.facts.replacement_cost_as_of ? longDate(ctx.facts.replacement_cost_as_of) : null;
    const paren = [source, asOf].filter(Boolean).join(", ");
    return [make(self, ctx, {
      severity: "gap", policyId: m.id, answerableFields: ["building_limit", "valuation"],
      title: `The building limit is ${money(fromCents(ec - lc))} below your replacement cost estimate.`,
      detail: `Your policy covers ${money(limit)}. Your estimate${paren ? ` (${paren})` : ""} is ${money(estimate)}.`,
      question: `Our replacement cost estimate is ${money(estimate)}. Can you confirm our building limit meets full insurable replacement cost, and tell us when the last valuation was done?`,
    })];
  }),

  r({ id: "IL-PROP-04", basis: "statute", line: "property", needs: [], citation: "ICPA_12_A1_BC" }, (self, ctx) => {
    const m = ctx.master;
    if (!m) return [];
    const building = cents(rowText(m, "building_limit"));
    const required = building === null ? null : Math.min(mulCentsBp4(building, 1000), FIVE_HUNDRED_K);
    const requiredText = required === null ? "the lesser of 10% of the building limit or $500,000" : money(fromCents(required));
    const bc = cents(rowText(m, "ordinance_law_bc_limit"));
    const b = cents(rowText(m, "ordinance_law_b_limit"));
    const c = cents(rowText(m, "ordinance_law_c_limit"));
    const combined = bc !== null ? bc : b !== null && c !== null ? b + c : null;
    const answerableFields = ["ordinance_or_law", "ordinance_law_b_limit", "ordinance_law_c_limit", "ordinance_law_bc_limit"];
    const question = `What are our ordinance or law Coverage B and C limits on the master policy, and are they at least ${requiredText} combined?`;
    const gap = (seen: string) => [make(self, ctx, {
      severity: "gap", policyId: m.id, answerableFields, question,
      title: "Ordinance or law Coverage B and C look short.",
      detail: `Together they should be at least ${requiredText} (the lesser of 10% of the building limit or $500,000). Walkup sees ${seen}. The Act measures this per insured building, so the figure is approximate if you have more than one.`,
    })];
    if (rowBool(m, "ordinance_or_law") === false) return gap("no ordinance or law coverage on the policy");
    if (combined !== null) {
      if (required !== null && combined < required) return gap(money(fromCents(combined)));
      if (required !== null) return [];
    }
    return [make(self, ctx, {
      severity: "ask", policyId: m.id, answerableFields, question,
      title: "Confirm ordinance or law Coverage B and C.",
      detail: "The Act sets a minimum for demolition (B) plus increased cost of construction (C).",
    })];
  }),

  r({ id: "IL-GL-01", basis: "statute", line: "liability", needs: [], citation: "ICPA_12_A2_GL" }, (self, ctx) => {
    const question = "Can you confirm our general liability limit per occurrence? The Act requires at least $1,000,000.";
    const line = ctx.lines.liability;
    if (!line) {
      return [make(self, ctx, {
        severity: "gap", policyId: null, notOnFile: true, question,
        title: "Walkup has no general liability policy on file for you.",
        detail: "If you have one (it's often part of the master policy), add it or tick Liability on the master policy. If not, the Act requires it.",
      })];
    }
    const lc = cents(line.limit);
    if (lc === null) {
      return [make(self, ctx, {
        severity: "ask", policyId: line.policies[0]?.id ?? null, question, answerableFields: ["liability_per_occurrence"],
        title: "Check the general liability limit per occurrence.",
        detail: "Walkup has no per-occurrence limit recorded. The Act sets $1,000,000 as the minimum.",
      })];
    }
    if (lc >= ONE_MILLION) return [];
    const holder = ctx.policiesWithSection("liability").find((p) => rowText(p, "liability_per_occurrence") === line.limit);
    return [make(self, ctx, {
      severity: "gap", policyId: holder?.id ?? line.policies[0]?.id ?? null, question,
      title: `General liability is ${money(line.limit)} per occurrence, below $1,000,000.`,
      detail: "The Act sets $1,000,000 as the minimum.",
    })];
  }),

  r({ id: "IL-GL-02", basis: "statute", line: "liability", needs: [], citation: "ICPA_12_A2_OWNERS" }, (self, ctx) =>
    ctx.policiesWithSection("liability").flatMap((p) => {
      const v = rowBool(p, "unit_owners_additional_insureds");
      if (v === true) return [];
      return [make(self, ctx, {
        severity: v === false ? "gap" : "ask", policyId: p.id, answerableFields: ["unit_owners_additional_insureds"],
        title: "Check that unit owners are additional insureds on the liability policy.",
        detail: "The Act requires owners to be covered for claims about the common elements.",
        question: "Are unit owners included as additional insureds on our general liability for claims arising from the common elements?",
      })];
    }),
  ),

  r({ id: "IL-FID-01", basis: "statute", line: "crime", needs: [], citation: "ICPA_12_A3A_FIDELITY" }, (self, ctx) => {
    const n = ctx.input.unitCount;
    if (!Number.isFinite(n) || n < 6 || ctx.lines.crime) return [];
    const funds = ctx.input.fundsTotal !== null ? formatMoney(ctx.input.fundsTotal) : null;
    return [make(self, ctx, {
      severity: "gap", policyId: null, notOnFile: true,
      title: "Walkup has no fidelity bond or crime policy on file for you.",
      detail: `If you have one, add it. If not, the Act requires it: associations with 6 or more units must carry a fidelity bond covering everyone who handles the association's money. You have ${n} units on record.`,
      question: `Can you quote a fidelity bond (crime policy) covering board members and anyone who handles our funds${funds ? `, for at least ${funds}` : ""}?`,
    })];
  }),

  r({ id: "IL-FID-02", basis: "statute", line: "crime", needs: [], citation: "ICPA_12_A3C_AMOUNT" }, (self, ctx) => {
    const line = ctx.lines.crime;
    const funds = cents(ctx.input.fundsTotal);
    if (ctx.input.unitCount < 6 || !line || funds === null) return [];
    const limit = cents(line.limit);
    if (limit === null || limit >= funds) return [];
    const holder = ctx.policiesWithSection("crime").find((p) => rowText(p, "crime_limit") === line.limit);
    const fundsText = money(ctx.input.fundsTotal);
    return [make(self, ctx, {
      severity: "gap", policyId: holder?.id ?? line.policies[0]?.id ?? null,
      title: `The fidelity bond is ${money(fromCents(funds - limit))} below the money the association holds.`,
      detail: `Your crime limit is ${money(line.limit)}. Your books show ${fundsText} across all funds, and the Act asks for the full amount of funds and reserves.`,
      question: `Our funds and reserves total about ${fundsText}. Can you quote raising our fidelity (employee theft) limit to at least that?`,
    })];
  }),

  r({ id: "IL-FID-03", basis: "statute", line: "crime", needs: ["manager_handles_funds"], citation: "ICPA_12_A3B_MANAGER" }, (self, ctx) => {
    const crime = ctx.policiesWithSection("crime");
    if (crime.length === 0) return [];
    if (ctx.unknown("manager_handles_funds")) {
      ctx.missing("manager_handles_funds");
      return [];
    }
    if (ctx.facts.manager_handles_funds !== true) return [];
    const company = ctx.facts.management_company?.trim() || "our management company";
    return crime.flatMap((p) => {
      const v = rowBool(p, "crime_includes_manager");
      if (v === true) return [];
      return [make(self, ctx, {
        severity: v === false ? "gap" : "ask", policyId: p.id, answerableFields: ["crime_includes_manager"],
        title: "Check that your property manager is covered by a fidelity bond.",
        detail: "Management companies that handle association funds must be covered by a fidelity bond.",
        question: `Does our crime policy cover ${company} and its employees as employees, or does the manager carry its own bond naming us?`,
      })];
    });
  }),

  r({ id: "IL-DO-01", basis: "statute", line: "do", needs: [], citation: "ICPA_12_A3D_DO" }, (self, ctx) => {
    if (ctx.lines.do) return [];
    return [make(self, ctx, {
      severity: "gap", policyId: null, notOnFile: true,
      title: "Walkup has no D&O policy on file for you. If you have one, add it. If not, the Act requires it.",
      detail: "The Act requires the board to carry directors and officers coverage at a level it considers reasonable.",
      question: "Can you quote directors and officers liability for the board?",
    })];
  }),

  r({ id: "IL-DO-02", basis: "statute", line: "do", needs: [], citation: "ICPA_12_A3D_SCOPE" }, (self, ctx) => {
    const parts: [string, string][] = [
      ["do_covers_non_monetary", "non-money claims"],
      ["do_covers_breach_of_contract", "breach of contract defense"],
      ["do_covers_insurance_decisions", "decisions about insurance"],
    ];
    return ctx.policiesWithSection("do").flatMap((p) => {
      const no = parts.filter(([c]) => rowBool(p, c) === false).map(([, w]) => w);
      const unsure = parts.filter(([c]) => rowBool(p, c) === null).map(([, w]) => w);
      if (no.length === 0 && unsure.length === 0) return [];
      const notes = [
        no.length ? `Walkup's records say it doesn't cover: ${listWords(no)}.` : "",
        unsure.length ? `Walkup couldn't confirm: ${listWords(unsure)}.` : "",
      ].filter(Boolean).join(" ");
      return [make(self, ctx, {
        severity: no.length ? "gap" : "ask", policyId: p.id, answerableFields: parts.map(([c]) => c),
        title: "Confirm the D&O policy covers what the Act lists.",
        detail: `The Act requires defense of non-money claims, breach of contract, and decisions about insurance. ${notes}`,
        question: "Does our D&O policy cover defense of non-monetary claims, breach of contract claims, and claims about our insurance decisions?",
      })];
    });
  }),

  r({ id: "IL-DO-03", basis: "statute", line: "do", needs: [], citation: "ICPA_12_A3D_INSUREDS" }, (self, ctx) => {
    const cols = ["do_includes_managing_agent", "do_includes_past_future_board"];
    return ctx.policiesWithSection("do").flatMap((p) => {
      const vals = cols.map((c) => rowBool(p, c));
      if (vals.every((v) => v === true)) return [];
      return [make(self, ctx, {
        severity: vals.includes(false) ? "gap" : "ask", policyId: p.id, answerableFields: cols,
        title: "Confirm who the D&O policy insures.",
        detail: "The Act requires past, present and future board members, the managing agent, and employees as insureds.",
        question: "Are past and future board members, our managing agent, and employees insureds under our D&O policy?",
      })];
    });
  }),

  r({ id: "IL-FORM-01", basis: "statute", line: "property", needs: [], citation: "ICPA_12_B_FIXTURES" }, (self, ctx) => {
    const m = ctx.master;
    if (!m || rowText(m, "coverage_form") !== "bare_walls") return [];
    return [make(self, ctx, {
      severity: "ask", policyId: m.id, answerableFields: ["coverage_form"],
      title: "Your master policy is bare walls. Check the original fixtures.",
      detail: "Under the Act, fixtures the developer originally installed inside units are common elements. A bare-walls policy may not cover them.",
      question: "Our master policy is bare walls. Are the fixtures originally installed in the units (cabinets, built-ins) covered as common elements?",
    })];
  }),

  r({ id: "IL-SUB-01", basis: "statute", line: "property", needs: [], citation: "ICPA_12_E_SUBROGATION" }, (self, ctx) => {
    const m = ctx.master;
    if (!m) return [];
    const v = rowBool(m, "waiver_of_subrogation");
    if (v === true) return [];
    return [make(self, ctx, {
      severity: v === false ? "gap" : "info", policyId: m.id, answerableFields: ["waiver_of_subrogation"],
      title: "Check the waiver of subrogation.",
      detail: "The Act requires the insurer to give up recovering from unit owners and the board.",
      question: "Does our master policy include the waiver of subrogation against unit owners, the association and the board?",
    })];
  }),

  r({ id: "CICAA-FID-01", basis: "statute", line: "crime", needs: [], citation: "CICAA_1_55_FIDELITY" }, (self, ctx) => {
    if (ctx.isCondo || ctx.input.unitCount < 30 || ctx.lines.crime) return [];
    return [make(self, ctx, {
      severity: "ask", policyId: null,
      title: "If the Common Interest Community Association Act applies to you, it requires fidelity insurance.",
      detail: "Associations with 30 or more units must carry it. Sec. 1-75 exempts smaller associations.",
      question: "Do we need fidelity insurance under the Common Interest Community Association Act, and can you quote it?",
    })];
  }),

  r({ id: "DOC-FORM-01", basis: "your_documents", line: "property", needs: [], citation: null }, (self, ctx) => {
    const m = ctx.master;
    const declared = ctx.facts.declaration_coverage_form;
    const policy = m ? rowText(m, "coverage_form") : null;
    if (!m || unknownEnum(declared) || unknownEnum(policy) || declared === policy) return [];
    const section = ctx.facts.declaration_insurance_section?.trim();
    return [make(self, ctx, {
      severity: "gap", policyId: m.id,
      title: `Your declaration says ${formWords(declared)}; the master policy says ${formWords(policy as string)}.`,
      detail: `Your declaration's insurance article${section ? ` (${section})` : ""} decides what the association insures inside units.`,
      question: `Our declaration requires ${formWords(declared)} coverage. Can the master policy be written that way?`,
    })];
  }),

  r({ id: "DOC-REQ-01", basis: "your_documents", line: null, needs: [], citation: "ICPA_12_D_OTHER" }, (self, ctx) =>
    ctx.facts.declaration_required_lines.flatMap((coverage) => {
      const line = lineForCoverage(coverage);
      if (!line || ctx.lines[line]) return [];
      const label = COVERAGE_TYPES.find((c) => c.value === coverage)?.label.toLowerCase() ?? coverage;
      const words = coverage === "directors_officers" ? "directors and officers (D&O) coverage"
        : coverage === "property" ? "a master (building) policy"
        : `${label.replace(/ \(.*\)$/, "")} coverage`;
      return [make(self, ctx, {
        severity: "gap", policyId: null, line, idSuffix: coverage, notOnFile: true,
        title: `Your declaration requires ${words}; Walkup has none on file.`,
        detail: "You recorded that the declaration requires it. The Act lets a declaration require other coverage.",
        question: `Our declaration requires ${words}. Can you quote it?`,
      })];
    }),
  ),

  r({ id: "YD-EXP-01", basis: "your_data", line: null, needs: [], citation: null }, (self, ctx) => {
    const activeCoverages = new Set(ctx.inForce.map((p) => p.coverage));
    const latest = new Map<string, CheckPolicy>();
    for (const p of ctx.input.policies) {
      if (p.status !== "expired" || p.renewed || activeCoverages.has(p.coverage)) continue;
      const seen = latest.get(p.coverage);
      if (!seen || p.effective_to > seen.effective_to) latest.set(p.coverage, p);
    }
    return [...latest.values()].map((p) => make(self, ctx, {
      severity: "gap", policyId: p.id, line: lineForCoverage(p.coverage),
      title: `Your ${coverageNoun(p.coverage)} policy ended on ${longDate(p.effective_to)}.`,
      detail: `Walkup has no newer ${coverageNoun(p.coverage)} policy. If it was renewed, upload or enter the renewal.`,
    }));
  }),

  r({ id: "YD-REN-01", basis: "your_data", line: null, needs: [], citation: null }, (self, ctx) => {
    const ren = renewalFor(ctx.input.policies, ctx.today);
    if (!ren || !ren.withinReminder || ren.daysToEnd < 0) return [];
    const p = ren.policy;
    if ((ctx.input.quotesThisTerm[p.coverage] ?? 0) > 0) return [];
    return [make(self, ctx, {
      severity: "ask", policyId: p.id, line: lineForCoverage(p.coverage),
      title: `${coverageShort(p.coverage)} renews ${longDate(p.effective_to)}. No other quotes are recorded yet.`,
      detail: "Comparing quotes is the only way Walkup can show whether a lower price is available.",
    })];
  }),

  r({ id: "YD-PREM-01", basis: "your_data", line: null, needs: [], citation: null }, (self, ctx) => {
    const active = new Map(ctx.inForce.map((p) => [p.id, p]));
    return ctx.input.history.flatMap((h) => {
      const p = active.get(h.policyId);
      if (!p || h.changePercent === null || h.quotesObtained !== 0) return [];
      const pct = Number(h.changePercent);
      if (!Number.isFinite(pct) || pct < 10) return [];
      const words = pctWords(h.changePercent);
      return [make(self, ctx, {
        severity: "ask", policyId: p.id, line: lineForCoverage(p.coverage),
        title: `Your ${coverageNoun(p.coverage)} premium went up ${words}% at the last renewal, with no other quotes on file.`,
        detail: h.previousPremium ? `From ${money(h.previousPremium)} to ${money(h.annualPremium)}.` : `It is now ${money(h.annualPremium)}.`,
        question: `Our premium rose ${words}% at renewal. What drove the increase, and are there options to bring it down (deductibles, limits, other insurers)?`,
      })];
    });
  }),

  r({ id: "YD-NI-01", basis: "your_data", line: "property", needs: [], citation: null }, (self, ctx) => {
    const m = ctx.master;
    const named = m ? rowText(m, "named_insured") : null;
    const legal = ctx.input.legalName?.trim() || null;
    if (!m || !named || !legal || normaliseName(named) === normaliseName(legal)) return [];
    return [make(self, ctx, {
      severity: "ask", policyId: m.id,
      title: "The named insured doesn't match your legal name.",
      detail: `Policy: "${named}". Walkup: "${legal}".`,
      question: `Our legal name is ${legal}. Can you correct the named insured on the policy?`,
    })];
  }),

  r({ id: "YD-COINS-01", basis: "your_data", line: "property", needs: ["replacement_cost_estimate"], citation: null }, (self, ctx) => {
    const m = ctx.master;
    if (!m) return [];
    const coins = bp4OrNull(rowText(m, "coinsurance_percent"));
    if (coins === null || coins <= 0 || rowBool(m, "agreed_value") === true) return [];
    if (ctx.unknown("replacement_cost_estimate")) {
      ctx.missing("replacement_cost_estimate");
      return [];
    }
    const estimate = cents(ctx.facts.replacement_cost_estimate);
    const limit = cents(rowText(m, "building_limit"));
    if (estimate === null || limit === null || limit >= mulCentsBp4(estimate, coins)) return [];
    const pct = formatPercent(rowText(m, "coinsurance_percent")) as string;
    return [make(self, ctx, {
      severity: "ask", policyId: m.id, answerableFields: ["agreed_value", "coinsurance_percent"],
      title: "Ask about a coinsurance penalty.",
      detail: `The policy has ${pct} coinsurance and the building limit is below ${pct} of your replacement cost estimate. That can reduce a claim payment.`,
      question: `Our policy shows ${pct} coinsurance. Is it waived by an agreed value endorsement, and if not, could we be penalised at our current limit?`,
    })];
  }),

  r({ id: "YD-DED-01", basis: "your_data", line: "property", needs: [], citation: null }, (self, ctx) => {
    const m = ctx.master;
    const funds = cents(ctx.input.fundsTotal);
    if (!m || funds === null) return [];
    const options: number[] = [];
    const prop = cents(rowText(m, "property_deductible"));
    if (prop !== null) options.push(prop);
    const whDollar = cents(rowText(m, "wind_hail_deductible"));
    if (whDollar !== null) options.push(whDollar);
    const whPct = bp4OrNull(rowText(m, "wind_hail_deductible_percent"));
    const building = cents(rowText(m, "building_limit"));
    if (whPct !== null && building !== null) options.push(mulCentsBp4(building, whPct));
    if (options.length === 0) return [];
    const ded = Math.max(...options);
    if (ded <= funds) return [];
    const dedText = money(fromCents(ded));
    const fundsText = money(ctx.input.fundsTotal);
    return [make(self, ctx, {
      severity: "ask", policyId: m.id,
      title: "One claim's deductible is more than the association has in the bank.",
      detail: `Deductible ${dedText}; all funds ${fundsText}.`,
      question: `Our deductible is ${dedText} and our funds total about ${fundsText}. What lower deductible options are there, and what would each cost?`,
    })];
  }),

  r({ id: "YD-WH-01", basis: "your_data", line: "property", needs: [], citation: "ICPA_12_C_DEDUCTIBLE" }, (self, ctx) => {
    const m = ctx.master;
    const pctText = m ? rowText(m, "wind_hail_deductible_percent") : null;
    const bp4 = bp4OrNull(pctText);
    if (!m || bp4 === null || bp4 <= 0) return [];
    const pct = formatPercent(pctText) as string;
    const limit = rowText(m, "building_limit");
    const building = cents(limit);
    const minimum = rowText(m, "wind_hail_deductible");
    const minText = minimum && cents(minimum) ? `, with a minimum of ${money(minimum)}` : "";
    const ownersLine = "Your declaration and rules decide whether owners can be charged.";
    if (building === null) {
      return [make(self, ctx, {
        severity: "info", policyId: m.id,
        title: `Your wind or hail deductible is ${pct} of the building value.`,
        detail: `Walkup has no building limit recorded to work out the amount${minText}. ${ownersLine}`,
      })];
    }
    return [make(self, ctx, {
      severity: "info", policyId: m.id,
      title: `Your wind or hail deductible is ${pct} of the building value, about ${money(fromCents(mulCentsBp4(building, bp4)))}.`,
      detail: `${pct} of the ${money(limit)} building limit${minText}. ${ownersLine}`,
    })];
  }),

  r({ id: "CP-DED-01", basis: "common_practice", line: "property", needs: [], citation: null }, (self, ctx) => {
    const m = ctx.master;
    if (!m || rowText(m, "water_damage_deductible") !== null) return [];
    return [make(self, ctx, {
      severity: "info", policyId: m.id, answerableFields: ["water_damage_deductible"],
      title: "Check whether water damage has its own deductible.",
      detail: "Many condo master policies carry a separate, higher deductible for water damage.",
      question: "Does our master policy have a separate water damage deductible, and how much is it?",
    })];
  }),

  r({ id: "CP-VAL-01", basis: "common_practice", line: "property", needs: [], citation: null }, (self, ctx) => {
    const asOf = ctx.facts.replacement_cost_as_of;
    if (!asOf || asOf >= addMonthsClamped(ctx.today, -36)) return [];
    return [make(self, ctx, {
      severity: "ask", policyId: null,
      title: `Your replacement cost estimate is from ${longDate(asOf)}.`,
      detail: "Construction costs change. A current valuation helps set the building limit.",
      question: "When was our building last valued for insurance, and can the insurer update the valuation?",
    })];
  }),

  r({ id: "CP-WB-01", basis: "common_practice", line: "property", needs: ["has_below_grade_units", "has_basement"], citation: null }, (self, ctx) => {
    const m = ctx.master;
    if (!m) return [];
    const below = ctx.facts.has_below_grade_units === true || ctx.facts.has_basement === true;
    if (!below) {
      const unknown = (["has_below_grade_units", "has_basement"] as FactKey[]).filter((k) => ctx.unknown(k));
      if (unknown.length) ctx.missing(...unknown);
      return [];
    }
    if (rowText(m, "water_backup_limit") !== null) return [];
    return [make(self, ctx, {
      severity: "ask", policyId: m.id, answerableFields: ["water_backup_limit"],
      title: "Ask about water and sewer backup coverage.",
      detail: "You have below-grade space. Backup through drains is often excluded unless added.",
      question: "Does our master policy cover water or sewer backup, and with what limit?",
    })];
  }),

  r({ id: "CP-FL-01", basis: "common_practice", line: "flood", needs: ["flood_zone"], citation: null }, (self, ctx) => {
    if (ctx.unknown("flood_zone")) {
      ctx.missing("flood_zone");
      return [];
    }
    if (ctx.lines.flood) return [];
    const zone = ctx.facts.flood_zone as string;
    const question = `We're in flood zone ${zone}. Can you quote flood insurance for the building?`;
    if (/^[AV]/.test(zone)) {
      return [make(self, ctx, {
        severity: "ask", policyId: null, question,
        title: `Your building is in flood zone ${zone} and Walkup has no flood policy.`,
        detail: "Standard property policies exclude flood. Lenders commonly require flood insurance in these zones.",
      })];
    }
    const below = ctx.facts.has_below_grade_units === true || ctx.facts.has_basement === true;
    if ((zone === "X" || zone === "B" || zone === "C") && below) {
      return [make(self, ctx, {
        severity: "info", policyId: null, question,
        title: "Flood is excluded from most property policies.",
        detail: `You're in zone ${zone} with below-grade space.`,
      })];
    }
    return [];
  }),

  r({ id: "CP-EB-01", basis: "common_practice", line: "equipment", needs: ["has_boiler", "has_elevator"], citation: "ICPA_12_D_OTHER" }, (self, ctx) => {
    if (ctx.lines.equipment) return [];
    const boiler = ctx.facts.has_boiler === true;
    const elevator = ctx.facts.has_elevator === true;
    if (!boiler && !elevator) {
      const unknown = (["has_boiler", "has_elevator"] as FactKey[]).filter((k) => ctx.unknown(k));
      if (unknown.length) ctx.missing(...unknown);
      return [];
    }
    const have = boiler && elevator ? "a boiler and an elevator" : boiler ? "a boiler" : "an elevator";
    const equipment = boiler && elevator ? "boiler and elevator" : boiler ? "boiler" : "elevator";
    return [make(self, ctx, {
      severity: "ask", policyId: null,
      title: "Ask about equipment breakdown coverage.",
      detail: `You have ${have}. Sudden mechanical or electrical breakdown is usually excluded from property coverage unless equipment breakdown is added.`,
      question: `Does our policy include equipment breakdown for the ${equipment}?`,
      citationNote: "The Act names equipment breakdown as coverage a declaration may require.",
    })];
  }),

  r({ id: "CP-WC-01", basis: "common_practice", line: "workers_comp", needs: ["has_employees"], citation: null }, (self, ctx) => {
    if (ctx.unknown("has_employees")) {
      ctx.missing("has_employees");
      return [];
    }
    if (ctx.facts.has_employees !== true || ctx.lines.workers_comp) return [];
    const n = ctx.facts.employee_count;
    return [make(self, ctx, {
      severity: "ask", policyId: null,
      title: "You have employees and Walkup has no workers' compensation policy.",
      detail: "Employers commonly need workers' compensation.",
      question: n ? `We have ${n} employee${n === 1 ? "" : "s"}. Can you quote workers' compensation?` : "We have employees. Can you quote workers' compensation?",
    })];
  }),

  r({ id: "CP-WC-02", basis: "common_practice", line: "workers_comp", needs: [], citation: null }, (self, ctx) => {
    if (ctx.facts.uses_volunteers !== true) return [];
    const question = "Does our workers' compensation or another policy cover volunteers who help with the building?";
    const detail = "Workers' compensation doesn't always cover volunteers.";
    const wc = ctx.policiesWithSection("workers_comp");
    if (wc.length === 0) {
      return [make(self, ctx, { severity: "info", policyId: null, title: "Ask whether volunteers are covered.", detail, question })];
    }
    return wc.flatMap((p) => rowBool(p, "wc_covers_volunteers") === true ? [] : [make(self, ctx, {
      severity: "info", policyId: p.id, answerableFields: ["wc_covers_volunteers"],
      title: "Ask whether volunteers are covered.", detail, question,
    })]);
  }),

  r({ id: "CP-EPLI-01", basis: "common_practice", line: "epli", needs: [], citation: "ICPA_12_D_OTHER" }, (self, ctx) => {
    if (ctx.facts.has_employees !== true || ctx.lines.epli) return [];
    return [make(self, ctx, {
      severity: "info", policyId: null,
      title: "Employment practices coverage is commonly carried by employers.",
      detail: "It covers claims such as wrongful firing or discrimination by employees.",
      question: "Can you quote employment practices liability?",
    })];
  }),

  r({ id: "CP-UMB-01", basis: "common_practice", line: "umbrella", needs: [], citation: null }, (self, ctx) => {
    if (ctx.lines.umbrella) return [];
    return [make(self, ctx, {
      severity: "info", policyId: null,
      title: "Ask about an umbrella policy.",
      detail: `An umbrella adds liability limits above general liability${ctx.lines.do ? " and D&O" : ""}.`,
      question: "What umbrella limits are available to us, and what would each cost?",
    })];
  }),

  r({ id: "CP-CRIME-01", basis: "common_practice", line: "crime", needs: [], citation: null }, (self, ctx) =>
    ctx.policiesWithSection("crime").flatMap((p) => {
      const se = cents(rowText(p, "crime_social_engineering_limit"));
      if (se !== null && se > 0) return [];
      return [make(self, ctx, {
        severity: "info", policyId: p.id, answerableFields: ["crime_social_engineering_limit"],
        title: "Ask about social engineering fraud.",
        detail: "Many crime policies cover it only as a small add-on.",
        question: "Does our crime policy cover social engineering fraud (being tricked into paying a fake invoice), and with what limit?",
      })];
    }),
  ),

  r({ id: "CP-DO-01", basis: "common_practice", line: "do", needs: [], citation: null }, (self, ctx) => {
    const quotes = (ctx.input.quotes ?? []).filter((q) => q.coverage === "directors_officers" && !q.declined);
    if (quotes.length === 0) return [];
    return ctx.policiesWithSection("do").flatMap((p) => {
      if (rowBool(p, "do_claims_made") !== true) return [];
      const carrier = p.carrier_name.trim().toLowerCase();
      if (!quotes.some((q) => q.carrierName.trim().toLowerCase() !== carrier)) return [];
      const retro = rowText(p, "do_retro_date");
      return [make(self, ctx, {
        severity: "info", policyId: p.id,
        title: "If you change D&O insurers, keep your prior acts date.",
        detail: `Claims-made D&O only covers acts after the prior acts date. Ask the new insurer to honor ${retro ? longDate(retro) : "your current date"}.`,
        question: "If we change insurers, will the new D&O policy honor our current prior acts date?",
      })];
    });
  }),

  r({ id: "CP-COMM-01", basis: "common_practice", line: null, needs: [], citation: null }, (self, ctx) => {
    if (ctx.facts.has_commercial_space !== true) return [];
    return [make(self, ctx, {
      severity: "info", policyId: null,
      title: "Tell your agent about the commercial space.",
      detail: "A shop or office in the building can change what the policies need to cover.",
      question: "We have commercial space in the building. Is its use disclosed and covered under our policies?",
    })];
  }),
];

const SOURCE_WORDS = [
  { value: "appraisal", label: "appraisal" },
  { value: "insurer_valuation", label: "insurer's valuation" },
  { value: "board_estimate", label: "our own estimate" },
] as const;

// ---------------------------------------------------------------------------
// Engine

const SEVERITY_ORDER: Severity[] = ["gap", "ask", "needs_info", "info"];
const BASIS_ORDER: Basis[] = ["statute", "your_documents", "your_data", "common_practice"];

export function legalChecksFor(stateCode: string, isCondo: boolean): LegalChecks {
  if ((stateCode ?? "").toUpperCase() !== "IL") return "not_illinois";
  return isCondo ? "illinois" : "condo_act_off";
}

function ruleRuns(rule: Rule, legal: LegalChecks): boolean {
  if (rule.id.startsWith("IL-")) return legal === "illinois";
  if (rule.id.startsWith("CICAA-")) return legal === "condo_act_off";
  return true;
}

export function runCoverageCheck(input: CheckInput): {
  findings: Finding[];
  missingFacts: FactKey[];
  counts: Record<Severity, number>;
  notOnFileCount: number;
  legalChecks: LegalChecks;
} {
  const facts = input.facts ?? emptyFacts("");
  const isCondo = input.facts?.is_condominium ?? true;
  const legalChecks = legalChecksFor(input.stateCode, isCondo);
  const counts: Record<Severity, number> = { gap: 0, ask: 0, needs_info: 0, info: 0 };
  const policies = input.policies.filter((p) => !p.archived_at);
  if (policies.length === 0) return { findings: [], missingFacts: [], counts, notOnFileCount: 0, legalChecks };

  const inForce = policies.filter((p) => p.status === "active");
  const sectionsOf = new Map(inForce.map((p) => [p.id, new Set<string>(effectiveSections(p))]));
  const master = inForce
    .filter((p) => p.coverage === "property")
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from) || a.id.localeCompare(b.id))[0] ?? null;
  const missing = new Set<FactKey>();
  const ctx: RuleContext = {
    input: { ...input, policies },
    today: input.todayIso,
    facts,
    isCondo,
    legalChecks,
    inForce,
    lines: linesInForce(inForce),
    master,
    policiesWithSection: (section) => inForce.filter((p) => sectionsOf.get(p.id)?.has(section)),
    missing: (...keys) => keys.forEach((k) => missing.add(k)),
    unknown: (key) => factUnknown(input.facts, key),
  };

  const findings: Finding[] = [];
  for (const rule of RULES) {
    if (!ruleRuns(rule, legalChecks)) continue;
    for (const f of rule.run(ctx)) {
      const d = dismissalFor(input.dismissals, f);
      findings.push(d ? { ...f, dismissed: { reason: d.reason } } : f);
    }
  }

  const lineIndex = (l: LineKey | null) => (l === null ? LINE_KEYS.length : LINE_KEYS.indexOf(l));
  findings.sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
      BASIS_ORDER.indexOf(a.basis) - BASIS_ORDER.indexOf(b.basis) ||
      lineIndex(a.line) - lineIndex(b.line) ||
      a.id.localeCompare(b.id),
  );

  let notOnFileCount = 0;
  for (const f of findings) {
    if (f.dismissed) continue;
    if (f.notOnFile) notOnFileCount += 1;
    else counts[f.severity] += 1;
  }
  return { findings, missingFacts: [...missing], counts, notOnFileCount, legalChecks };
}

/**
 * The dismissal that covers a finding: same rule, same policy, and the same
 * finding id (so one of several findings of a rule is dismissed alone).
 */
export function dismissalFor<T extends { ruleId: string; policyId: string | null; findingKey?: string }>(
  dismissals: T[],
  f: { id: string; ruleId: string; policyId?: string | null },
): T | undefined {
  return dismissals.find(
    (x) =>
      x.ruleId === f.ruleId &&
      (x.policyId ?? null) === (f.policyId ?? null) &&
      ((x.findingKey ?? "") === "" || x.findingKey === f.id),
  );
}

/** The line label for a finding chip ("Building and property"), or null. */
export function findingLineLabel(f: Finding): string | null {
  return f.line ? LINE_LABEL[f.line] : null;
}

/** The coverage form as words for copy ("single entity"). */
export function coverageFormWords(form: string): string {
  return form === "unknown" ? optionLabel(COVERAGE_FORMS, form) : formWords(form);
}
