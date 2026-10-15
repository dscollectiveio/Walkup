import { describe, expect, it } from "vitest";
import { REPAIR_VOCABULARY, vocabPhrase } from "@/lib/repairs/vocabulary";
import { TRADES } from "@/lib/contractors/trades";
import { UPKEEP_TEMPLATES } from "@/lib/upkeep/schedule";

describe("REPAIR_VOCABULARY", () => {
  it("has no digits, no unit words and only lowercase letters and hyphens", () => {
    for (const w of REPAIR_VOCABULARY) {
      expect(w).toMatch(/^[a-z][a-z-]*$/);
      expect(w).not.toMatch(/\d/);
    }
    for (const unitWord of ["unit", "apt", "apartment", "suite"]) expect(REPAIR_VOCABULARY.has(unitWord)).toBe(false);
  });

  it("contains every trade's search words and every template's phrase", () => {
    for (const t of TRADES) {
      for (const w of (t.googleQuery ?? "").toLowerCase().split(/\s+/).filter((x) => x && x !== "and")) expect(REPAIR_VOCABULARY.has(w)).toBe(true);
    }
    for (const t of UPKEEP_TEMPLATES) {
      expect(vocabPhrase(t.searchPhrase)).toBe(t.searchPhrase);
    }
    expect(REPAIR_VOCABULARY.has("tap")).toBe(true); // via the plumbing keywords
    expect(REPAIR_VOCABULARY.has("multi-unit")).toBe(true);
    for (const w of ["and", "in", "the", "or"]) expect(REPAIR_VOCABULARY.has(w)).toBe(false);
  });
});

describe("vocabPhrase", () => {
  it("keeps only vocabulary words", () => {
    expect(vocabPhrase("Bo radiator cold")).toBe("radiator cold");
    expect(vocabPhrase("Ada kitchen tap dripping")).toBe("tap dripping");
    expect(vocabPhrase("2158 N Damen leak")).toBe("leak");
    expect(vocabPhrase("Boiler   REPAIR!")).toBe("boiler repair");
  });

  it("keeps at most five words, in order, deduped", () => {
    expect(vocabPhrase("roof leak roof leak gutter downspout chimney flashing")).toBe("roof leak gutter downspout chimney");
  });

  it("is empty when nothing survives", () => {
    expect(vocabPhrase("Bo and Ada at 2158")).toBe("");
    expect(vocabPhrase("Bo Ada 2158 Damen")).toBe("");
    expect(vocabPhrase(null)).toBe("");
    expect(vocabPhrase("")).toBe("");
  });
});
