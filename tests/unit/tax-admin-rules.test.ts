import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { suggestedByKey, type SuggestedTemplate } from "@/lib/tax/suggested";
import {
  LINK_FORM_CODES,
  LINK_KINDS,
  LINK_SORT_ORDER,
  classifyLinkCheck,
  effectiveWords,
  includePagesText,
  isIlsosHost,
  isOfficialTemplateUrl,
  mirrorText,
  parameterLabel,
  parameterValueWords,
  parseIncludePages,
  parseMirror,
  suggestionDecision,
  validateFieldMap,
  type RawMapEntry,
} from "@/app/admin/tax-templates/rules";

/** The field lists scripts/enumerate-pdf-fields.mjs produced from the pinned PDFs (sha256 included). */
function fixtureFields(name: string): { sha256: string; title: string | null; fields: { name: string }[] } {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/tax/${name}`, import.meta.url)), "utf8"));
}

const h1120 = fixtureFields("f1120h-2025-fields.json");
const nec = fixtureFields("f1099nec-2026-fields.json");
const namesOf = (f: { fields: { name: string }[] }) => new Set(f.fields.map((x) => x.name));

const entry = (over: Partial<RawMapEntry> = {}): RawMapEntry => ({
  label: "Name",
  section: "1. About your association",
  source: "setting",
  rule: "association.legal_name",
  citation: "Form 1120-H (2025), Name",
  ...over,
});

describe("validateFieldMap", () => {
  it("accepts Walkup's suggested 1120-H and 1099-NEC maps against the fixture field names, carrying kind, review, zeroOk and hint", () => {
    for (const [key, fixture] of [
      ["irs_1120h_2025", h1120],
      ["irs_1099_nec_2026", nec],
    ] as const) {
      const s = suggestedByKey(key)!;
      const r = validateFieldMap(s.fieldMap, namesOf(fixture));
      expect("map" in r, `${key}: ${"error" in r ? r.error : ""}`).toBe(true);
      const map = (r as { map: typeof s.fieldMap }).map;
      expect(Object.keys(map)).toEqual(Object.keys(s.fieldMap));
      for (const [name, e] of Object.entries(s.fieldMap)) {
        expect(map[name].kind).toBe(e.kind);
        expect(map[name].review).toBe(e.review);
        expect(map[name].zeroOk).toBe(e.zeroOk);
        expect(map[name].hint).toBe(e.hint);
        expect(map[name].section).toBe(e.section);
      }
    }
  });

  it("refuses the whole map when a name isn't a box on the PDF", () => {
    const names = new Set(["a", "b"]);
    const r = validateFieldMap({ a: entry(), ghost: entry(), ghost2: entry() }, names);
    expect(r).toEqual({ error: "2 mapped fields aren't on this PDF: ghost, ghost2." });
    const one = validateFieldMap({ ghost: entry() }, names);
    expect(one).toEqual({ error: "A mapped field isn't on this PDF: ghost." });
  });

  it("requires a label and a citation, a known source, and a rule the auto-fill reads", () => {
    const names = new Set(["a"]);
    expect(validateFieldMap({ a: entry({ label: " " }) }, names)).toEqual({ error: "a: give the line a plain label." });
    expect(validateFieldMap({ a: entry({ citation: "" }) }, names)).toEqual({ error: "a: cite the instructions line or label this mapping comes from." });
    expect(validateFieldMap({ a: entry({ source: "magic" }) }, names)).toEqual({ error: "a: unknown source." });
    expect(validateFieldMap({ a: entry({ rule: "association.tin" }) }, names)).toEqual({ error: "a: “association.tin” isn't a setting value Walkup can fill." });
    expect(validateFieldMap({ a: entry({ source: "ledger", rule: "net_income" }) }, names)).toEqual({ error: "a: “net_income” isn't a ledger value Walkup can fill." });
    expect(validateFieldMap({ a: entry({ source: "calculated", rule: "avg(b,c)" }) }, names)).toEqual({
      error: "a: a calculation must be add(…), sub(…), mul(…) or max0(…) of other fields.",
    });
    expect(validateFieldMap({ a: entry({ kind: "percent" }) }, names)).toEqual({ error: "a: kind must be money, text, date or checkbox." });
    expect(validateFieldMap({ a: entry({ kind: "text", zeroOk: true }) }, names)).toEqual({ error: "a: “Enter 0” only makes sense on a money line." });
  });

  it("trims what it keeps and leaves the optional flags out when they're off or blank", () => {
    const r = validateFieldMap(
      { a: entry({ label: " Name ", section: "  ", citation: " cite ", rule: " association.legal_name ", kind: "", review: false, zeroOk: false, hint: "   " }) },
      new Set(["a"]),
    );
    expect(r).toEqual({ map: { a: { label: "Name", source: "setting", rule: "association.legal_name", citation: "cite" } } });
    const flagged = validateFieldMap(
      { a: entry({ source: "manual", rule: "", kind: "money", review: true, zeroOk: true, hint: " Bank interest goes here. " }) },
      new Set(["a"]),
    );
    expect(flagged).toEqual({
      map: { a: { label: "Name", section: "1. About your association", source: "manual", rule: "", citation: "Form 1120-H (2025), Name", kind: "money", review: true, zeroOk: true, hint: "Bank interest goes here." } },
    });
  });

  it("accepts an empty map", () => {
    expect(validateFieldMap({}, new Set())).toEqual({ map: {} });
  });
});

describe("pages to keep and mirror pairs", () => {
  it("reads lists and ranges, 1-based, deduplicated and sorted; empty means every page", () => {
    expect(parseIncludePages("")).toEqual({ pages: null });
    expect(parseIncludePages("4, 5, 6")).toEqual({ pages: [4, 5, 6] });
    expect(parseIncludePages("6 4-5 4")).toEqual({ pages: [4, 5, 6] });
    expect(parseIncludePages("0")).toMatchObject({ error: expect.stringContaining("“0” isn't a page number") });
    expect(parseIncludePages("4-2")).toMatchObject({ error: expect.stringContaining("“4-2”") });
    expect(parseIncludePages("four")).toMatchObject({ error: expect.stringContaining("“four”") });
    expect(includePagesText([4, 5, 6])).toBe("4, 5, 6");
    expect(includePagesText(null)).toBe("");
  });

  it("reads one from -> to pair per line, in any of the three arrows", () => {
    expect(parseMirror("")).toEqual({ mirror: [] });
    expect(parseMirror("CopyB[0] -> Copy2[0]\n\nCopyB[0] → Copy1[0]\nCopyB[0]=>CopyC[0]")).toEqual({
      mirror: [
        { from: "CopyB[0]", to: "Copy2[0]" },
        { from: "CopyB[0]", to: "Copy1[0]" },
        { from: "CopyB[0]", to: "CopyC[0]" },
      ],
    });
    expect(parseMirror("CopyB[0]")).toMatchObject({ error: expect.stringContaining("one pair per line") });
    expect(parseMirror("CopyB[0] -> CopyB[0]")).toEqual({ error: "Mirror: “CopyB[0]” can't mirror itself." });
    expect(mirrorText([{ from: "CopyB[0]", to: "Copy2[0]" }])).toBe("CopyB[0] -> Copy2[0]");
    expect(mirrorText(null)).toBe("");
  });
});

describe("suggestionDecision (§3.2)", () => {
  const s = suggestedByKey("irs_1120h_2025")!;
  const pdf = { sha: h1120.sha256, title: h1120.title, names: namesOf(h1120) };

  it("applies the map when the sha256, the title and every mapped name match", () => {
    const r = suggestionDecision(s, pdf);
    expect(r.apply).toBe(true);
    expect(Object.keys((r as { map: Record<string, unknown> }).map)).toEqual(Object.keys(s.fieldMap));
  });

  it("refuses the map, with a note saying what was expected and what came, when the sha256 differs", () => {
    const r = suggestionDecision(s, { ...pdf, sha: "0".repeat(64) });
    expect(r.apply).toBe(false);
    const note = (r as { note: string }).note;
    expect(note).toContain("was NOT applied");
    expect(note).toContain("“2025 Form 1120-H”");
    expect(note).toContain("dffaa4d3079c…");
    expect(note).toContain("000000000000…");
    expect(note).toContain("Map it by hand against the labeled preview");
  });

  it("refuses the map when only the title differs — the same bytes can't have a different title, so this is a republished form", () => {
    const r = suggestionDecision(s, { ...pdf, title: "2026 Form 1120-H" });
    expect(r.apply).toBe(false);
    expect((r as { note: string }).note).toContain("got the title “2026 Form 1120-H”");
    const untitled = suggestionDecision(s, { ...pdf, title: null });
    expect((untitled as { note: string }).note).toContain("got the title “none”");
  });

  it("refuses the whole map when a mapped name isn't on the PDF, naming the field", () => {
    const names = new Set(pdf.names);
    names.delete("topmostSubform[0].Page1[0].f1_13[0]");
    const r = suggestionDecision(s, { ...pdf, names });
    expect(r.apply).toBe(false);
    expect((r as { note: string }).note).toContain("A mapped field isn't on this PDF: topmostSubform[0].Page1[0].f1_13[0].");
  });

  it("applies the 1099-NEC map against its own fixture and never the wrong form's", () => {
    const n = suggestedByKey("irs_1099_nec_2026")!;
    expect(suggestionDecision(n, { sha: nec.sha256, title: nec.title, names: namesOf(nec) }).apply).toBe(true);
    // The 1120-H bytes offered for the 1099 suggestion: wrong sha and title, refused before any name is looked at.
    expect(suggestionDecision(n, pdf).apply).toBe(false);
  });

  it("never decides activation: the result carries a map or a note, nothing else", () => {
    const applied = suggestionDecision(s, pdf) as unknown as Record<string, unknown>;
    expect(Object.keys(applied).sort()).toEqual(["apply", "map"]);
    const refused = suggestionDecision({ ...s, authoredAgainstSha256: "f".repeat(64) } as SuggestedTemplate, pdf) as unknown as Record<string, unknown>;
    expect(Object.keys(refused).sort()).toEqual(["apply", "note"]);
  });
});

describe("classifyLinkCheck", () => {
  const irs = "https://www.irs.gov/forms-pubs/about-form-1120-h";
  const sos = "https://apps.ilsos.gov/nfpannualreports/";

  it("records 200 for a page that answered on an official host", () => {
    expect(classifyLinkCheck(irs, { status: 200, finalUrl: irs })).toBe("200");
    expect(classifyLinkCheck(irs, { status: 204, finalUrl: irs })).toBe("200");
  });

  it("records blocked for a 403 anywhere, and for a dropped connection on ilsos.gov only", () => {
    expect(classifyLinkCheck(irs, { status: 403, finalUrl: irs })).toBe("blocked");
    expect(classifyLinkCheck(sos, { status: 403, finalUrl: sos })).toBe("blocked");
    expect(classifyLinkCheck(sos, { failed: "fetch failed" })).toBe("blocked");
    expect(classifyLinkCheck("https://www.ilsos.gov/departments/business-services/annual-reports.html", { failed: "The operation was aborted due to timeout" })).toBe("blocked");
    expect(classifyLinkCheck(irs, { failed: "fetch failed" })).toBe("error: fetch failed");
    expect(isIlsosHost(sos)).toBe(true);
    expect(isIlsosHost("https://www.ilsos.gov.example.com/")).toBe(false);
    expect(isIlsosHost("not a url")).toBe(false);
  });

  it("records other statuses and off-site redirects as errors", () => {
    expect(classifyLinkCheck(irs, { status: 404, finalUrl: irs })).toBe("error: HTTP 404");
    expect(classifyLinkCheck(irs, { status: 503, finalUrl: irs })).toBe("error: HTTP 503");
    expect(classifyLinkCheck(irs, { status: 200, finalUrl: "https://example.com/landing" })).toBe("error: redirected to example.com");
    expect(classifyLinkCheck(irs, { failed: "x".repeat(300) })).toBe(`error: ${"x".repeat(120)}`);
  });
});

describe("registry constants and URL checks", () => {
  it("mirrors the template CHECK: https, bare or www host of the three sites, and a path", () => {
    expect(isOfficialTemplateUrl("https://www.irs.gov/pub/irs-pdf/f1120h.pdf")).toBe(true);
    expect(isOfficialTemplateUrl("https://tax.illinois.gov/forms/incometax/currentyear/business-corporate.html")).toBe(true);
    expect(isOfficialTemplateUrl("https://ilsos.gov/departments/")).toBe(true);
    expect(isOfficialTemplateUrl("https://www.irs.gov")).toBe(false);
    expect(isOfficialTemplateUrl("http://www.irs.gov/pub/irs-pdf/f1120h.pdf")).toBe(false);
    expect(isOfficialTemplateUrl("https://apps.ilsos.gov/nfpannualreports/")).toBe(false);
    expect(isOfficialTemplateUrl("https://www.ilga.gov/Legislation/")).toBe(false);
    expect(isOfficialTemplateUrl("https://www.irs.gov.example.com/x")).toBe(false);
  });

  it("lists the seven link form codes, the seven kinds and the seeded sort order", () => {
    expect([...LINK_FORM_CODES]).toEqual(["irs_1120h", "irs_1120", "il_1120", "irs_1099_nec", "irs_1096", "il_sos_annual_report", "irs_w9"]);
    expect([...LINK_KINDS]).toEqual(["about", "form", "instructions", "file_online", "order_paper", "guidance", "law"]);
    expect(LINK_SORT_ORDER).toEqual({ about: 10, form: 20, instructions: 30, file_online: 40, order_paper: 50, guidance: 60, law: 70 });
  });
});

describe("rules and thresholds in words", () => {
  it("names the seeded keys plainly and shows an unknown key as itself", () => {
    expect(parameterLabel("form_1099_nec_threshold")).toMatch(/^1099-NEC threshold/);
    expect(parameterLabel("form_1120h_rate_condo")).toMatch(/^1120-H tax rate/);
    expect(parameterLabel("something_new")).toBe("something_new");
  });

  it("shows rates and tests as percentages and amounts as dollars, from the DB's text numeric", () => {
    expect(parameterValueWords("form_1120h_rate_condo", "0.300000")).toBe("30%");
    expect(parameterValueWords("form_1120h_income_test", "0.600000")).toBe("60%");
    expect(parameterValueWords("form_1120h_expenditure_test", 0.9)).toBe("90%");
    expect(parameterValueWords("form_1120h_specific_deduction", "100.000000")).toBe("$100.00");
    expect(parameterValueWords("form_1099_nec_threshold", "2000.000000")).toBe("$2,000.00");
    expect(parameterValueWords("form_1099_nec_threshold", "600")).toBe("$600.00");
    expect(parameterValueWords("form_1099_nec_threshold", "abc")).toBe("abc");
  });

  it("reads the half-open period as 'through' the day before effective_to", () => {
    expect(effectiveWords("2020-01-01", "2026-01-01")).toBe("Jan 1, 2020 through Dec 31, 2025");
    expect(effectiveWords("2026-01-01", null)).toBe("from Jan 1, 2026");
    expect(effectiveWords("2024-02-01", "2024-03-01")).toBe("Feb 1, 2024 through Feb 29, 2024");
  });
});
