import { describe, expect, it } from "vitest";
import { normaliseUrl, type Citation } from "@/lib/ai/verify";
import {
  finalizeMarketItems,
  itemKey,
  marketInputs,
  marketUserLocation,
  nameKey,
  queryKey,
  verifyAgency,
  verifyInsurer,
  type AgencyItem,
  type InsurerItem,
} from "@/lib/insurance/market-verify";

const SEARCH = [
  "https://www.acmeinsurance.com/condo-associations",
  "https://acmeinsurance.com/contact",
  "https://www.yelp.com/search?find_desc=insurance+agency+chicago",
  "https://chicagoinsurancedirectory.example/top-agencies",
  "https://www.ambest.example/ratings",
  "https://www.westbend.example/community-associations",
];
const searchUrls = new Set(SEARCH.map(normaliseUrl));

const c = (url: string, citedText: string, title: string | null = null): Citation => ({ url, citedText, title });

const CITES: Citation[] = [
  c("https://www.acmeinsurance.com/condo-associations", "Acme Insurance Agency is an independent insurance agency serving condominium associations in Chicago, IL. We place commercial property, general liability and directors & officers coverage.", "Condo associations | Acme Insurance"),
  c("https://acmeinsurance.com/contact", "Call us at (312) 555-0100 or write to info@acmeinsurance.com. Jane Doe: jane.doe@acmeinsurance.com", "Contact Acme"),
  c("https://chicagoinsurancedirectory.example/top-agencies", "Top agencies: Brightline Agency 312-555-0199. Lakeview Brokers 773-555-0111.", "Top agencies in Chicago"),
];

const agency = (over: Partial<AgencyItem> = {}): AgencyItem => ({
  name: "Acme Insurance Agency, Inc.",
  website: "https://www.acmeinsurance.com/",
  city: "Chicago",
  state: "IL",
  phone: "312.555.0100",
  email: "info@acmeinsurance.com",
  lines: ["property", "general_liability", "directors_officers"],
  worksWithAssociations: true,
  independent: true,
  about: "Acme Insurance Agency is an independent insurance agency serving condominium associations in Chicago, IL.",
  sourceUrls: ["https://www.acmeinsurance.com/condo-associations", "https://acmeinsurance.com/contact"],
  ...over,
});

const ctx = { searchUrls, citations: CITES };

describe("verifyAgency", () => {
  it("keeps a well-cited agency with every supported detail", () => {
    const v = verifyAgency(agency(), ctx)!;
    expect(v).toMatchObject({
      phone: "(312) 555-0100", email: "info@acmeinsurance.com", city: "Chicago", state: "IL",
      worksWithAssociations: true, independent: true, key: "host:acmeinsurance.com",
      verified: { phone: true, email: true, rating: false, about: "quote" },
    });
    expect(v.lines).toEqual(["property", "general_liability", "directors_officers"]);
    expect(v.aboutSource).toBe("https://www.acmeinsurance.com/condo-associations");
  });

  it("an item with no URL in the search results is dropped (fabricated agency)", () => {
    expect(verifyAgency(agency({ website: "https://made-up.example/", sourceUrls: ["https://made-up.example/about"] }), ctx)).toBeNull();
  });

  it("a fabricated name with a real but unrelated source URL is dropped", () => {
    expect(verifyAgency(agency({ name: "Phantom Risk Partners", website: null, sourceUrls: ["https://chicagoinsurancedirectory.example/top-agencies"] }), ctx)).toBeNull();
  });

  it("a website not in the results is dropped while a cited source keeps the item", () => {
    const v = verifyAgency(agency({ website: "https://acme-insurance-elsewhere.example/" }), ctx)!;
    expect(v.website).toBeNull();
    expect(v.key.startsWith("name:")).toBe(true);
  });

  it("phones: uncited dropped; formatted differently but cited kept", () => {
    expect(verifyAgency(agency({ phone: "312-555-9999" }), ctx)!.phone).toBeNull();
    expect(verifyAgency(agency({ phone: "+1 (312) 555 0100" }), ctx)!.phone).toBe("(312) 555-0100");
  });

  it("a phone only on a directory citation that doesn't name the agency, off its host, is dropped; on its own host kept", () => {
    const withDirectory = agency({ phone: "312-555-0199", sourceUrls: [...agency().sourceUrls, "https://chicagoinsurancedirectory.example/top-agencies"] });
    expect(verifyAgency(withDirectory, ctx)!.phone).toBeNull();
    const ownHost = { searchUrls, citations: [...CITES, c("https://acmeinsurance.com/contact", "Office line 312-555-0199", null)] };
    expect(verifyAgency(withDirectory, ownHost)!.phone).toBe("(312) 555-0199");
  });

  it("a personal-looking email is dropped even when cited; a role address is kept", () => {
    expect(verifyAgency(agency({ email: "jane.doe@acmeinsurance.com" }), ctx)!.email).toBeNull();
    expect(verifyAgency(agency({ email: "info@acmeinsurance.com" }), ctx)!.email).toBe("info@acmeinsurance.com");
  });

  it("worksWithAssociations needs association wording, not HO-6 'condo insurance'", () => {
    const ho6 = { searchUrls, citations: [c("https://www.acmeinsurance.com/condo-associations", "Acme Insurance Agency sells condo insurance and auto insurance.", null)] };
    expect(verifyAgency(agency({ sourceUrls: ["https://www.acmeinsurance.com/condo-associations"] }), ho6)!.worksWithAssociations).toBe(false);
    expect(verifyAgency(agency(), ctx)!.worksWithAssociations).toBe(true);
  });

  it("independent without the wording is null, never false", () => {
    const plain = { searchUrls, citations: [c("https://www.acmeinsurance.com/condo-associations", "Acme Insurance Agency serves condominium associations.", null)] };
    expect(verifyAgency(agency({ sourceUrls: ["https://www.acmeinsurance.com/condo-associations"] }), plain)!.independent).toBeNull();
  });

  it("a city not in any attributable citation is dropped", () => {
    expect(verifyAgency(agency({ city: "Evanston" }), ctx)!.city).toBeNull();
  });

  it("lines need their own phrases", () => {
    const cites = { searchUrls, citations: [c("https://www.acmeinsurance.com/condo-associations", "Acme Insurance Agency: property management support and crime prevention tips.", null)] };
    const v = verifyAgency(agency({ sourceUrls: ["https://www.acmeinsurance.com/condo-associations"], lines: ["property", "fidelity_crime"] }), cites)!;
    expect(v.lines).toEqual([]);
    const ok = { searchUrls, citations: [c("https://www.acmeinsurance.com/condo-associations", "Acme Insurance Agency writes commercial property and crime coverage.", null)] };
    expect(verifyAgency(agency({ sourceUrls: ["https://www.acmeinsurance.com/condo-associations"], lines: ["property", "fidelity_crime"] }), ok)!.lines).toEqual(["property", "fidelity_crime"]);
  });

  it("an about that isn't in any cite becomes an excerpt of the first naming citation; with $ → excerpt or null", () => {
    const v = verifyAgency(agency({ about: "The best condo agency in Illinois, trusted by thousands." }), ctx)!;
    expect(v.verified.about).toBe("excerpt");
    expect(v.about).not.toContain("best condo agency");
    expect(CITES[0].citedText.startsWith(v.about!.replace(/…$/, ""))).toBe(true);
    const priced = { searchUrls, citations: [c("https://www.acmeinsurance.com/condo-associations", "Acme Insurance Agency quotes start at $500 for condominium associations.", null)] };
    const p = verifyAgency(agency({ about: "Quotes start at $500.", sourceUrls: ["https://www.acmeinsurance.com/condo-associations"] }), priced)!;
    expect(p.about).toBeNull();
    expect(p.verified.about).toBeNull();
  });
});

describe("verifyInsurer", () => {
  const WB_CITES: Citation[] = [
    c("https://www.westbend.example/community-associations", "West Bend Mutual Insurance writes condominium associations in Illinois, including directors and officers and umbrella.", "West Bend"),
    c("https://www.ambest.example/ratings", "A.M. Best affirmed West Bend Mutual Insurance Company at A (Excellent).", "Ratings"),
    c("https://www.ambest.example/ratings", "A.M. Best: Acuity, A Mutual Insurance Company, holds A+ (Superior).", "Ratings"),
  ];
  const insurer = (over: Partial<InsurerItem> = {}): InsurerItem => ({
    name: "West Bend Mutual Insurance",
    website: "https://www.westbend.example/",
    writesAssociations: true,
    writesInState: true,
    lines: ["directors_officers", "umbrella", "cyber"],
    amBestRating: "A",
    amBestSourceUrl: "https://www.ambest.example/ratings",
    about: null,
    sourceUrls: ["https://www.westbend.example/community-associations"],
    ...over,
  });
  const where = { state: "IL", stateName: "Illinois" };
  const wctx = { searchUrls, citations: WB_CITES };

  it("keeps a rating only from a citation that names this insurer and holds the token", () => {
    const v = verifyInsurer(insurer(), wctx, where)!;
    expect(v).toMatchObject({ amBestRating: "A", writesAssociations: true, writesInState: true, verified: { rating: true } });
    expect(v.lines).toEqual(["directors_officers", "umbrella"]);
  });

  it("'A+' for this insurer when the page gives A+ only to another insurer → null", () => {
    const v = verifyInsurer(insurer({ amBestRating: "A+" }), wctx, where)!;
    expect(v.amBestRating).toBeNull();
    expect(v.amBestSourceUrl).toBeNull();
  });

  it("'A' doesn't match inside 'A+'", () => {
    const only = { searchUrls, citations: [WB_CITES[0], c("https://www.ambest.example/ratings", "A.M. Best rates West Bend Mutual Insurance A+ (Superior).", null)] };
    expect(verifyInsurer(insurer({ amBestRating: "A" }), only, where)!.amBestRating).toBeNull();
    expect(verifyInsurer(insurer({ amBestRating: "A+" }), only, where)!.amBestRating).toBe("A+");
  });

  it("an invalid rating string → null", () => {
    expect(verifyInsurer(insurer({ amBestRating: "Excellent" }), wctx, where)!.amBestRating).toBeNull();
  });

  it("writesInState is null without the state name", () => {
    const v = verifyInsurer(insurer(), { searchUrls, citations: [c("https://www.westbend.example/community-associations", "West Bend Mutual Insurance writes condominium associations.", null)] }, where)!;
    expect(v.writesInState).toBeNull();
  });
});

describe("keys, dedupe and inputs", () => {
  it("itemKey: host when the website survived, a stable name hash otherwise", () => {
    expect(itemKey({ name: "Acme", website: "https://www.acme.com/x" })).toBe("host:acme.com");
    const a = itemKey({ name: "Acme Insurance Agency, Inc.", website: null });
    expect(a).toMatch(/^name:[0-9a-f]{16}$/);
    expect(itemKey({ name: "ACME insurance agency", website: null })).toBe(a);
    expect(nameKey("Smith & Sons Insurance Agency, LLC")).toBe("smith and sons");
  });

  it("dedupes by key, drops out-of-state agencies, keeps at most 8, sorted by name", () => {
    const mk = (name: string, key: string, state: string | null = "IL") => ({ name, key, state });
    const items = [
      mk("Zeta", "k1"), mk("Alpha", "k2"), mk("Zeta again", "k1"), mk("Out of state", "k3", "WI"),
      ...Array.from({ length: 8 }, (_, i) => mk(`Agency ${i}`, `x${i}`)),
    ];
    const out = finalizeMarketItems(items, "IL");
    expect(out).toHaveLength(8);
    expect(out.map((i) => i.key)).not.toContain("k3");
    expect(out.filter((i) => i.key === "k1")).toHaveLength(1);
    expect(out.map((i) => i.name)).toEqual([...out.map((i) => i.name)].sort((a, b) => a.localeCompare(b)));
  });

  it("marketInputs holds exactly the decision 4 keys", () => {
    const i = marketInputs(
      { city: "Chicago", state_code: "il", postal_code: "60647-1234", stories: 3, year_built: 1905, construction_type: "joisted_masonry",
        ...({ name: "2158 N. Damen Condominium Association", address: "2158 N Damen Ave", annual_premium: "3766.00" } as object) },
      3,
      ["property", "directors_officers"],
    )!;
    expect(Object.keys(i).sort()).toEqual(["city", "construction", "coverages", "postal_code", "state", "stateName", "stories", "units", "year_built"]);
    expect(i).toMatchObject({ state: "IL", stateName: "Illinois", postal_code: "60647", construction: "brick or block walls, wood floors" });
    expect(i.coverages).toEqual(["Master policy (building and property)", "Directors and officers (D&O)"]);
    expect(JSON.stringify(i)).not.toMatch(/Damen Ave|Association|3766/);
    expect(marketInputs({ city: null, state_code: "IL" }, 3, [])).toBeNull();
  });

  it("queryKey is stable across key order; the user location has no postal code", () => {
    const i = marketInputs({ city: "Chicago", state_code: "IL", postal_code: "60647" }, 3, ["property"])!;
    const shuffled = Object.fromEntries(Object.entries(i).reverse()) as typeof i;
    expect(queryKey("agencies", shuffled)).toBe(queryKey("agencies", i));
    expect(queryKey("agencies", i)).toMatch(/^agencies:[0-9a-f]{64}$/);
    expect(queryKey("insurers", i)).not.toBe(queryKey("agencies", i));
    const loc = marketUserLocation(i);
    expect(loc).toEqual({ city: "Chicago", region: "Illinois", country: "US" });
    expect("postal_code" in loc).toBe(false);
  });
});
