import { describe, expect, it } from "vitest";
import { emptyFacts, factUnknown, parseFactsInput } from "@/lib/insurance/facts";
import { factGuesses, guessNote } from "@/lib/insurance/guesses";

describe("factGuesses", () => {
  it("guesses yes from upkeep task names", () => {
    const g = factGuesses(null, ["Boiler inspection", "Elevator annual test", "Gutter cleaning"]);
    expect(g).toEqual([
      { key: "has_boiler", value: true, from: "Boiler inspection" },
      { key: "has_elevator", value: true, from: "Elevator annual test" },
    ]);
    expect(factGuesses(null, ["Fire suppression check"])[0].key).toBe("has_sprinklers");
    expect(guessNote(g[0])).toBe('Walkup guessed this from your upkeep list ("Boiler inspection"). Confirm.');
  });

  it("never guesses over an answered fact (even a no)", () => {
    const facts = { ...emptyFacts("a"), has_boiler: false };
    expect(factGuesses(facts, ["Boiler inspection"])).toEqual([]);
  });
});

describe("facts form parsing", () => {
  it("maps the form strings to a row patch with only the posted keys", () => {
    const r = parseFactsInput({
      has_boiler: "yes",
      has_elevator: "no",
      has_basement: "unsure",
      replacement_cost_estimate: "$2.6M",
      rental_share: "30%",
      flood_zone: "AE",
      declaration_required_lines: ["directors_officers", "umbrella"],
      building_count: "2",
    });
    expect(r).toEqual({
      ok: true,
      patch: {
        has_boiler: true,
        has_elevator: false,
        has_basement: null,
        replacement_cost_estimate: "2600000.00",
        rental_share: "0.3000",
        flood_zone: "AE",
        declaration_required_lines: ["directors_officers", "umbrella"],
        building_count: 2,
      },
    });
  });

  it("refuses bad values with a plain message", () => {
    expect(parseFactsInput({ rental_share: "130" })).toMatchObject({ ok: false });
    expect(parseFactsInput({ flood_zone: "Q" })).toMatchObject({ ok: false });
    expect(parseFactsInput({ declaration_required_lines: ["yachts"] })).toMatchObject({ ok: false });
  });

  it("'Not sure' about being a condominium keeps the default", () => {
    expect(parseFactsInput({ is_condominium: "unsure" })).toEqual({ ok: true, patch: { is_condominium: true } });
    expect(parseFactsInput({ is_condominium: "no" })).toEqual({ ok: true, patch: { is_condominium: false } });
  });

  it("factUnknown treats null, blank and 'unknown' alike", () => {
    expect(factUnknown(null, "flood_zone")).toBe(true);
    expect(factUnknown({ ...emptyFacts("a"), flood_zone: "unknown" }, "flood_zone")).toBe(true);
    expect(factUnknown({ ...emptyFacts("a"), flood_zone: "X" }, "flood_zone")).toBe(false);
  });
});
