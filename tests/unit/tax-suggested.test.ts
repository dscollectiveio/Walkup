import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("server-only", () => ({}));

import { PDFDocument } from "pdf-lib";
import { autofill, CONTRACTOR_KEYS, LEDGER_KEYS, SETTING_KEYS, type AutofillInput, type MapEntry } from "@/lib/tax/autofill";
import { FORM_LABEL } from "@/lib/tax/determine";
import { parseDueRule } from "@/lib/tax/due-rules";
import { fillForm, isOfficialFormUrl, sha256Hex } from "@/lib/tax/pdf";
import { SUGGESTED, suggestedByKey, type SuggestedTemplate } from "@/lib/tax/suggested";

// Every suggested map is proven against the PDF it was authored for: the
// fixture JSON (scripts/enumerate-pdf-fields.mjs) for names, types and pages,
// and the PDF itself for the sha256, the title and a real fill round-trip.

interface FieldFixture {
  file: string;
  sha256: string;
  title: string | null;
  pageCount: number;
  fields: { name: string; type: string; page: number | null; maxLength: number | null }[];
}

const FIXTURE_DIR = new URL("../fixtures/tax/", import.meta.url);
const FIXTURES: Record<string, { json: string; pdf: string }> = {
  irs_1120h_2025: { json: "f1120h-2025-fields.json", pdf: "f1120h-2025.pdf" },
  irs_1099_nec_2026: { json: "f1099nec-2026-fields.json", pdf: "f1099nec-2026.pdf" },
};
const fixtureFor = (s: SuggestedTemplate): FieldFixture => {
  const files = FIXTURES[s.key];
  if (!files) throw new Error(`${s.key}: a pdf template needs a fixture in tests/fixtures/tax`);
  return JSON.parse(readFileSync(new URL(files.json, FIXTURE_DIR), "utf8")) as FieldFixture;
};
const pdfFor = (s: SuggestedTemplate) => new Uint8Array(readFileSync(new URL(FIXTURES[s.key].pdf, FIXTURE_DIR)));

const PDF_TEMPLATES = SUGGESTED.filter((s) => s.kind === "pdf");
const LINK_ONLY = SUGGESTED.filter((s) => s.kind === "link_only");
const entriesOf = (s: SuggestedTemplate) => Object.entries(s.fieldMap);

/** The tax_parameters keys seeded in 0005 and 0048 — the only `param:` operands a rule may read. */
const PARAMETER_KEYS = [
  "form_1120h_rate_condo",
  "form_1120h_specific_deduction",
  "form_1120h_income_test",
  "form_1120h_expenditure_test",
  "form_1099_nec_threshold",
];

/** Splits a formula's argument list on top-level commas; null when the parentheses don't balance. */
function splitArgs(inner: string): string[] | null {
  const args: string[] = [];
  let level = 0;
  let cur = "";
  for (const ch of inner) {
    if (ch === "(") level++;
    if (ch === ")") level--;
    if (level < 0) return null;
    if (ch === "," && level === 0) {
      args.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (level !== 0) return null;
  if (cur.trim()) args.push(cur);
  return args;
}

/** Walks a calculated rule the way autofill.ts does, collecting the names and parameters it reads. */
function parseFormula(expr: string, out: { names: string[]; params: string[] }): boolean {
  const e = expr.trim();
  const call = e.match(/^(add|sub|mul|max0)\((.*)\)$/);
  if (call) {
    const args = splitArgs(call[2]);
    if (!args || args.length === 0) return false;
    if (call[1] === "sub" && args.length !== 2) return false;
    if (call[1] === "max0" && args.length !== 1) return false;
    return args.every((a) => parseFormula(a, out));
  }
  if (e.startsWith("param:")) {
    out.params.push(e.slice(6));
    return true;
  }
  if (/^-?\d+(\.\d+)?$/.test(e)) return true;
  if (/^[A-Za-z0-9_.[\]]+$/.test(e)) {
    out.names.push(e);
    return true;
  }
  return false;
}

function operands(rule: string): { ok: boolean; names: string[]; params: string[] } {
  const out = { names: [] as string[], params: [] as string[] };
  return { ok: parseFormula(rule, out), ...out };
}

// pdf-lib announces that it strips the XFA layer from every IRS form it loads.
beforeAll(() => vi.spyOn(console, "warn").mockImplementation(() => {}));
afterAll(() => vi.restoreAllMocks());

describe("the suggested registry", () => {
  it("has one entry per form it promises, each well formed", () => {
    expect(SUGGESTED.map((s) => s.key)).toEqual(["irs_1120h_2025", "irs_1120_2025", "irs_1099_nec_2026", "il_1120_2025", "il_sos_annual_report_2026", "irs_1096_2026"]);
    expect(new Set(SUGGESTED.map((s) => s.key)).size).toBe(SUGGESTED.length);
    for (const s of SUGGESTED) {
      expect(s.key, s.key).toMatch(/^[a-z0-9_]+$/);
      expect(Object.keys(FORM_LABEL), s.key).toContain(s.formCode);
      expect(Number.isInteger(s.taxYear) && s.taxYear >= 2025, s.key).toBe(true);
      expect(isOfficialFormUrl(s.sourceUrl), `${s.key}: ${s.sourceUrl}`).toBe(true);
      if (s.instructionsUrl) expect(isOfficialFormUrl(s.instructionsUrl), `${s.key}: ${s.instructionsUrl}`).toBe(true);
      expect(s.revision.trim(), s.key).not.toBe("");
      expect(["2026-10-11", "2026-10-23"]).toContain(s.authoredOn);
      expect(s.mirror.every((m) => m.from && m.to && m.from !== m.to), s.key).toBe(true);
    }
    expect(suggestedByKey("irs_1120h_2025")?.formCode).toBe("irs_1120h");
    expect(suggestedByKey("nope")).toBeNull();
  });

  it("pins a title and sha256 for pdf templates, and carries no map, title or sha for link-only ones", () => {
    for (const s of PDF_TEMPLATES) {
      expect(s.expectedTitle, s.key).toBeTruthy();
      expect(s.authoredAgainstSha256, s.key).toMatch(/^[0-9a-f]{64}$/);
      expect(s.sourceUrl, s.key).toMatch(/\.pdf$/);
      expect(entriesOf(s).length, s.key).toBeGreaterThan(0);
    }
    for (const s of LINK_ONLY) {
      expect(s.fieldMap, s.key).toEqual({});
      expect(s.expectedTitle, s.key).toBeNull();
      expect(s.authoredAgainstSha256, s.key).toBeNull();
      expect(s.includePages, s.key).toBeNull();
      expect(s.mirror, s.key).toEqual([]);
      expect(s.dueRule, s.key).not.toBeNull();
      expect(s.notes, s.key).toBeTruthy();
    }
  });

  it("due rules parse and carry a citation; filing instructions carry a citation", () => {
    for (const s of SUGGESTED) {
      if (s.dueRule) {
        // The Illinois rule uses the "- 1 MONTHS" form that §5.7 added to due-rules.ts.
        expect(parseDueRule(s.dueRule), `${s.key}: ${s.dueRule}`).not.toBeNull();
        expect(s.dueRuleCitation?.trim(), s.key).toBeTruthy();
      }
      if (s.filingInstructions) expect(s.filingCitation?.trim(), s.key).toBeTruthy();
    }
    expect(suggestedByKey("il_sos_annual_report_2026")?.dueRule).toBe("INCORPORATION_ANNIVERSARY_MONTH - 1 MONTHS, DAY LAST");
  });

  it("never fills a template from code: nothing here says active or verified", () => {
    for (const s of SUGGESTED) {
      expect(Object.keys(s)).not.toContain("active");
      expect(Object.keys(s)).not.toContain("verified_at");
    }
  });
});

describe("every suggested map", () => {
  it("names only fields that exist in the pinned PDF, each on a page the export keeps", () => {
    for (const s of PDF_TEMPLATES) {
      const fixture = fixtureFor(s);
      const byName = new Map(fixture.fields.map((f) => [f.name, f]));
      for (const [name] of entriesOf(s)) {
        expect(byName.has(name), `${s.key}: ${name} is not an AcroForm field in ${fixture.file}`).toBe(true);
        if (s.includePages) expect(s.includePages, `${s.key}: ${name} is on page ${byName.get(name)!.page}`).toContain(byName.get(name)!.page);
      }
    }
  });

  it("gives every line a label, a numbered section, a citation and a kind, and validates like saveFieldMap", () => {
    const allowed: Record<string, readonly string[] | null> = {
      setting: SETTING_KEYS,
      ledger: LEDGER_KEYS,
      contractors: CONTRACTOR_KEYS,
      calculated: null,
      manual: null,
    };
    for (const s of PDF_TEMPLATES) {
      const types = new Map(fixtureFor(s).fields.map((f) => [f.name, f.type]));
      for (const [name, entry] of entriesOf(s)) {
        const at = `${s.key}: ${name}`;
        expect(entry.label.trim(), at).not.toBe("");
        expect(entry.section, at).toMatch(/^\d+\. \S/);
        expect(entry.citation.trim(), at).not.toBe("");
        expect(entry.source in allowed, at).toBe(true);
        const keys = allowed[entry.source];
        // The header-date, incorporation-date and tax-year settings are the SETTING_KEYS §5.6 added to autofill.ts.
        if (keys) expect(keys.includes(entry.rule), `${at}: "${entry.rule}" isn't a ${entry.source} value Walkup can fill`).toBe(true);
        if (entry.source === "calculated") expect(entry.rule, at).toMatch(/^(add|sub|mul|max0)\(/);
        if (entry.source === "manual") expect(entry.rule, at).toBe("");
        expect(["money", "text", "date", "checkbox"], at).toContain(entry.kind);
        expect(entry.kind === "checkbox", `${at}: kind ${entry.kind} on a ${types.get(name)} field`).toBe(types.get(name) === "checkbox");
        if (entry.zeroOk) expect(entry.kind, at).toBe("money");
        if (entry.review) expect(entry.hint, `${at}: say why a person must look`).toBeTruthy();
        if (entry.hint !== undefined) expect(entry.hint.trim(), at).not.toBe("");
      }
    }
  });

  it("calculates only from mapped lines or tax_parameters, with no cycles", () => {
    for (const s of PDF_TEMPLATES) {
      const names = new Set(Object.keys(s.fieldMap));
      const deps = new Map<string, string[]>();
      for (const [name, entry] of entriesOf(s)) {
        if (entry.source !== "calculated") continue;
        const r = operands(entry.rule);
        expect(r.ok, `${s.key}: ${name}: ${entry.rule}`).toBe(true);
        for (const n of r.names) expect(names.has(n), `${s.key}: ${name} reads ${n}, which isn't mapped`).toBe(true);
        for (const p of r.params) expect(PARAMETER_KEYS, `${s.key}: ${name} reads param:${p}`).toContain(p);
        deps.set(name, r.names);
      }
      const seen = new Set<string>();
      const visit = (n: string, path: string[]) => {
        expect(path, `${s.key}: cycle through ${n}`).not.toContain(n);
        if (seen.has(n)) return;
        seen.add(n);
        for (const d of deps.get(n) ?? []) visit(d, [...path, n]);
      };
      for (const n of deps.keys()) visit(n, []);
    }
  });
});

describe("Form 1120-H (2025)", () => {
  const s = suggestedByKey("irs_1120h_2025")!;
  const P = "topmostSubform[0].Page1[0].";
  const line = (suffix: string) => `${P}${suffix}`;
  const ruleOf = (suffix: string) => s.fieldMap[line(suffix)].rule;

  it("is authored against the pinned PDF: same bytes, same title, one page", async () => {
    const fixture = fixtureFor(s);
    const bytes = pdfFor(s);
    expect(await sha256Hex(bytes)).toBe(s.authoredAgainstSha256);
    expect(fixture.sha256).toBe(s.authoredAgainstSha256);
    expect(fixture.title).toBe(s.expectedTitle);
    expect((await PDFDocument.load(bytes, { ignoreEncryption: true })).getTitle()).toBe(s.expectedTitle);
    expect(fixture.pageCount).toBe(1);
    expect(fixture.fields).toHaveLength(70);
    expect(s.includePages).toBeNull();
  });

  it("maps the header, the two tests and lines 1–26 into the five numbered sections", () => {
    expect(new Set(entriesOf(s).map(([, e]) => e.section))).toEqual(
      new Set(["1. About your association", "2. Lines B–E (the two tests)", "3. Gross income (lines 1–8)", "4. Deductions (lines 9–17)", "5. Tax and payments (lines 19–26)"]),
    );
    expect(s.fieldMap[line("NameAddress[0].f1_04[0]")]).toMatchObject({ source: "setting", rule: "association.legal_name", kind: "text" });
    expect(s.fieldMap[line("f1_11[0]")]).toMatchObject({ source: "setting", rule: "association.ein" });
    expect(s.fieldMap[line("f1_12[0]")]).toMatchObject({ source: "setting", rule: "association.incorporated_on_us", kind: "date" });
    expect(s.fieldMap[line("f1_13[0]")]).toMatchObject({ source: "ledger", rule: "exempt_income", kind: "money" });
    expect(s.fieldMap[line("f1_14[0]")]).toMatchObject({ source: "ledger", rule: "exempt_expenditures" });
    expect(s.fieldMap[line("f1_15[0]")]).toMatchObject({ source: "ledger", rule: "total_expenditures" });
    expect(s.fieldMap[line("c1_5[0]")]).toMatchObject({ source: "manual", kind: "checkbox" });
    expect(s.fieldMap[line("f1_16[0]")].zeroOk).toBe(true);
    expect(s.fieldMap[line("f1_18[0]")].hint).toBe("Bank interest goes here.");
    expect(s.fieldMap[line("f1_39[0]")].zeroOk).toBeUndefined();
    // Unmapped on purpose: line 18's 1-pt box, direct deposit, the signer and the preparer.
    for (const blank of ["f1_34[0]", "RoutingNo[0].f1_51[0]", "AccountNo[0].f1_52[0]", "f1_53[0]", "f1_54[0]", "NameAddress[0].f1_06[0]", "NameAddress[0].f1_09[0]"]) {
      expect(s.fieldMap[line(blank)], blank).toBeUndefined();
    }
  });

  it("chains the arithmetic the way the form does, in full field names", () => {
    const L = (n: number) => line(`f1_${n}[0]`);
    expect(operands(ruleOf("f1_24[0]")).names).toEqual([17, 18, 19, 20, 21, 22, 23].map(L)); // line 8 = lines 1–7
    expect(operands(ruleOf("f1_32[0]")).names).toEqual([25, 26, 27, 28, 29, 30, 31].map(L)); // line 16 = lines 9–15
    expect(ruleOf("f1_33[0]")).toBe(`sub(${L(24)},${L(32)})`); // line 17
    expect(ruleOf("f1_35[0]")).toBe(`max0(sub(${L(33)},param:form_1120h_specific_deduction))`); // line 19
    expect(ruleOf("f1_36[0]")).toBe(`mul(${L(35)},param:form_1120h_rate_condo)`); // line 20
    expect(ruleOf("f1_38[0]")).toBe(`sub(${L(36)},${L(37)})`); // line 22
    expect(operands(ruleOf("f1_45[0]")).names).toEqual([39, 40, 41, 42, 43, 44].map(L)); // line 23g
    expect(ruleOf("f1_46[0]")).toBe(`max0(sub(${L(38)},${L(45)}))`); // line 24
    expect(ruleOf("f1_47[0]")).toBe(`max0(sub(${L(45)},${L(38)}))`); // line 25
    expect(ruleOf("f1_24[0]")).toContain("topmostSubform[0].Page1[0].f1_17[0]");
  });

  it("fills the header and lines B–D through autofill from settings and the ledger", () => {
    const base: AutofillInput = {
      settings: {
        "association.legal_name": "2158 N. Damen Condominium Association",
        "association.ein": "36-1234567",
        "association.street_address": "2158 N. Damen Ave.",
        "association.city": "Chicago",
        "association.state_code": "IL",
        "association.postal_code": "60647",
      },
      ledger: {
        exempt_income: { cents: 9_500_000, refs: ["a"] },
        exempt_expenditures: { cents: 8_800_000, refs: ["b"] },
        total_expenditures: { cents: 9_000_000, refs: ["c"] },
      },
      ledgerSettled: true,
      ledgerReviewReason: null,
      contractor: null,
      contractors: null,
      parameters: { form_1120h_specific_deduction: 100, form_1120h_rate_condo: 0.3 },
    };
    // `entered` is what §5.6's autofill reads for lines a person typed; nothing typed here.
    const filled = autofill(s.fieldMap, { ...base, entered: {} });
    const by = (suffix: string) => filled.find((x) => x.pdfFieldName === line(suffix))!;
    expect(by("NameAddress[0].f1_04[0]")).toMatchObject({ value: "2158 N. Damen Condominium Association", confidence: "high" });
    expect(by("f1_11[0]").value).toBe("36-1234567");
    expect(by("NameAddress[0].f1_08[0]").value).toBe("IL");
    expect(by("f1_13[0]")).toMatchObject({ value: "95000.00", confidence: "high", source: "ledger" });
    expect(by("f1_14[0]").value).toBe("88000.00");
    expect(by("f1_15[0]").value).toBe("90000.00");
    expect(by("f1_18[0]")).toMatchObject({ value: null, source: "manual" });
    expect(filled).toHaveLength(Object.keys(s.fieldMap).length);
  });

  it("round-trips sample values for every mapped box through fillForm, checkbox from 'Yes'", async () => {
    const maxLengths = new Map(fixtureFor(s).fields.map((f) => [f.name, f.maxLength]));
    const values: Record<string, string> = {};
    entriesOf(s).forEach(([name, entry], i) => {
      if (entry.kind === "checkbox") return;
      values[name] = sampleValue(entry, i).slice(0, maxLengths.get(name) ?? undefined);
    });
    values[line("c1_5[0]")] = "Yes";

    const filled = await fillForm(pdfFor(s), values, { flatten: false });
    const form = (await PDFDocument.load(filled, { ignoreEncryption: true })).getForm();
    for (const [name, value] of Object.entries(values)) {
      if (name === line("c1_5[0]")) continue;
      expect(form.getTextField(name).getText(), name).toBe(value);
    }
    expect(form.getCheckBox(line("c1_5[0]")).isChecked()).toBe(true);
    expect(form.getCheckBox(line("c1_5[1]")).isChecked()).toBe(false);
    expect(form.getCheckBox(line("c1_5[2]")).isChecked()).toBe(false);
    // Everything unmapped printed blank.
    for (const f of fixtureFor(s).fields) {
      if (f.type === "text" && !(f.name in values)) expect(form.getTextField(f.name).getText() ?? "", f.name).toBe("");
    }
    // And the signable packet flattens.
    const flat = await PDFDocument.load(await fillForm(pdfFor(s), values, { flatten: true }), { ignoreEncryption: true });
    expect(flat.getForm().getFields()).toHaveLength(0);
    expect(flat.getPageCount()).toBe(1);
  });
});

describe("Form 1099-NEC (Rev. December 2026)", () => {
  const s = suggestedByKey("irs_1099_nec_2026")!;
  const P = "topmostSubform[0].CopyB[0].";
  const box = (suffix: string) => `${P}${suffix}`;

  it("is authored against the pinned PDF: same bytes, same title, six pages", async () => {
    const fixture = fixtureFor(s);
    const bytes = pdfFor(s);
    expect(await sha256Hex(bytes)).toBe(s.authoredAgainstSha256);
    expect(fixture.sha256).toBe(s.authoredAgainstSha256);
    expect(fixture.title).toBe(s.expectedTitle);
    expect((await PDFDocument.load(bytes, { ignoreEncryption: true })).getTitle()).toBe(s.expectedTitle);
    expect(fixture.pageCount).toBe(6);
    expect(fixture.fields).toHaveLength(140);
  });

  it("keeps only the contractor's pages: 4 Copy B, 5 recipient instructions, 6 Copy 2", () => {
    const fixture = fixtureFor(s);
    expect(s.includePages).toEqual([4, 5, 6]);
    for (const p of s.includePages!) expect(p >= 1 && p <= fixture.pageCount, `page ${p}`).toBe(true);
    const copyOn = (page: number) => new Set(fixture.fields.filter((f) => f.page === page).map((f) => f.name.split(".")[1]));
    expect(copyOn(2)).toEqual(new Set(["CopyA[0]"]));
    expect(copyOn(3)).toEqual(new Set(["Copy1[0]"]));
    expect(copyOn(4)).toEqual(new Set(["CopyB[0]"]));
    expect(copyOn(5)).toEqual(new Set()); // the instructions page has no boxes
    expect(copyOn(6)).toEqual(new Set(["Copy2[0]"]));
  });

  it("never names Copy A, Copy 1 or the recipient's TIN, and every Copy B box has a Copy 2 twin to mirror", () => {
    const names = new Set(fixtureFor(s).fields.map((f) => f.name));
    expect(s.mirror).toEqual([{ from: "CopyB[0]", to: "Copy2[0]" }]);
    for (const [name] of entriesOf(s)) {
      expect(name).not.toContain("CopyA[0]");
      expect(name).not.toContain("Copy1[0]");
      expect(name).not.toContain("f2_11");
      expect(name).toContain("CopyB[0]");
      expect(names.has(name.replace("CopyB[0]", "Copy2[0]")), `${name} has no Copy 2 twin`).toBe(true);
    }
    expect(s.fieldMap[box("LeftCol[0].f2_11[0]")]).toBeUndefined();
    expect(s.fieldMap[box("LeftCol[0].f2_19[0]")]).toBeUndefined(); // account number
    expect(entriesOf(s)).toHaveLength(13);
    expect(new Set(entriesOf(s).map(([, e]) => e.section))).toEqual(new Set(["1. Your association (payer)", "2. Contractor (recipient)", "3. Amounts"]));
    expect(s.fieldMap[box("RightCol[0].f2_20[0]")]).toMatchObject({ source: "contractors", rule: "contractor.total_paid", kind: "money" });
    expect(s.fieldMap[box("LeftCol[0].f2_13[0]")]).toMatchObject({ source: "contractors", rule: "contractor.address", review: true });
    expect(s.fieldMap[box("PgHeader[0].CalendarYear[0].f2_1[0]")]).toMatchObject({ source: "setting", rule: "form.tax_year" });
  });

  it("fills the payer and the contractor through autofill, never a TIN", () => {
    const base: AutofillInput = {
      settings: { "association.legal_name": "2158 N. Damen Condominium Association", "association.ein": "36-1234567", "association.state_code": "IL" },
      ledger: {},
      ledgerSettled: true,
      ledgerReviewReason: null,
      contractor: { name: "Acme Plumbing LLC", address: "123 W. Main St., Chicago, IL 60601", totalCents: 250_000, expenseIds: ["e1"] },
      contractors: { count: 1, totalCents: 250_000, expenseIds: ["e1"] },
      parameters: {},
    };
    const filled = autofill(s.fieldMap, { ...base, entered: {} });
    const by = (suffix: string) => filled.find((x) => x.pdfFieldName === box(suffix))!;
    expect(by("LeftCol[0].f2_2[0]").value).toBe("2158 N. Damen Condominium Association");
    expect(by("LeftCol[0].f2_10[0]").value).toBe("36-1234567");
    expect(by("LeftCol[0].f2_12[0]")).toMatchObject({ value: "Acme Plumbing LLC", confidence: "high" });
    expect(by("LeftCol[0].f2_13[0]").value).toBe("123 W. Main St., Chicago, IL 60601");
    expect(by("RightCol[0].f2_20[0]")).toMatchObject({ value: "2500.00", source: "contractors" });
    expect(by("LeftCol[0].f2_15[0]").value).toBeNull();
    expect(filled.some((x) => x.pdfFieldName.includes("f2_11"))).toBe(false);
  });

  it("round-trips sample values on Copy B and its mirrored Copy 2 twins, leaving the TIN and Copy A blank", async () => {
    const fixture = fixtureFor(s);
    const maxLengths = new Map(fixture.fields.map((f) => [f.name, f.maxLength]));
    const values: Record<string, string> = {};
    entriesOf(s).forEach(([name, entry], i) => {
      const v = sampleValue(entry, i).slice(0, maxLengths.get(name) ?? undefined);
      values[name] = v;
      for (const m of s.mirror) values[name.replace(m.from, m.to)] = v; // what mirrorValues does at export
    });
    const form = (await PDFDocument.load(await fillForm(pdfFor(s), values, { flatten: false }), { ignoreEncryption: true })).getForm();
    for (const [name, value] of Object.entries(values)) expect(form.getTextField(name).getText(), name).toBe(value);
    expect(form.getTextField(box("LeftCol[0].f2_11[0]")).getText()).toBeUndefined();
    expect(form.getTextField("topmostSubform[0].Copy2[0].LeftCol[0].f2_11[0]").getText()).toBeUndefined();
    for (const f of fixture.fields) {
      if (f.type === "text" && (f.name.includes("CopyA[0]") || f.name.includes("Copy1[0]"))) {
        expect(form.getTextField(f.name).getText() ?? "", f.name).toBe("");
      }
    }
  });
});

describe("the link-only templates", () => {
  it("say where to file and why, and never claim a check nobody made", () => {
    const sos = suggestedByKey("il_sos_annual_report_2026")!;
    expect(sos.filingInstructions).toContain("apps.ilsos.gov/nfpannualreports");
    expect(sos.dueRuleCitation).toContain("805 ILCS 105/114.10");
    expect(sos.notes).toContain("A person confirms these links");

    const il = suggestedByKey("il_1120_2025")!;
    expect(il.dueRule).toBe("FY_END + 4 MONTHS, DAY 15");
    expect(il.notes).toContain("Walkup doesn't fill IL-1120");
    expect(il.notes).toContain("Ask your CPA");

    const t1096 = suggestedByKey("irs_1096_2026")!;
    expect(t1096.dueRule).toBe("CAL_YEAR_END + 1 MONTHS, DAY 31");
    expect(t1096.filingInstructions).toContain("Do not print and file the PDF from irs.gov");

    for (const s of SUGGESTED) {
      const text = [s.notes, s.filingInstructions, s.dueRuleCitation, s.filingCitation].join(" ");
      expect(text).not.toMatch(/verified by Walkup/i);
    }
  });
});

/** Realistic values for the smoke fill, keyed by what the box holds. */
const SAMPLE_BY_RULE: Record<string, string> = {
  "association.legal_name": "2158 N. Damen Condominium Association",
  "association.ein": "36-1234567",
  "association.street_address": "2158 N. Damen Ave.",
  "association.city": "Chicago",
  "association.state_code": "IL",
  "association.postal_code": "60647",
  "association.incorporated_on_us": "03/11/2004",
  "fiscal_year.starts_on_mmdd_noncalendar": "07/01",
  "fiscal_year.ends_on_mmdd_noncalendar": "06/30",
  "fiscal_year.ends_on_yy_noncalendar": "26",
  "form.tax_year": "2026",
  "contractor.name": "Acme Plumbing LLC",
  "contractor.address": "123 W. Main St.",
  "contractor.total_paid": "2500.00",
  exempt_income: "95000.00",
  exempt_expenditures: "88000.00",
  total_expenditures: "90000.00",
};

function sampleValue(entry: MapEntry, i: number): string {
  if (entry.kind === "checkbox") return "Yes";
  if (entry.rule && SAMPLE_BY_RULE[entry.rule]) return SAMPLE_BY_RULE[entry.rule];
  if (entry.kind === "money") return `${100 + i}.${String(i % 100).padStart(2, "0")}`;
  if (entry.kind === "date") return "03/11/2004";
  return "Chicago";
}
