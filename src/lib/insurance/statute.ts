// The statute text the coverage check cites (insurance-spec §2.2, §6.7).
//
// Every quote is verbatim from the Act as published on ilga.gov, 15 words or
// fewer, and was re-checked against the fetched text on STATUTE_VERIFIED_ON
// (brief decision 2: no statute text from memory). The section-level ilga.gov
// URLs refuse non-browser clients, so links go to the whole Act and the UI
// names the section ("Read the Act on ilga.gov (scroll to Sec. 12)").
// Statute rules run only for associations with state_code "IL". Pure.

export const STATUTE_VERIFIED_ON = "2026-10-14";
/** Amendments to Sections 18, 18.4, 18.12 and 22.1 take effect 2027-01-01 (P.A. 104-734, 104-797, 104-598, 104-580). Re-read the cited provisions then. */
export const NEXT_REVERIFY = "2027-01-02";
export const CONDO_ACT_URL = "https://www.ilga.gov/Legislation/ILCS/Articles?ActID=2200&ChapterID=62";
export const CICAA_URL = "https://www.ilga.gov/Legislation/ILCS/Articles?ActID=3273&ChapterID=62";

const CONDO_ACT = "Illinois Condominium Property Act";
const CICAA = "Common Interest Community Association Act";

export const CITATION_KEYS = [
  "ICPA_12_A", "ICPA_12_A1_PROPERTY", "ICPA_12_A1_SPECIAL", "ICPA_12_A1_RC", "ICPA_12_A1_BC",
  "ICPA_12_A2_GL", "ICPA_12_A2_OWNERS", "ICPA_12_A3A_FIDELITY", "ICPA_12_A3B_MANAGER", "ICPA_12_A3C_AMOUNT",
  "ICPA_12_A3D_DO", "ICPA_12_A3D_SCOPE", "ICPA_12_A3D_INSUREDS", "ICPA_12_B_FIXTURES", "ICPA_12_B_IMPROVEMENTS",
  "ICPA_12_C_DEDUCTIBLE", "ICPA_12_D_OTHER", "ICPA_12_E_SUBROGATION", "ICPA_12_H_OWNERS", "ICPA_12_I_COI",
  "ICPA_18_4_F", "ICPA_22_1_A7", "CICAA_1_5_SCOPE", "CICAA_1_55_FIDELITY",
] as const;
export type CitationKey = (typeof CITATION_KEYS)[number];

export interface Citation {
  key: CitationKey;
  law: "765 ILCS 605" | "765 ILCS 160";
  actName: string;
  section: string;
  url: string;
  quote: string;
  verifiedOn: string;
}

const condo = (key: CitationKey, section: string, quote: string): Citation => ({
  key, law: "765 ILCS 605", actName: CONDO_ACT, section, url: CONDO_ACT_URL, quote, verifiedOn: STATUTE_VERIFIED_ON,
});
const cicaa = (key: CitationKey, section: string, quote: string): Citation => ({
  key, law: "765 ILCS 160", actName: CICAA, section, url: CICAA_URL, quote, verifiedOn: STATUTE_VERIFIED_ON,
});

export const CITATIONS: Record<CitationKey, Citation> = {
  ICPA_12_A: condo("ICPA_12_A", "Sec. 12(a)", "No policy of insurance shall be issued or delivered to a condominium association"),
  // Added at build (§2.2 item 8): 12(a)(1)(i) verified on ilga.gov on 2026-10-14.
  ICPA_12_A1_PROPERTY: condo("ICPA_12_A1_PROPERTY", "Sec. 12(a)(1)(i)", "on the common elements and the units, including the limited common elements"),
  ICPA_12_A1_SPECIAL: condo("ICPA_12_A1_SPECIAL", "Sec. 12(a)(1)(ii)", "providing coverage for special form causes of loss"),
  ICPA_12_A1_RC: condo("ICPA_12_A1_RC", "Sec. 12(a)(1)(iii)", "not less than the full insurable replacement cost of the insured property, less deductibles"),
  ICPA_12_A1_BC: condo("ICPA_12_A1_BC", "Sec. 12(a)(1)", "The combined total of Coverage B and Coverage C shall be no less than 10%"),
  ICPA_12_A2_GL: condo("ICPA_12_A2_GL", "Sec. 12(a)(2)", "in a minimum amount of $1,000,000, or a greater amount deemed sufficient"),
  ICPA_12_A2_OWNERS: condo("ICPA_12_A2_OWNERS", "Sec. 12(a)(2)", "The unit owners must be included as additional insured parties"),
  ICPA_12_A3A_FIDELITY: condo("ICPA_12_A3A_FIDELITY", "Sec. 12(a)(3)(A)", "An association with 6 or more dwelling units must obtain and maintain a fidelity bond"),
  ICPA_12_A3B_MANAGER: condo("ICPA_12_A3B_MANAGER", "Sec. 12(a)(3)(B)", "All management companies that are responsible for the funds held or administered by the association"),
  ICPA_12_A3C_AMOUNT: condo("ICPA_12_A3C_AMOUNT", "Sec. 12(a)(3)(C)", "the fidelity bond must be in the full amount of association funds and reserves"),
  ICPA_12_A3D_DO: condo("ICPA_12_A3D_DO", "Sec. 12(a)(3)(D)", "The board of directors must obtain directors and officers liability coverage"),
  ICPA_12_A3D_SCOPE: condo("ICPA_12_A3D_SCOPE", "Sec. 12(a)(3)(D)", "defense of non-monetary actions; defense of breach of contract; and defense of decisions"),
  ICPA_12_A3D_INSUREDS: condo("ICPA_12_A3D_INSUREDS", "Sec. 12(a)(3)(D)", "past, present, and future board members while acting in their capacity"),
  ICPA_12_B_FIXTURES: condo("ICPA_12_B_FIXTURES", "Sec. 12(b)", "Common elements include fixtures located within the unfinished interior surfaces of the perimeter walls"),
  ICPA_12_B_IMPROVEMENTS: condo("ICPA_12_B_IMPROVEMENTS", "Sec. 12(b)", "The insurance need not cover improvements and betterments to the units installed by unit owners"),
  ICPA_12_C_DEDUCTIBLE: condo("ICPA_12_C_DEDUCTIBLE", "Sec. 12(c)", "require the unit owners of the units affected to pay the deductible amount"),
  ICPA_12_D_OTHER: condo("ICPA_12_D_OTHER", "Sec. 12(d)", "including workers compensation, employment practices, environmental hazards, and equipment breakdown"),
  ICPA_12_E_SUBROGATION: condo("ICPA_12_E_SUBROGATION", "Sec. 12(e)(2)", "The insurer waives its right to subrogation under the policy against any unit owner"),
  ICPA_12_H_OWNERS: condo("ICPA_12_H_OWNERS", "Sec. 12(h)", "require condominium unit owners to obtain insurance covering their personal liability"),
  ICPA_12_I_COI: condo("ICPA_12_I_COI", "Sec. 12(i)", "under contracts exceeding $10,000 per year must provide certificates of insurance"),
  ICPA_18_4_F: condo("ICPA_18_4_F", "Sec. 18.4(f)", "To obtain adequate and appropriate kinds of insurance."),
  ICPA_22_1_A7: condo("ICPA_22_1_A7", "Sec. 22.1(a)(7)", "A statement setting forth what insurance coverage is provided for all unit owners"),
  CICAA_1_5_SCOPE: cicaa("CICAA_1_5_SCOPE", "Sec. 1-5", "real estate other than a condominium or cooperative"),
  CICAA_1_55_FIDELITY: cicaa("CICAA_1_55_FIDELITY", "Sec. 1-55", "An association with 30 or more units shall obtain and maintain fidelity insurance"),
};

/** "12" from "Sec. 12(a)(3)(A)", "1-55" from "Sec. 1-55": the number to scroll to on the Act page. */
export function sectionNumber(c: Citation): string {
  return /^Sec\.\s*([\d.-]+?)(?:\(|$)/.exec(c.section)?.[1] ?? c.section.replace(/^Sec\.\s*/, "");
}

/** "Read the Act on ilga.gov (scroll to Sec. 12)". */
export function actLinkText(c: Citation): string {
  return `Read the Act on ilga.gov (scroll to Sec. ${sectionNumber(c)})`;
}

/**
 * Public lookups linked from the Marketplace (§2.2a): links, not claims.
 * IL_DOI_AGENT_LOOKUP: the spec's /consumers/ URL now redirects here (checked
 * 2026-10-14); this is the page it lands on. `state: "IL"` shows the link only
 * for Illinois associations.
 */
export const LOOKUPS = {
  IL_DOI_AGENT_LOOKUP: { url: "https://idoi.illinois.gov/companies/agent-lookup.html", label: "Check this agency's license with the Illinois Department of Insurance", verifiedOn: "2026-10-14", state: "IL" },
  NAIC_CIS: { url: "https://content.naic.org/cis_consumer_information.htm", label: "See complaint records on the NAIC Consumer Insurance Search", verifiedOn: "2026-10-14", state: null },
} as const;
