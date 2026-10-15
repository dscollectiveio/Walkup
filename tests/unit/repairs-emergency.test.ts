import { describe, expect, it } from "vitest";
import {
  buildingFactLines, detectEmergency, EMERGENCY_GUIDANCE, EMERGENCY_KINDS, EMERGENCY_RULES, type BuildingEmergencyInfo,
} from "@/lib/repairs/emergency";
import { isTradeSlug } from "@/lib/contractors/trades";

const OCTOBER = new Date(2026, 9, 14);
const JANUARY = new Date(2027, 0, 10);
const JULY = new Date(2026, 6, 10);
const DECEMBER = new Date(2026, 11, 5);

describe("detectEmergency: the required strings", () => {
  it.each([
    ["Water stain on the hallway ceiling", null],
    ["Flood light is out", null],
    ["Fire alarm keeps chirping", null],
    ["CO alarm needs a battery", null],
    ["CO detector beeping, probably the battery", null],
    ["Pilot flame went out", null],
    ["The gas smell is gone now", null],
    ["No smell of gas", null],
    ["Fire extinguisher is expired", null],
    ["Fire escape is rusty", null],
    ["Spark plug on the snow blower", null],
    ["I smell gas in the hallway", "gas"],
    ["Smell gas near a sparking outlet", "gas"],
    ["CO alarm is going off", "carbon_monoxide"],
    ["Smoke is coming from the basement", "fire"],
    ["Water is pouring from the light fixture", "flooding"],
    ["Water coming through the ceiling", "flooding"],
    ["Basement is flooded", "flooding"],
    ["Sewer backing up in the basement", "sewage"],
    ["Someone is stuck in the elevator", "elevator_entrapment"],
  ])("%s -> %s", (text, kind) => {
    expect(detectEmergency(text, OCTOBER)?.kind ?? null).toBe(kind);
  });

  it("no heat only fires in the heating season", () => {
    expect(detectEmergency("No heat", JANUARY)?.kind).toBe("no_heat");
    expect(detectEmergency("No heat", JULY)).toBeNull();
    expect(detectEmergency("Radiator cold", DECEMBER)?.kind).toBe("no_heat");
    expect(detectEmergency("Radiator cold", JULY)).toBeNull();
    expect(detectEmergency("Boiler is not working", new Date(2026, 3, 30))?.kind).toBe("no_heat"); // April
    expect(detectEmergency("Boiler is not working", new Date(2026, 4, 1))).toBeNull(); // May
  });
});

describe("detectEmergency: suppressions and order", () => {
  it("ignores a match negated in the 12 characters before it", () => {
    expect(detectEmergency("There is no gas smell", OCTOBER)).toBeNull();
    expect(detectEmergency("We don't smell gas anymore", OCTOBER)).toBeNull();
    expect(detectEmergency("It's not flooding", OCTOBER)).toBeNull();
    // "casino" ends in "no " but isn't the word "no".
    expect(detectEmergency("The casino smell of gas", OCTOBER)?.kind).toBe("gas");
  });

  it("ignores a match resolved in the 20 characters after it", () => {
    expect(detectEmergency("Basement flooded but it stopped", OCTOBER)).toBeNull();
    expect(detectEmergency("Sparking outlet, now fixed", OCTOBER)).toBeNull();
    expect(detectEmergency("Gas leak is under control", OCTOBER)).toBeNull();
  });

  it("applies a rule's exclude to the match and what follows", () => {
    expect(detectEmergency("Water on the ceiling, old mark", OCTOBER)).toBeNull();
    expect(detectEmergency("Elevator door stuck open", OCTOBER)).toBeNull();
    expect(detectEmergency("Elevator stuck at the floor below", OCTOBER)).toBeNull();
    expect(detectEmergency("Carbon monoxide alarm chirping", OCTOBER)).toBeNull();
  });

  it("checks every occurrence, not just the first", () => {
    expect(detectEmergency("No smell of gas yesterday. Today I smell gas in the hall", OCTOBER)?.kind).toBe("gas");
  });

  it("returns the first rule in severity order, its trade and the matched text", () => {
    const hit = detectEmergency("Smell gas near a sparking outlet", OCTOBER)!;
    expect(hit).toEqual({ kind: "gas", trade: "plumbing", matched: "smell gas" });
    expect(detectEmergency("Sparking outlet and the basement is flooded", OCTOBER)?.kind).toBe("electrical");
    expect(detectEmergency("The basement is flooded and the sewer is backing up", OCTOBER)?.kind).toBe("flooding");
    expect(detectEmergency("Fire in the  basement, smoke   everywhere", OCTOBER)?.kind).toBe("fire");
  });

  it("straightens quotes before matching", () => {
    expect(detectEmergency("We don’t smell gas", OCTOBER)).toBeNull();
  });

  it("covers every kind once, with real trades and guidance", () => {
    expect(EMERGENCY_RULES.map((r) => r.kind)).toEqual(["gas", "carbon_monoxide", "fire", "elevator_entrapment", "electrical", "flooding", "sewage", "no_heat"]);
    expect([...EMERGENCY_RULES.map((r) => r.kind)].sort()).toEqual([...EMERGENCY_KINDS].sort());
    for (const r of EMERGENCY_RULES) expect(isTradeSlug(r.trade)).toBe(true);
    for (const k of EMERGENCY_KINDS) {
      const g = EMERGENCY_GUIDANCE[k];
      expect(g.headline.length).toBeGreaterThan(0);
      expect(g.callHref === null).toBe(g.callLabel === null);
      expect(`${g.headline} ${g.steps.join(" ")}`).not.toMatch(/—/);
    }
    expect(EMERGENCY_GUIDANCE.gas.headline).toBe("If you smell gas, leave first.");
    expect(EMERGENCY_GUIDANCE.gas.callHref).toBe("tel:911");
  });
});

describe("buildingFactLines", () => {
  const EMPTY: BuildingEmergencyInfo = {
    water_shutoff_location: null, gas_utility_name: null, gas_emergency_phone: null,
    electric_panel_location: null, electric_utility_name: null, electric_emergency_phone: null,
    elevator_company_name: null, elevator_company_phone: null, other_notes: null,
  };

  it("shows only facts the board entered and never fills a gap", () => {
    expect(buildingFactLines("gas", null)).toEqual([]);
    expect(buildingFactLines("gas", EMPTY)).toEqual([]);
    expect(buildingFactLines("flooding", EMPTY)).toEqual([]);
    // A utility name without a number is not a line.
    expect(buildingFactLines("gas", { ...EMPTY, gas_utility_name: "Peoples Gas" })).toEqual([]);
    expect(buildingFactLines("fire", { ...EMPTY, water_shutoff_location: "Basement, by the meter" })).toEqual([]);
  });

  it("formats each line with a tel link on phone numbers", () => {
    expect(buildingFactLines("gas", { ...EMPTY, gas_utility_name: "Peoples Gas", gas_emergency_phone: "(866) 556-6002" })).toEqual([
      { label: "Gas company emergency line", text: "Peoples Gas (866) 556-6002", tel: "tel:8665566002" },
    ]);
    expect(buildingFactLines("gas", { ...EMPTY, gas_emergency_phone: "866-556-6002" })).toEqual([
      { label: "Gas company emergency line", text: "866-556-6002", tel: "tel:8665566002" },
    ]);
    expect(buildingFactLines("flooding", { ...EMPTY, water_shutoff_location: "Basement, by the meter" })).toEqual([
      { label: "Main water shut-off", text: "Basement, by the meter", tel: null },
    ]);
    expect(buildingFactLines("electrical", {
      ...EMPTY, electric_panel_location: "Rear hall closet", electric_utility_name: "ComEd", electric_emergency_phone: "1-800-334-7661",
    })).toEqual([
      { label: "Electric panel", text: "Rear hall closet", tel: null },
      { label: "Power company emergency line", text: "ComEd 1-800-334-7661", tel: "tel:18003347661" },
    ]);
    expect(buildingFactLines("elevator_entrapment", { ...EMPTY, elevator_company_name: "Lift Co", elevator_company_phone: "312 555 0100" })).toEqual([
      { label: "Elevator company", text: "Lift Co 312 555 0100", tel: "tel:3125550100" },
    ]);
  });
});
