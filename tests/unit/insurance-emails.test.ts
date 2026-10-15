import { describe, expect, it } from "vitest";
import {
  EMAIL_KINDS,
  checkModelDraft,
  detailsBlock,
  draftFacts,
  fillPlaceholders,
  requiredPlaceholders,
  switchingChecklist,
  templateDraft,
  type DraftInputByKind,
  type EmailKind,
  type QuoteRequestPayloadV2,
} from "@/lib/insurance/emails";

const filler =
  "We're hoping to review the association's coverage before the renewal and would be grateful for your help. Please let us know if you need anything else from the board, and thank you for your time.";

function draft(body: string, subject = "Quote request for our building") {
  return { subject, body: `Hello {{agent_name}},\n\n${body}\n\n${filler}\n\nThank you,\n{{sender_name}}\n{{sender_contact}}` };
}

const REQUIRED = requiredPlaceholders("quote_request", { renewalKnown: false });
const good = draft("We are {{building_description}}. Here is what we'd like quoted:\n\n{{details_block}}");

describe("checkModelDraft", () => {
  it("accepts a clean draft", () => {
    expect(checkModelDraft(good, REQUIRED)).toEqual({ ok: true });
  });

  it("rejects a missing required placeholder", () => {
    const r = checkModelDraft(draft("We are {{building_description}}."), REQUIRED);
    expect(r).toMatchObject({ ok: false });
    expect((r as { reasons: string[] }).reasons).toContain("it left out {{details_block}}");
  });

  it("rejects an unknown placeholder", () => {
    expect(checkModelDraft(draft("{{building_description}} {{details_block}} {{policy_limit}}"), REQUIRED).ok).toBe(false);
  });

  it("rejects a digit, but allows HO-6", () => {
    expect(checkModelDraft(draft("{{building_description}} {{details_block}} We pay $5,000."), REQUIRED).ok).toBe(false);
    expect(checkModelDraft(draft("{{building_description}} {{details_block}} We have 3 units."), REQUIRED).ok).toBe(false);
    expect(checkModelDraft(draft("{{building_description}} {{details_block}} Owners carry HO-6 policies."), REQUIRED)).toEqual({ ok: true });
  });

  it("rejects an em dash, 'bind' and other commitments, and a duplicate placeholder", () => {
    expect(checkModelDraft(draft("{{building_description}} — {{details_block}}"), REQUIRED).ok).toBe(false);
    expect(checkModelDraft(draft("{{building_description}} {{details_block}} Please bind coverage."), REQUIRED).ok).toBe(false);
    expect(checkModelDraft(draft("{{building_description}} {{details_block}} We'll take it."), REQUIRED).ok).toBe(false);
    expect(checkModelDraft(draft("{{building_description}} {{details_block}} {{details_block}}"), REQUIRED)).toMatchObject({ ok: false });
  });

  it("checks lengths", () => {
    expect(checkModelDraft({ subject: "x".repeat(121), body: good.body }, REQUIRED).ok).toBe(false);
    expect(checkModelDraft({ subject: "Hi", body: "{{building_description}} {{details_block}} {{sender_name}}" }, REQUIRED).ok).toBe(false);
  });
});

describe("fillPlaceholders", () => {
  it("fills values and strips lines left empty by an optional value", () => {
    const out = fillPlaceholders("Hello {{agent_name}},\n\nBody.\n\nThank you,\n{{sender_name}}\n{{sender_contact}}", { agent_name: "Pat", sender_name: "Cy", sender_contact: "" });
    expect(out).toBe("Hello Pat,\n\nBody.\n\nThank you,\nCy");
  });

  it("collapses the blank lines around a removed block", () => {
    expect(fillPlaceholders("A\n\n{{details_block}}\n\nB", {})).toBe("A\n\nB");
  });
});

describe("templateDraft", () => {
  const values = {
    agent_name: "Pat", association_name: "2158 N. Damen Condominium Association", building_description: "a 3-unit condominium in Chicago",
    policy_reference: "our master policy with West Bend (policy BOP-1)", details_block: "THE ASSOCIATION\nLegal name: X",
    question: "Is it special form?", certificate_holder: "First Bank\n1 Main St", loss_details: "Roof leak on Aug 1, 2026",
    change_details: "Add the manager as an additional insured", original_date: "October 1, 2026", renewal_date: "March 1, 2027",
    sender_name: "Cy Board", sender_contact: "cy@example.com", coverage: "master", coverages: "Master policy",
  };

  for (const kind of EMAIL_KINDS) {
    it(`${kind}: nothing left unfilled, no em dash`, () => {
      const d = templateDraft(kind, values);
      expect(d.subject + d.body).not.toContain("{{");
      expect(d.subject + d.body).not.toContain("—");
      expect(d.body).toContain("Cy Board");
    });
  }

  it("quote_request mentions the renewal only when known; agent defaults to 'there'", () => {
    expect(templateDraft("quote_request", values).body).toContain("ahead of our renewal on March 1, 2027");
    const d = templateDraft("quote_request", { ...values, renewal_date: null, agent_name: null });
    expect(d.body).not.toContain("renewal on");
    expect(d.body.startsWith("Hello there,")).toBe(true);
  });
});

const payload: QuoteRequestPayloadV2 = {
  version: 2,
  association: {
    legal_name: "2158 N. Damen Condominium Association", address: "2158 N Damen Ave, Chicago, IL 60647", city: "Chicago", units: 3,
    year_built: 1905, construction: "joisted_masonry", stories: 3, roof_replaced_year: 2019, total_square_feet: 4200,
    has_sprinklers: false, has_amenities: true, rental_share: "0.3333",
  },
  coverages: [
    { coverage: "property", wanted: { building_limit: "2400000.00", valuation: "replacement_cost", cause_of_loss_form: "special", coverage_form: "single_entity" } },
    { coverage: "general_liability", wanted: { liability_per_occurrence: "1000000.00" } },
    { coverage: "directors_officers", wanted: { do_limit: "1000000.00" } },
    { coverage: "fidelity_crime", wanted: { crime_limit: "150000.00" } },
  ],
  deductibles_today: { property: "5000.00", water: "25000.00", wind_hail: null, wind_hail_percent: null },
  current: null,
  claims: [{ date_of_loss: "2026-08-01", description: "Roof leak into the stairwell", status: "open", amount_paid: "12000.00" }],
  include_claim_amounts: false,
  anything_else: null,
  contact: { name: "Cy Board", email: "cy@example.com", phone: null },
};

describe("detailsBlock", () => {
  it("formats the association, coverage and claims", () => {
    expect(detailsBlock(payload)).toBe([
      "THE ASSOCIATION",
      "Legal name: 2158 N. Damen Condominium Association",
      "Address: 2158 N Damen Ave, Chicago, IL 60647",
      "Units: 3 · Stories: 3 · Built: 1905 · Construction: Brick or block walls, wood floors",
      "Roof last replaced: 2019",
      "Total square feet: 4,200 · Sprinklers: no · Shared amenities: yes",
      "Units rented out: about 33%",
      "",
      "COVERAGE WE'RE ASKING ABOUT",
      "Master policy: building limit $2,400,000 (replacement cost), special form, single entity",
      "General liability: $1,000,000 per occurrence",
      "Directors and officers: $1,000,000",
      "Crime and fidelity bond: $150,000",
      "Deductibles today: $5,000 all perils, $25,000 water damage",
      "",
      "CLAIMS IN THE LAST 5 YEARS",
      "Aug 1, 2026: Roof leak into the stairwell (open)",
    ].join("\n"));
  });

  it("omits unknown lines, shows current insurance only when shared, and claim amounts only when included", () => {
    const bare = detailsBlock({
      ...payload,
      association: { ...payload.association, total_square_feet: null, has_sprinklers: null, has_amenities: null, rental_share: null, roof_replaced_year: null, construction: null },
    });
    expect(bare).not.toMatch(/Square feet|Sprinklers|Shared amenities|rented|Roof last|Construction/);
    expect(bare).not.toContain("CURRENT INSURANCE");
    const shared = detailsBlock({ ...payload, current: { carrier: "West Bend", renews_on: "2027-03-01", premium: "3766.00" }, include_claim_amounts: true, anything_else: "Ask about the roof deck." });
    expect(shared).toContain("CURRENT INSURANCE\nWest Bend, renews March 1, 2027, $3,766 a year");
    expect(shared).toContain("Aug 1, 2026: Roof leak into the stairwell (open, $12,000 paid)");
    expect(shared).toContain("ANYTHING ELSE\nAsk about the roof deck.");
  });
});

const INPUTS: { [K in EmailKind]: DraftInputByKind[K] } = {
  quote_request: { contactKind: "agency", isCurrentAgent: true, coverages: ["property", "directors_officers"], renewalKnown: true, findingLines: ["crime", "do"] },
  quote_follow_up: { contactKind: "broker", daysSinceSent: 15, coverages: ["property"] },
  coverage_question: { contactKind: "agent", isCurrentAgent: true, coverage: "property", line: "property", basis: "statute" },
  certificate_request: { contactKind: "agent", holderKind: "mortgage_lender", coverages: ["property"] },
  claim_report: { contactKind: "insurer", coverage: "property", linkedToRepair: true },
  change_request: { contactKind: "adjuster", changeKind: "raise_limit", coverage: "fidelity_crime" },
  documents_request: { contactKind: "agent", isCurrentAgent: true },
  quote_decline: { contactKind: "agency", coverages: ["umbrella"] },
};

describe("draftFacts", () => {
  const blocked = /name|email|phone|address|amount|number/i;
  const keysOf = (v: unknown): string[] =>
    v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]) : [];

  for (const kind of EMAIL_KINDS) {
    it(`${kind}: no digit, no @, no personal keys`, () => {
      const facts = draftFacts(kind, INPUTS[kind]);
      const json = JSON.stringify(facts);
      expect(json).not.toMatch(/\d/);
      expect(json).not.toContain("@");
      expect(keysOf(facts).filter((k) => blocked.test(k))).toEqual([]);
    });
  }

  it("quote_follow_up uses elapsed buckets; unknown contact kinds read as agent", () => {
    expect(draftFacts("quote_follow_up", { ...INPUTS.quote_follow_up, daysSinceSent: 8 }).elapsed).toBe("about_a_week");
    expect(draftFacts("quote_follow_up", INPUTS.quote_follow_up).elapsed).toBe("two_weeks_plus");
    expect(draftFacts("change_request", INPUTS.change_request).recipientKind).toBe("agent");
    expect(draftFacts("quote_request", INPUTS.quote_request)).toMatchObject({ hasOpenFindings: true, findingTopics: ["Crime and fidelity bond", "Directors and officers"] });
    expect(draftFacts("coverage_question", INPUTS.coverage_question).basis).toBe("illinois_law");
  });

  it("requiredPlaceholders adds the renewal date only when known", () => {
    expect(requiredPlaceholders("quote_request", { renewalKnown: true })).toContain("renewal_date");
    expect(requiredPlaceholders("quote_request", { renewalKnown: false })).not.toContain("renewal_date");
  });
});

describe("switchingChecklist", () => {
  const base = {
    newPolicy: { id: "new", carrier: "Acuity", effectiveFrom: "2027-03-01", contact: { id: "c-new", name: "Lakeview Brokers" } },
    oldPolicy: { id: "old", carrier: "West Bend", contact: { id: "c-old", name: "Acme Agency" }, sameAgency: false },
    otherQuotes: [] as { quoteId: string; contactId: string | null; contactName: string | null }[],
    hasPremiumBill: true,
    ownerSummaryPublished: true,
  };

  it("lists every step in order", () => {
    expect(switchingChecklist(base).map((i) => i.key)).toEqual(["tell_new", "tell_old", "bill", "owner_summary", "certificate"]);
    expect(switchingChecklist(base)[0].text).toBe("Tell Lakeview Brokers you'd like to go ahead. Walkup doesn't do this for you.");
    expect(switchingChecklist(base)[1].action?.href).toBe("/insurance/emails/new?kind=change_request&contact=c-old&policy=old&change=other");
  });

  it("same agency for old and new → no 'tell the old agent' item", () => {
    expect(switchingChecklist({ ...base, oldPolicy: { ...base.oldPolicy, sameAgency: true } }).map((i) => i.key)).not.toContain("tell_old");
  });

  it("two other quotes → two thank-you items", () => {
    const items = switchingChecklist({ ...base, otherQuotes: [{ quoteId: "q1", contactId: "a", contactName: "Alpha" }, { quoteId: "q2", contactId: null, contactName: null }] });
    const thanks = items.filter((i) => i.key.startsWith("thank_"));
    expect(thanks.map((i) => i.text)).toEqual(["Thank Alpha for their quote.", "Thank the agency for their quote."]);
    expect(thanks[0].action?.href).toBe("/insurance/emails/new?kind=quote_decline&quote=q1");
  });

  it("no bill → no bill item; no published summary → no summary item", () => {
    const keys = switchingChecklist({ ...base, hasPremiumBill: false, ownerSummaryPublished: false }).map((i) => i.key);
    expect(keys).not.toContain("bill");
    expect(keys).not.toContain("owner_summary");
  });
});
