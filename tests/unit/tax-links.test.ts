import { describe, expect, it } from "vitest";
import { isOfficialLinkUrl, LINK_KIND_LABEL, linksFor, linkStatusWords, type LinkRow } from "@/lib/tax/links";

const today = "2026-10-11";

function row(over: Partial<LinkRow> & { id: string }): LinkRow {
  return {
    form_code: "irs_1120h",
    kind: "about",
    label: "About Form 1120-H",
    url: "https://www.irs.gov/forms-pubs/about-form-1120-h",
    state_code: null,
    retrieved_on: "2026-10-11",
    verified_at: null,
    last_checked_at: null,
    last_check_status: null,
    active: true,
    sort_order: 10,
    ...over,
  };
}

const rows: LinkRow[] = [
  row({ id: "h-form", kind: "form", label: "Form 1120-H (PDF, current revision)", url: "https://www.irs.gov/pub/irs-pdf/f1120h.pdf", sort_order: 20 }),
  row({ id: "h-about" }),
  row({ id: "h-instr", kind: "instructions", label: "Instructions for Form 1120-H", url: "https://www.irs.gov/instructions/i1120h", sort_order: 30 }),
  row({ id: "h-old", kind: "guidance", label: "Retired page", url: "https://www.irs.gov/old", sort_order: 60, active: false }),
  row({ id: "il-file", form_code: "il_sos_annual_report", kind: "file_online", label: "File the annual report online (ILSOS)", url: "https://apps.ilsos.gov/nfpannualreports/", state_code: "IL", sort_order: 40 }),
  row({ id: "il-law", form_code: "il_sos_annual_report", kind: "law", label: "General Not For Profit Corporation Act", url: "https://www.ilga.gov/Legislation/ILCS/Articles?ActID=2280&ChapterID=65", state_code: "IL", sort_order: 70 }),
  row({ id: "w9", form_code: "irs_w9", kind: "form", label: "Form W-9 (PDF)", url: "https://www.irs.gov/pub/irs-pdf/fw9.pdf", sort_order: 20 }),
];

describe("linksFor", () => {
  it("returns one form's active links in registry order", () => {
    const views = linksFor(rows, "irs_1120h", "IL", today);
    expect(views.map((v) => v.id)).toEqual(["h-about", "h-form", "h-instr"]);
    expect(views[0]).toMatchObject({ kind: "about", label: "About Form 1120-H", checked: "unverified", checkedOn: null, retrievedOn: "2026-10-11" });
    expect(linksFor(rows, "irs_w9", "NH", today).map((v) => v.id)).toEqual(["w9"]);
  });

  it("scopes state links to the building's state and shows federal links everywhere", () => {
    expect(linksFor(rows, "il_sos_annual_report", "IL", today).map((v) => v.id)).toEqual(["il-file", "il-law"]);
    expect(linksFor(rows, "il_sos_annual_report", "NH", today)).toEqual([]);
    expect(linksFor(rows, "irs_1120h", "NH", today)).toHaveLength(3);
  });

  it("tells verified from stale, blocked and unverified", () => {
    const checked = (over: Partial<LinkRow>) => linksFor([row({ id: "x", ...over })], "irs_1120h", "IL", today)[0];
    expect(checked({ verified_at: "2026-10-01T15:00:00+00:00" })).toMatchObject({ checked: "verified", checkedOn: "2026-10-01" });
    expect(checked({ verified_at: "2025-10-11T15:00:00+00:00" }).checked).toBe("verified");
    expect(checked({ verified_at: "2025-10-10T15:00:00+00:00" })).toMatchObject({ checked: "stale", checkedOn: "2025-10-10" });
    expect(checked({ verified_at: "2026-10-01T15:00:00+00:00", last_check_status: "blocked" })).toMatchObject({ checked: "blocked", checkedOn: "2026-10-01" });
    expect(checked({ last_check_status: "blocked" })).toMatchObject({ checked: "blocked", checkedOn: null });
    expect(checked({ last_check_status: "200" }).checked).toBe("unverified");
    // A person's check that is over a year old is stale even where the robot is blocked.
    expect(checked({ verified_at: "2024-01-01T00:00:00+00:00", last_check_status: "blocked" }).checked).toBe("stale");
  });
});

describe("linkStatusWords", () => {
  const words = (over: Partial<LinkRow>) => linkStatusWords(linksFor([row({ id: "x", ...over })], "irs_1120h", "IL", today)[0]);

  it("says who checked a link and when, in plain words", () => {
    expect(words({ verified_at: "2026-10-01T15:00:00+00:00" })).toBe("checked Oct 1, 2026");
    expect(words({})).toBe("retrieved Oct 11, 2026 · not yet checked by a person");
    expect(words({ verified_at: "2025-06-30T15:00:00+00:00" })).toBe("last checked over a year ago");
    expect(words({ verified_at: "2026-10-11T15:00:00+00:00", last_check_status: "blocked" })).toBe(
      "couldn't be checked automatically — opened by a person on Oct 11, 2026",
    );
    expect(words({ last_check_status: "blocked" })).toBe("couldn't be checked automatically — not yet checked by a person");
  });

  it("never says a tax rule was verified by Walkup", () => {
    for (const w of [words({}), words({ verified_at: "2026-10-01T00:00:00Z" }), words({ last_check_status: "blocked" })]) {
      expect(w.toLowerCase()).not.toContain("verified by walkup");
    }
    expect(Object.values(LINK_KIND_LABEL)).toContain("Official form");
  });
});

describe("isOfficialLinkUrl", () => {
  it("accepts https links on the official hosts and their subdomains", () => {
    for (const url of [
      "https://apps.ilsos.gov/nfpannualreports/",
      "https://la.www4.irs.gov/esrv/ivs/",
      "https://www.ilga.gov/Legislation/ILCS/Articles?ActID=2280&ChapterID=65",
      "https://idfpr.illinois.gov/profs/",
      "https://tax.illinois.gov/forms/incometax/currentyear/business-corporate.html",
      "https://www.irs.gov/pub/irs-pdf/f1120h.pdf",
      "https://irs.gov/",
    ]) {
      expect(isOfficialLinkUrl(url), url).toBe(true);
    }
  });

  it("rejects http, look-alike hosts and anything the DB CHECK would refuse", () => {
    for (const url of [
      "http://www.irs.gov/forms-pubs/about-form-1120-h",
      "https://irs.gov.example.com/",
      "https://www.irs.gov.example.com/pub/f1120h.pdf",
      "https://example.com/irs.gov/",
      "https://www.irs.gov",
      "https://WWW.IRS.GOV/pub/",
      "mailto:someone@irs.gov",
      "",
    ]) {
      expect(isOfficialLinkUrl(url), url).toBe(false);
    }
  });
});
