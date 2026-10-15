import { describe, expect, it } from "vitest";
import { CITATIONS, CITATION_KEYS, LOOKUPS, STATUTE_VERIFIED_ON, actLinkText } from "@/lib/insurance/statute";

describe("statute citations", () => {
  const all = Object.values(CITATIONS);

  it("holds the 23 rows of §2.2 plus ICPA_12_A1_PROPERTY, verified at build", () => {
    expect(all).toHaveLength(24);
    expect(Object.keys(CITATIONS).sort()).toEqual([...CITATION_KEYS].sort());
    expect(CITATIONS.ICPA_12_A1_PROPERTY.section).toBe("Sec. 12(a)(1)(i)");
  });

  it("every quote is 15 words or fewer, with no em dash", () => {
    for (const c of all) {
      expect(c.quote.trim().split(/\s+/).length, c.key).toBeLessThanOrEqual(15);
      expect(c.quote, c.key).not.toContain("—");
    }
  });

  it("every URL is on ilga.gov and every row carries its verification date", () => {
    for (const c of all) {
      expect(c.url.startsWith("https://www.ilga.gov/"), c.key).toBe(true);
      expect(c.verifiedOn, c.key).toBe("2026-10-14");
      expect(c.key).toBe(Object.entries(CITATIONS).find(([, v]) => v === c)![0]);
    }
    expect(STATUTE_VERIFIED_ON).toBe("2026-10-14");
  });

  it("names the right act", () => {
    expect(CITATIONS.CICAA_1_55_FIDELITY.actName).toBe("Common Interest Community Association Act");
    expect(CITATIONS.CICAA_1_55_FIDELITY.law).toBe("765 ILCS 160");
    expect(CITATIONS.ICPA_12_A2_GL.actName).toBe("Illinois Condominium Property Act");
  });

  it("links say which section to scroll to", () => {
    expect(actLinkText(CITATIONS.ICPA_12_A3A_FIDELITY)).toBe("Read the Act on ilga.gov (scroll to Sec. 12)");
    expect(actLinkText(CITATIONS.ICPA_18_4_F)).toBe("Read the Act on ilga.gov (scroll to Sec. 18.4)");
    expect(actLinkText(CITATIONS.CICAA_1_55_FIDELITY)).toBe("Read the Act on ilga.gov (scroll to Sec. 1-55)");
  });
});

describe("LOOKUPS", () => {
  it("two https links with a verification date", () => {
    const list = Object.values(LOOKUPS);
    expect(list).toHaveLength(2);
    for (const l of list) {
      expect(l.url.startsWith("https://")).toBe(true);
      expect(l.verifiedOn).toBe("2026-10-14");
    }
    expect(LOOKUPS.IL_DOI_AGENT_LOOKUP.state).toBe("IL");
    expect(LOOKUPS.NAIC_CIS.state).toBeNull();
  });
});
