import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { withUnit } from "@/lib/address/unit";
import { interpretValidation } from "@/lib/address/validate";

describe("adding a unit to an address", () => {
  it("puts the unit after the street, before the city", () => {
    expect(withUnit("2158 N Damen Ave, Chicago, IL 60647", "3")).toBe("2158 N Damen Ave Unit 3, Chicago, IL 60647");
  });
  it("keeps a unit that says what it is", () => {
    expect(withUnit("2158 N Damen Ave, Chicago, IL 60647", "Apt 3B")).toBe("2158 N Damen Ave Apt 3B, Chicago, IL 60647");
    expect(withUnit("2158 N Damen Ave, Chicago, IL 60647", "#4")).toBe("2158 N Damen Ave #4, Chicago, IL 60647");
    expect(withUnit("2158 N Damen Ave", "Suite 200")).toBe("2158 N Damen Ave Suite 200");
  });
  it("leaves the address alone with no unit, and an empty address alone", () => {
    expect(withUnit("2158 N Damen Ave, Chicago", "  ")).toBe("2158 N Damen Ave, Chicago");
    expect(withUnit("", "3")).toBe("");
  });
});

describe("reading Google's USPS address check", () => {
  const std = { firstAddressLine: "2158 N DAMEN AVE APT 3", city: "CHICAGO", state: "IL", zipCode: "60647", zipCodeExtension: "1234" };
  it("confirmed when USPS confirms the delivery point", () => {
    expect(interpretValidation({ result: { uspsData: { dpvConfirmation: "Y", standardizedAddress: std } } })).toEqual({
      status: "confirmed",
      standardized: "2158 N DAMEN AVE APT 3, CHICAGO, IL 60647-1234",
    });
  });
  it("says a unit is needed when the building is real but no unit was given", () => {
    expect(interpretValidation({ result: { uspsData: { dpvConfirmation: "D" } } }).status).toBe("unit_missing");
  });
  it("says the unit could not be confirmed when USPS knows the building but not that unit", () => {
    expect(interpretValidation({ result: { uspsData: { dpvConfirmation: "S" } } }).status).toBe("unit_unconfirmed");
  });
  it("not found when USPS does not know it", () => {
    expect(interpretValidation({ result: { uspsData: { dpvConfirmation: "N" } } }).status).toBe("not_found");
  });
  it("falls back on Google's own verdict with no USPS data", () => {
    expect(interpretValidation({ result: { address: { missingComponentTypes: ["subpremise"] } } }).status).toBe("unit_missing");
    expect(interpretValidation({ result: { verdict: { addressComplete: true } } }).status).toBe("confirmed");
    expect(interpretValidation({ result: { verdict: { addressComplete: false } } }).status).toBe("not_found");
  });
  it("is unavailable when there is no answer", () => {
    expect(interpretValidation({}).status).toBe("unavailable");
  });
});
