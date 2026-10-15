import { describe, expect, it } from "vitest";
import { normaliseUrl, normaliseUrlExact, type Citation } from "@/lib/ai/verify";
import {
  DIRECTORY_HOSTS,
  hostCarriesName,
  findName,
  findNumber,
  formatPhone,
  LEAD_GEN_HOSTS,
  nameSegments,
  normaliseName,
  snippetOf,
  verifyWebContractor,
  webSearchTask,
  type WebContractor,
} from "@/lib/contractors/web-verify";

// repairs-spec §9.3 and §17.3: every verification rule for web-found contractors.

const ACME_SITE = "https://acmeplumbing.com/";
const ACME_ABOUT = "https://acmeplumbing.com/about";
const YELP = "https://www.yelp.com/search?find_desc=plumbers&find_loc=Chicago";
const ARTICLE = "https://chicagomag.com/best-plumbers";
const ANGI = "https://www.angi.com/companylist/us/il/chicago/plumbing.htm";

function ctxFor(urls: string[], citations: Citation[]) {
  return {
    searchUrls: new Set(urls.map(normaliseUrl)),
    searchUrlsExact: new Set(urls.map(normaliseUrlExact)),
    citations,
  };
}

function item(over: Partial<WebContractor> = {}): WebContractor {
  return {
    name: "Acme Plumbing",
    websiteUrl: null,
    cityOrArea: null,
    phone: null,
    email: null,
    rating: null,
    reviewCount: null,
    ratingSource: null,
    emergencyService: null,
    mentionsCondoWork: null,
    smallJobsWelcome: null,
    freeEstimates: null,
    snippet: null,
    sourceUrls: [ACME_ABOUT],
    ...over,
  };
}

const ownSite: Citation = {
  url: ACME_ABOUT,
  title: "About Acme Plumbing",
  citedText:
    "Acme Plumbing has served Chicago condo associations and HOAs since 1998. 24/7 emergency service. Free estimates. Call (312) 555-0142 or write to office@acmeplumbing.com. Based in Logan Square.",
};

const directory: Citation = {
  url: YELP,
  title: "Top 10 Plumbers in Chicago",
  citedText:
    "Emergency plumbers in Chicago. Acme Plumbing (312) 555-0101 4.8 (123 reviews) … Best Drains (312) 555-0199 4.2 (56 reviews)",
};

describe("names and numbers", () => {
  it("normalises legal suffixes and punctuation", () => {
    expect(normaliseName("The Acme Plumbing Co., Inc.")).toBe("acme plumbing");
  });

  it("finds a name across punctuation and suffixes, bounded by non-alphanumerics", () => {
    expect(findName("Call ACME Plumbing, Inc. today", "Acme Plumbing")).toBe(5);
    expect(findName("Acme Co. Plumbing is here", "Acme Plumbing")).toBe(0);
    expect(findName("Smith & Sons Heating", "Smith and Sons")).toBe(0);
    expect(findName("Acmeplumbing", "Acme Plumbing")).toBe(-1);
    expect(findName("Nothing here", "Acme Plumbing")).toBe(-1);
  });

  it("matches a rating with one decimal, never inside a longer number", () => {
    expect(findNumber("rated 4.8 stars", 4.8, "rating")).toEqual([6]);
    expect(findNumber("rated 4.80 stars", 4.8, "rating")).toEqual([6]);
    expect(findNumber("14.85 miles", 4.8, "rating")).toEqual([]);
    expect(findNumber("rated 4.85", 4.8, "rating")).toEqual([]);
  });

  it("matches a count with or without a thousands separator, never in a phone number", () => {
    expect(findNumber("1,234 reviews", 1234, "count")).toEqual([0]);
    expect(findNumber("1234 reviews", 1234, "count")).toEqual([0]);
    expect(findNumber("(312) 555-0123", 123, "count")).toEqual([]);
    expect(findNumber("12,345 reviews", 2345, "count")).toEqual([]);
    expect(findNumber("123 reviews", 123, "count")).toEqual([0]);
  });

  it("cuts a listing segment before the next listing's phone", () => {
    const segs = nameSegments(directory.citedText, "Acme Plumbing");
    expect(segs).toHaveLength(1);
    expect(segs[0].text).toContain("555-0101");
    expect(segs[0].text).not.toContain("555-0199");
    expect(segs[0].text).not.toContain("Best Drains");
  });

  it("formats a phone and trims a snippet at a word boundary", () => {
    expect(formatPhone("312.555.0142")).toBe("(312) 555-0142");
    expect(formatPhone("555-0142")).toBeNull();
    const long = "word ".repeat(60);
    const s = snippetOf(long);
    expect(s.length).toBeLessThanOrEqual(160);
    expect(s.endsWith("…")).toBe(true);
  });

  it("recognises a business's own host by a distinctive word of its name", () => {
    expect(hostCarriesName("www.acmeplumbing.com", "Acme Plumbing")).toBe(true);
    expect(hostCarriesName("chicagoplumbing.com", "Chicago Plumbing Services")).toBe(false);
    expect(hostCarriesName("chicagomag.com", "Acme Plumbing")).toBe(false);
  });

  it("keeps the host lists distinct", () => {
    expect(LEAD_GEN_HOSTS).toContain("angi.com");
    expect(DIRECTORY_HOSTS).toContain("yelp.com");
  });
});

describe("verifyWebContractor", () => {
  it("drops an item whose sources the search never returned", () => {
    const r = verifyWebContractor(item({ sourceUrls: ["https://made-up.example/acme"] }), ctxFor([ACME_ABOUT], [ownSite]));
    expect(r).toBeNull();
  });

  it("removes a lead-generation source and drops the item if nothing else backs it", () => {
    const angi: Citation = { url: ANGI, title: "Plumbers", citedText: "Acme Plumbing (312) 555-0142" };
    expect(verifyWebContractor(item({ sourceUrls: [ANGI] }), ctxFor([ANGI], [angi]))).toBeNull();
    const r = verifyWebContractor(item({ sourceUrls: [ANGI, ACME_ABOUT] }), ctxFor([ANGI, ACME_ABOUT], [angi, ownSite]));
    expect(r?.sourceUrls).toEqual([ACME_ABOUT]);
  });

  it("drops an item whose name isn't in any of its cited pages", () => {
    const other: Citation = { url: ACME_ABOUT, title: "About us", citedText: "We fix pipes." };
    expect(verifyWebContractor(item(), ctxFor([ACME_ABOUT], [other]))).toBeNull();
  });

  it("drops a name longer than 80 characters", () => {
    expect(verifyWebContractor(item({ name: "A".repeat(81) }), ctxFor([ACME_ABOUT], [ownSite]))).toBeNull();
  });

  it("never makes a directory or an article the business's website", () => {
    const article: Citation = { url: ARTICLE, title: "Best plumbers in Chicago", citedText: "Acme Plumbing fixed our boiler fast." };
    const ctx = ctxFor([YELP, ARTICLE, ACME_ABOUT], [directory, article, ownSite]);
    expect(verifyWebContractor(item({ websiteUrl: YELP, sourceUrls: [YELP] }), ctx)?.websiteUrl).toBeNull();
    expect(verifyWebContractor(item({ websiteUrl: ARTICLE, sourceUrls: [ARTICLE] }), ctx)?.websiteUrl).toBeNull();
    expect(verifyWebContractor(item({ websiteUrl: "https://chicagomag.com/", sourceUrls: [ARTICLE] }), ctx)?.websiteUrl).toBeNull();
  });

  it("keeps a website only when a citation from its host names the business", () => {
    const ctx = ctxFor([ACME_SITE, ACME_ABOUT], [ownSite]);
    expect(verifyWebContractor(item({ websiteUrl: ACME_SITE, sourceUrls: [ACME_ABOUT] }), ctx)?.websiteUrl).toBe("https://acmeplumbing.com/");
    const unnamed: Citation = { url: ACME_ABOUT, title: "Home", citedText: "We fix pipes. Acme Plumbing since 1998." };
    const elsewhere: Citation = { url: "https://otherco.com/", title: "Other", citedText: "Other Co plumbing" };
    const ctx2 = ctxFor(["https://otherco.com/", ACME_ABOUT], [elsewhere, unnamed]);
    expect(verifyWebContractor(item({ websiteUrl: "https://otherco.com/", sourceUrls: [ACME_ABOUT] }), ctx2)?.websiteUrl).toBeNull();
  });

  it("on a multi-business directory, takes only the details next to this business's name", () => {
    const ctx = ctxFor([YELP], [directory]);
    const best = verifyWebContractor(
      item({ name: "Best Drains", phone: "(312) 555-0199", rating: 4.2, reviewCount: 56, ratingSource: "Yelp", sourceUrls: [YELP] }),
      ctx,
    );
    expect(best?.phone).toBe("(312) 555-0199");
    expect([best?.rating, best?.reviewCount, best?.ratingSource]).toEqual([4.2, 56, "Yelp"]);

    const stolen = verifyWebContractor(
      item({ name: "Best Drains", phone: "(312) 555-0101", rating: 4.8, reviewCount: 123, ratingSource: "Yelp", sourceUrls: [YELP] }),
      ctx,
    );
    expect(stolen?.phone).toBeNull();
    expect([stolen?.rating, stolen?.reviewCount, stolen?.ratingSource]).toEqual([null, null, null]);

    const acmeTakesBest = verifyWebContractor(
      item({ phone: "(312) 555-0199", rating: 4.2, reviewCount: 56, ratingSource: "Yelp", sourceUrls: [YELP] }),
      ctx,
    );
    expect(acmeTakesBest?.phone).toBeNull();
    expect(acmeTakesBest?.rating).toBeNull();
  });

  it("drops a rating whose count sits more than 80 characters away", () => {
    const far: Citation = {
      url: YELP,
      title: "Plumbers",
      citedText: `Acme Plumbing 4.8 stars ${"x".repeat(90)} 123 reviews`,
    };
    const r = verifyWebContractor(item({ rating: 4.8, reviewCount: 123, ratingSource: "Yelp", sourceUrls: [YELP] }), ctxFor([YELP], [far]));
    expect(r?.rating).toBeNull();
  });

  it("needs a short rating source, a whole review count of at least one, and a 0..5 rating", () => {
    const ctx = ctxFor([YELP], [directory]);
    const base = { name: "Best Drains", rating: 4.2, reviewCount: 56, sourceUrls: [YELP] };
    expect(verifyWebContractor(item({ ...base, ratingSource: "" }), ctx)?.rating).toBeNull();
    expect(verifyWebContractor(item({ ...base, ratingSource: "x".repeat(31) }), ctx)?.rating).toBeNull();
    expect(verifyWebContractor(item({ ...base, ratingSource: "Yelp", reviewCount: 0 }), ctx)?.rating).toBeNull();
    expect(verifyWebContractor(item({ ...base, ratingSource: "Yelp", rating: 6 }), ctx)?.rating).toBeNull();
  });

  it("sets the what-they-offer flags only from the business's own site", () => {
    const fromDirectory = verifyWebContractor(
      item({ emergencyService: true, freeEstimates: true, sourceUrls: [YELP] }),
      ctxFor([YELP], [directory]),
    );
    expect(fromDirectory?.emergencyService).toBeNull();
    expect(fromDirectory?.freeEstimates).toBeNull();

    const own = verifyWebContractor(item({ websiteUrl: ACME_SITE }), ctxFor([ACME_SITE, ACME_ABOUT], [ownSite]));
    expect(own?.emergencyService).toBe(true);
    expect(own?.mentionsCondoWork).toBe(true);
    expect(own?.freeEstimates).toBe(true);
    expect(own?.smallJobsWelcome).toBeNull();
  });

  it("keeps contact details from the business's own site, formatted", () => {
    const r = verifyWebContractor(
      item({ websiteUrl: ACME_SITE, phone: "312-555-0142", email: "office@acmeplumbing.com", cityOrArea: "Logan Square" }),
      ctxFor([ACME_SITE, ACME_ABOUT], [ownSite]),
    );
    expect(r?.phone).toBe("(312) 555-0142");
    expect(r?.email).toBe("office@acmeplumbing.com");
    expect(r?.cityOrArea).toBe("Logan Square");
  });

  it("drops an uncited phone, email and city, and an email on a directory domain", () => {
    const r = verifyWebContractor(
      item({ websiteUrl: ACME_SITE, phone: "312-555-0999", email: "acme@yelp.com", cityOrArea: "Evanston" }),
      ctxFor([ACME_SITE, ACME_ABOUT], [ownSite]),
    );
    expect(r?.phone).toBeNull();
    expect(r?.email).toBeNull();
    expect(r?.cityOrArea).toBeNull();
  });

  it("uses a cited quote as the snippet, never the model's text", () => {
    const r = verifyWebContractor(item({ websiteUrl: ACME_SITE, snippet: "The best plumber in town!" }), ctxFor([ACME_SITE, ACME_ABOUT], [ownSite]));
    expect(r?.snippet).not.toContain("best plumber in town");
    expect(r?.snippet?.startsWith("Acme Plumbing has served")).toBe(true);
    expect((r?.snippet ?? "").length).toBeLessThanOrEqual(160);
  });
});

describe("webSearchTask", () => {
  it("names the trade, phrase and area, and lists only the ticked wants", () => {
    const t = webSearchTask({ tradeLabel: "Plumbing", phrase: "sewer rodding", wants: ["emergency", "free_estimates"], city: "Chicago", state: "IL", postalCode: "60647" });
    expect(t).toContain("do plumbing work (specifically: sewer rodding) for residential buildings in or near Chicago, IL 60647.");
    expect(t).toContain("Prefer businesses whose own website says they offer emergency or after-hours service and give free estimates.");
    const none = webSearchTask({ tradeLabel: "Roofing", phrase: "", wants: [], city: "Chicago", state: "IL", postalCode: null });
    expect(none).not.toContain("Prefer");
    expect(none).toContain("do roofing work for residential buildings in or near Chicago, IL.");
    expect(t).not.toMatch(/[—]/);
  });
});
