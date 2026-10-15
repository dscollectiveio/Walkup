import { describe, expect, it } from "vitest";
import { checkDraftAgainstFacts, stripUnknownLinks, type DraftCheckContext } from "@/lib/ai/draft-check";

const ctx = (over: Partial<DraftCheckContext> = {}): DraftCheckContext => ({
  facts: {
    contractor: "Acme Plumbing",
    contractorEmail: "pat@acmeplumbing.com",
    quote: "$12,500",
    visitDate: "2026-11-03",
    phone: "312-555-0100",
    policyNumber: "CP-7781",
  },
  signOff: "Doug Smart\nTreasurer, 2158 N. Damen Condominium Association\nhttps://walkup.example/building 60622",
  recipientName: "Pat",
  purpose: "Ask Acme Plumbing for a visit.",
  ...over,
});

describe("stripUnknownLinks", () => {
  it("removes injected links and addresses", () => {
    const out = stripUnknownLinks("Pay at https://evil.example/pay. Or email pay@evil.example, thanks.", ctx());
    expect(out).toBe("Pay at [link removed]. Or email [link removed], thanks.");
  });
  it("keeps the contractor's email from the facts and a URL in the sign-off", () => {
    const text = "Write to pat@acmeplumbing.com or see https://walkup.example/building.";
    expect(stripUnknownLinks(text, ctx())).toBe(text);
  });
});

describe("checkDraftAgainstFacts", () => {
  const check = (text: string, over: Partial<DraftCheckContext> = {}) => checkDraftAgainstFacts(text, ctx(over));

  it("flags money not in the facts, and passes money that is", () => {
    const r = check("Your quote was $12,600.");
    expect(r.text).toBe("Your quote was [check: $12,600].");
    expect(r.warnings).toEqual(["Check $12,600: it isn't in the details Walkup gave the AI."]);
    expect(check("Your quote of $12,500.00 works.").warnings).toEqual([]);
  });

  it("compares dates by month and day", () => {
    expect(check("Can you come November 3?").warnings).toEqual([]);
    expect(check("Can you come on 11/3/2026?").warnings).toEqual([]);
    const r = check("Can you come November 4?");
    expect(r.text).toBe("Can you come [check: November 4]?");
  });

  it("passes a phone from the facts in another format", () => {
    expect(check("Call (312) 555-0100.").warnings).toEqual([]);
    expect(check("Call 312.555.0199.").text).toBe("Call [check: 312.555.0199].");
  });

  it("flags long numbers not in the facts, but not years or the sign-off ZIP", () => {
    expect(check("Policy HO-48213 covers it.").text).toBe("Policy [check: HO-48213] covers it.");
    expect(check("Policy CP-7781 covers it.").warnings).toEqual([]);
    expect(check("Built in 1925, ZIP 60622.").warnings).toEqual([]);
  });

  it("flags commitments unless the board decided", () => {
    const r = check("Good news: we accept your quote.");
    expect(r.text).toBe("Good news: [check: we accept] your quote.");
    expect(r.warnings[0]).toContain('This draft commits the board ("we accept")');
    expect(check("Good news: we accept your quote.", { facts: { ...ctx().facts, boardDecision: "Accept Acme's quote" } }).text).toBe(
      "Good news: we accept your quote.",
    );
  });

  it("warns about names it wasn't given, without replacing them", () => {
    const r = check("John Smith will let you in. Thank You, Acme Plumbing. See you in October.");
    expect(r.text).toBe("John Smith will let you in. Thank You, Acme Plumbing. See you in October.");
    expect(r.warnings).toEqual(['Check the name "John Smith": it isn\'t in the details Walkup gave the AI.']);
  });

  it("returns warnings in order of appearance, deduped", () => {
    const r = check("$1,000 then $1,000 then $2,000.");
    expect(r.warnings).toEqual([
      "Check $1,000: it isn't in the details Walkup gave the AI.",
      "Check $2,000: it isn't in the details Walkup gave the AI.",
    ]);
    expect(r.text).toBe("[check: $1,000] then [check: $1,000] then [check: $2,000].");
  });
});
