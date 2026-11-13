import { describe, expect, it } from "vitest";
import { formatUsPhone, isValidRoutingNumber, maskAccount, memoInstruction, paymentDetailsProblem } from "@/lib/dues/payment-details";

const none = { payee: null, bank: null, routing: null, account: null, zelleEmail: null, zellePhone: null, mailing: null };

describe("routing number", () => {
  it("accepts a real checksum and rejects a typo or the wrong length", () => {
    expect(isValidRoutingNumber("021000021")).toBe(true); // JPMorgan Chase
    expect(isValidRoutingNumber("021 000-021")).toBe(true);
    expect(isValidRoutingNumber("021000022")).toBe(false);
    expect(isValidRoutingNumber("12345678")).toBe(false);
    expect(isValidRoutingNumber("abcdefghi")).toBe(false);
  });
});

describe("masking", () => {
  it("shows only the last four", () => {
    expect(maskAccount("000123456789")).toBe("••••6789");
    expect(maskAccount("1234")).toBe("••••");
  });
});

describe("payment details", () => {
  it("needs at least one way to pay, not specific fields", () => {
    expect(paymentDetailsProblem(none)?.message).toMatch(/at least one way/);
    expect(paymentDetailsProblem({ ...none, zelleEmail: "pay@x.test" })).toBeNull();
    expect(paymentDetailsProblem({ ...none, mailing: "PO Box 1" })).toBeNull();
  });
  it("Zelle needs only one of email or phone, and each must look right", () => {
    expect(paymentDetailsProblem({ ...none, zellePhone: "312-555-0142" })).toBeNull();
    expect(paymentDetailsProblem({ ...none, zelleEmail: "nope" })).toMatchObject({ field: "dues_zelle_handle" });
    expect(paymentDetailsProblem({ ...none, zellePhone: "555" })).toMatchObject({ field: "dues_zelle_phone" });
    expect(formatUsPhone("1 312 555 0142")).toBe("(312) 555-0142");
  });
  it("a started bank section needs payee, routing and account, and a valid routing number", () => {
    expect(paymentDetailsProblem({ ...none, payee: "HOA", account: "1" })).toMatchObject({ field: "dues_routing_number" });
    expect(paymentDetailsProblem({ ...none, payee: "HOA", zelleEmail: "a@b.test" })).toBeNull();
    expect(paymentDetailsProblem({ ...none, payee: "HOA", routing: "021000021" })).toMatchObject({ field: "dues_account_number" });
    const bad = paymentDetailsProblem({ ...none, payee: "HOA", routing: "021000022", account: "1" });
    expect(bad?.field).toBe("dues_routing_number");
    expect(bad?.message).toMatch(/routing number doesn't look right/);
    expect(paymentDetailsProblem({ ...none, payee: "HOA", routing: "021000021", account: "123" })).toBeNull();
  });
  it("the memo line carries the owner's unit", () => {
    expect(memoInstruction("Unit 2")).toBe('Put "Unit 2" in the memo.');
  });
});
