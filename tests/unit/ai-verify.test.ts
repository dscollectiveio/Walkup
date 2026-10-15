import { describe, expect, it } from "vitest";
import type { BetaContentBlock } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import {
  appearsInCitations,
  citationsFor,
  collectEvidence,
  hostInSearch,
  isAggregatorHost,
  lintMarketingCopy,
  nameAppears,
  normaliseBusinessName,
  normaliseUrl,
  normaliseUrlExact,
  scrubWebTask,
  verifyClaims,
  verifyItems,
  verifyRating,
  verifyWebsite,
  type Citation,
  type Evidence,
} from "@/lib/ai/verify";

const cite = (url: string, citedText: string, title: string | null = null): Citation => ({ url, title, citedText });

describe("normaliseUrl", () => {
  it("drops scheme, case, www, query, hash and trailing slash", () => {
    expect(normaliseUrl("https://WWW.Acme.com/About/?x=1#y")).toBe("acme.com/about");
    expect(normaliseUrl("http://acme.com/")).toBe("acme.com");
    expect(normaliseUrl("https://acme.com")).toBe("acme.com");
  });
  it("lowercases invalid input", () => {
    expect(normaliseUrl("  Not A URL ")).toBe("not a url");
  });
  it("normaliseUrlExact keeps a sorted query", () => {
    expect(normaliseUrlExact("https://www.yelp.com/biz/acme?osq=x&a=2")).toBe("yelp.com/biz/acme?a=2&osq=x");
    expect(normaliseUrlExact("https://acme.com/a")).toBe("acme.com/a");
  });
});

describe("isAggregatorHost / hostInSearch", () => {
  it("knows directory and social hosts, subdomains included", () => {
    expect(isAggregatorHost("m.facebook.com")).toBe(true);
    expect(isAggregatorHost("www.yelp.com")).toBe(true);
    expect(isAggregatorHost("acmeplumbing.com")).toBe(false);
  });
  it("matches a homepage to a deeper search URL on the same host only", () => {
    const search = new Set(["acme.com/services", "yelp.com/biz/acme"]);
    expect(hostInSearch("https://www.acme.com/", search)).toBe(true);
    expect(hostInSearch("https://shop.acme.com/", search)).toBe(false);
    expect(hostInSearch("https://yelp.com/", search)).toBe(false);
  });
});

describe("verifyWebsite", () => {
  const ev = (urls: string[], spelled = true) => ({
    searchUrls: new Set(urls.map(normaliseUrl)),
    searchUrlsExact: new Set(urls.map(normaliseUrlExact)),
    urlSpelling: spelled ? new Map(urls.flatMap((u) => [[normaliseUrl(u), u], [normaliseUrlExact(u), u]] as const)) : undefined,
  });
  it("keeps the search's spelling for an exact URL", () => {
    expect(verifyWebsite("http://acme.com/services/", ev(["https://www.acme.com/services"]))).toBe("https://www.acme.com/services");
  });
  it("accepts a bare homepage when the host was searched, as the origin", () => {
    expect(verifyWebsite("https://acme.com/", ev(["https://acme.com/services"]))).toBe("https://acme.com/");
  });
  it("refuses a made-up deeper page, non-http and junk", () => {
    expect(verifyWebsite("https://acme.com/made-up-page", ev(["https://acme.com/services"]))).toBeNull();
    expect(verifyWebsite("ftp://acme.com/", ev(["https://acme.com/services"]))).toBeNull();
    expect(verifyWebsite("acme", ev(["https://acme.com/services"]))).toBeNull();
  });
  it("needs an exact match on aggregator hosts", () => {
    expect(verifyWebsite("https://facebook.com/acmeplumbing", ev(["https://facebook.com/other"]))).toBeNull();
    expect(verifyWebsite("https://www.yelp.com/biz/acme?osq=x", ev(["https://www.yelp.com/biz/acme?osq=x"]))).toBe(
      "https://www.yelp.com/biz/acme?osq=x",
    );
    expect(verifyWebsite("https://www.yelp.com/biz/acme?osq=y", ev(["https://www.yelp.com/biz/acme?osq=x"]))).toBeNull();
  });
});

describe("appearsInCitations", () => {
  const c = [cite("https://acme.com", "Call 312-555-0100 today, or write to Bob@Acme.com.")];
  it("matches phones in any common format", () => {
    expect(appearsInCitations("(312) 555-0100", c, "phone")).toBe(true);
    expect(appearsInCitations("312.555.0100", c, "phone")).toBe(true);
    expect(appearsInCitations("+1 312 555 0100", c, "phone")).toBe(true);
    expect(appearsInCitations("555-0100", c, "phone")).toBe(false);
  });
  it("never combines digits across numbers", () => {
    expect(appearsInCitations("312 555 0100", [cite("https://a.com", "312 555 0199 and 0100")], "phone")).toBe(false);
  });
  it("matches emails case-insensitively on whole addresses", () => {
    expect(appearsInCitations("bob@acme.com", c, "email")).toBe(true);
    expect(appearsInCitations("bob@acme.com", [cite("https://a.com", "jimbob@acme.com")], "email")).toBe(false);
  });
  it("text mode: grades are case-sensitive and the sign must match", () => {
    expect(appearsInCitations("A+", [cite("https://a.com", "rated A+ (Superior)")], "text")).toBe(true);
    expect(appearsInCitations("A", [cite("https://a.com", "AM Best")], "text")).toBe(false);
    expect(appearsInCitations("A", [cite("https://a.com", "is a carrier")], "text")).toBe(false);
    expect(appearsInCitations("A", [cite("https://a.com", "rated A+")], "text")).toBe(false);
  });
  it("text mode normalises curly quotes and spaces", () => {
    expect(appearsInCitations("Joe's  24/7 service", [cite("https://a.com", "Joe’s 24/7 service, always")], "text")).toBe(true);
  });
});

describe("normaliseBusinessName / nameAppears", () => {
  it("drops legal suffixes and punctuation", () => {
    expect(normaliseBusinessName("Acme Plumbing, Inc.")).toBe("acme plumbing");
    expect(normaliseBusinessName("The Smith & Sons Co. L.L.C.")).toBe("smith and sons");
  });
  it("matches whole tokens in the item's own sources only", () => {
    const own = [cite("https://acme.com", "ACME PLUMBING LLC – Chicago")];
    expect(nameAppears("Acme Plumbing, Inc.", own, [])).toBe(true);
    expect(nameAppears("Acme", [cite("https://x.com", "Acmeville Roofing")], [])).toBe(false);
    expect(nameAppears("Acme Plumbing", [], ["Other Co"])).toBe(false);
    expect(nameAppears("Acme Plumbing", [], ["Acme Plumbing | Home"])).toBe(true);
  });
});

describe("verifyRating", () => {
  it("keeps a numeric rating with its label nearby", () => {
    expect(verifyRating({ value: "4.8", label: "Google", reviews: null }, [cite("https://a.com", "Rated 4.8 on Google")])).toEqual({
      value: "4.8", label: "Google", reviews: null,
    });
  });
  it("drops distances and ratings cited for someone else", () => {
    expect(verifyRating({ value: "4.8", label: "Google", reviews: null }, [cite("https://a.com", "Google says 4.8 miles away")])).toBeNull();
    expect(verifyRating({ value: "4.8", label: "Google", reviews: null }, [])).toBeNull();
  });
  it("grades need the label, case-sensitive", () => {
    expect(verifyRating({ value: "A", label: "AM Best", reviews: null }, [cite("https://a.com", "A.M. Best financial strength rating: A (Excellent)")])).not.toBeNull();
    expect(verifyRating({ value: "A", label: "BBB", reviews: null }, [cite("https://a.com", "BBB rating: A+")])).toBeNull();
    expect(verifyRating({ value: "A+", label: "AM Best", reviews: null }, [cite("https://a.com", "BBB rating: A+")])).toBeNull();
  });
  it("keeps the review count only next to 'reviews'", () => {
    const text = "4.7 stars from 1,234 reviews on Yelp";
    expect(verifyRating({ value: "4.7", label: "Yelp", reviews: 1234 }, [cite("https://a.com", text)])?.reviews).toBe(1234);
    expect(verifyRating({ value: "4.7", label: "Yelp", reviews: 99 }, [cite("https://a.com", text)])).toEqual({
      value: "4.7", label: "Yelp", reviews: null,
    });
    // A review count can stand in for the label on numeric ratings.
    expect(verifyRating({ value: "4.7", label: "Site", reviews: 1234 }, [cite("https://a.com", text)])?.reviews).toBe(1234);
  });
});

describe("lintMarketingCopy", () => {
  it("flags superlatives and promises", () => {
    expect(lintMarketingCopy("The best plumber").found).toEqual(["best"]);
    expect(lintMarketingCopy("top-rated and #1 in town").found).toEqual(["top-rated", "#1"]);
    expect(lintMarketingCopy("Affordable, guaranteed work").found).toEqual(["affordable", "guaranteed"]);
  });
  it("lets ordinary phrases and the rating agency pass", () => {
    expect(lintMarketingCopy("Works on the top floor").ok).toBe(true);
    expect(lintMarketingCopy("Rated A by AM Best").ok).toBe(true);
  });
});

describe("verifyClaims", () => {
  const c = [cite("https://acme.com/about", "We offer 24/7 emergency service and the best prices in Chicago.")];
  it("keeps verbatim, short, unflagged quotes with their URL", () => {
    expect(verifyClaims(["24/7 emergency service"], c)).toEqual([{ text: "24/7 emergency service", url: "https://acme.com/about" }]);
  });
  it("drops paraphrases, marketing and long quotes", () => {
    expect(verifyClaims(["round-the-clock emergency service"], c)).toEqual([]);
    expect(verifyClaims(["best prices in Chicago"], c)).toEqual([]);
    expect(verifyClaims(["x".repeat(200)], [cite("https://a.com", "x".repeat(200))])).toEqual([]);
  });
});

describe("scrubWebTask", () => {
  const redact = {
    names: ["Ada Okonkwo", "Okonkwo", "Ada"],
    addresses: ["2158 N. Damen Ave", "2158 N. Damen"],
    keep: ["Chicago", "IL", "Illinois"],
  };
  it("removes personal data and keeps the building facts", () => {
    const out = scrubWebTask(
      "Roofer for a 6-unit building built 1925 in Chicago. Contact ada@x.com, see https://x.com/p, call 312-555-0100, SSN 123456789, Unit 2B, apt 3, #4, budget $12,500 or 12,500, ZIP 60622, 2158 N Damen Ave, Okonkwo said so.",
      redact,
    );
    for (const gone of ["ada@x.com", "https://x.com", "312-555-0100", "123456789", "2B", "apt 3", "#4", "$12,500", "12,500", "60622", "2158", "Damen", "Okonkwo"]) {
      expect(out).not.toContain(gone);
    }
    expect(out).toContain("1925");
    expect(out).toContain("Chicago");
    expect(out).toContain("6-unit building");
    expect(out).not.toMatch(/\[removed\]\s*\[removed\]/);
  });
  it("keeps unit counts", () => {
    expect(scrubWebTask("12 units and 3 stories", redact)).toBe("12 units and 3 stories");
  });
  it("removes a full name, then single tokens", () => {
    expect(scrubWebTask("Ada Okonkwo asked; okonkwo again", redact)).toBe("[removed] asked; [removed] again");
  });
  it("caps at 2,000 characters", () => {
    expect(scrubWebTask("word ".repeat(1000), redact).length).toBeLessThanOrEqual(2000);
  });
});

function text(t: string, citations: { url: string; cited_text: string; title?: string | null }[] = []): BetaContentBlock {
  return {
    type: "text",
    text: t,
    citations: citations.map((c) => ({
      type: "web_search_result_location", url: c.url, title: c.title ?? null, cited_text: c.cited_text, encrypted_index: "x",
    })),
  } as BetaContentBlock;
}
function results(urls: { url: string; title: string }[]): BetaContentBlock {
  return {
    type: "web_search_tool_result",
    tool_use_id: "t1",
    content: urls.map((u) => ({ type: "web_search_result", url: u.url, title: u.title, page_age: null, encrypted_content: "e" })),
  } as BetaContentBlock;
}
function searchError(code: string): BetaContentBlock {
  return { type: "web_search_tool_result", tool_use_id: "t2", content: { type: "web_search_tool_result_error", error_code: code } } as BetaContentBlock;
}

const fixture = [
  {
    content: [
      results([
        { url: "https://www.acmeplumbing.com/", title: "Acme Plumbing | Chicago" },
        { url: "https://www.yelp.com/biz/bolt-electric-chicago?osq=x", title: "Bolt Electric - Yelp" },
        { url: "https://uncited.example.com/page", title: "Uncited page" },
      ]),
      searchError("too_many_requests"),
    ],
  },
  {
    content: [
      text("Acme Plumbing offers repairs."),
      text(" Call them at 312-555-0100.", [
        { url: "https://www.acmeplumbing.com/", cited_text: "Acme Plumbing: call 312-555-0100 for 24/7 emergency service", title: "Acme" },
      ]),
      text(" Bolt Electric is listed on Yelp.", [
        { url: "https://www.yelp.com/biz/bolt-electric-chicago?osq=x", cited_text: "Bolt Electric 4.6 (88 reviews) phone 773-555-0199" + "z".repeat(400) },
      ]),
    ],
  },
];

describe("collectEvidence", () => {
  const ev = collectEvidence(fixture);
  it("collects search and citation URLs, normalised and exact", () => {
    expect(ev.searchUrls.has("acmeplumbing.com")).toBe(true);
    expect(ev.searchUrlsExact.has("yelp.com/biz/bolt-electric-chicago?osq=x")).toBe(true);
    expect(ev.results).toHaveLength(3);
  });
  it("numbers cited sources first and records errors", () => {
    expect(ev.sources.map((s) => s.url)).toEqual([
      "https://www.acmeplumbing.com/",
      "https://www.yelp.com/biz/bolt-electric-chicago?osq=x",
      "https://uncited.example.com/page",
    ]);
    expect(ev.sources[2].quotes).toEqual([]);
    expect(ev.searchErrors).toEqual(["too_many_requests"]);
    expect(ev.notes).toContain("312-555-0100. [1]");
  });
  it("caps quotes at 300 characters", () => {
    expect(ev.sources[1].quotes[0].length).toBe(300);
  });
});

describe("citationsFor", () => {
  const ev: Evidence = collectEvidence([
    ...fixture,
    { content: [text("More.", [{ url: "https://acmeplumbing.com/contact", cited_text: "Acme Plumbing, info@acmeplumbing.com" }])] },
  ]);
  it("includes own URLs and same-host pages, never another item's directory page", () => {
    const own = citationsFor(["https://acmeplumbing.com/"], ev).map((c) => c.url);
    expect(own).toContain("https://www.acmeplumbing.com/");
    expect(own).toContain("https://acmeplumbing.com/contact");
    expect(own.some((u) => u.includes("yelp"))).toBe(false);
  });
});

describe("verifyItems", () => {
  const ev = collectEvidence(fixture);
  type Item = { name: string; phone: string | null; note: string | null; claims: string[]; sourceUrls: string[] };
  const nameOf = (i: Item) => i.name;
  const pass = (i: Item) => i;
  const item = (over: Partial<Item>): Item => ({ name: "Acme Plumbing", phone: null, note: null, claims: [], sourceUrls: ["https://acmeplumbing.com"], ...over });

  it("drops an item whose only URL wasn't returned", () => {
    expect(verifyItems([item({ sourceUrls: ["https://fabricated.example.com/"] })], ev, nameOf, pass)).toEqual([]);
  });
  it("keeps and respells a URL differing only by www or slash", () => {
    const [kept] = verifyItems([item({})], ev, nameOf, pass);
    expect(kept.sourceUrls).toEqual(["https://www.acmeplumbing.com/"]);
    expect(kept.evidence[0]).toEqual({
      url: "https://www.acmeplumbing.com/",
      title: "Acme Plumbing | Chicago",
      quote: "Acme Plumbing: call 312-555-0100 for 24/7 emergency service",
    });
  });
  it("drops an invented business on a real listing page", () => {
    expect(verifyItems([item({ name: "Zeta Roofing" })], ev, nameOf, pass)).toEqual([]);
  });
  it("drops a phone cited only for another business", () => {
    const verify = (i: Item, ctx: { citations: Citation[] }) => ({
      ...i, phone: i.phone && appearsInCitations(i.phone, ctx.citations, "phone") ? i.phone : null,
    });
    const [kept] = verifyItems([item({ phone: "773-555-0199" })], ev, nameOf, verify);
    expect(kept.phone).toBeNull();
    const [kept2] = verifyItems([item({ phone: "(312) 555-0100" })], ev, nameOf, verify);
    expect(kept2.phone).toBe("(312) 555-0100");
  });
  it("drops on caller null, on removing every URL, and on adding one", () => {
    expect(verifyItems([item({})], ev, nameOf, () => null)).toEqual([]);
    expect(verifyItems([item({})], ev, nameOf, (i) => ({ ...i, sourceUrls: [] }))).toEqual([]);
    expect(verifyItems([item({})], ev, nameOf, (i) => ({ ...i, sourceUrls: [...i.sourceUrls, "https://uncited.example.com/page"] }))).toEqual([]);
  });
  it("nulls free text with marketing words and filters arrays, but not the name", () => {
    const [kept] = verifyItems(
      [item({ name: "Acme Plumbing", note: "The best in town", claims: ["24/7 emergency service", "top-rated"] })],
      ev, nameOf, pass,
    );
    expect(kept.note).toBeNull();
    expect(kept.claims).toEqual(["24/7 emergency service"]);
  });
  it("accepts an aggregator URL only by exact match", () => {
    const bolt = { name: "Bolt Electric", phone: null, note: null, claims: [], sourceUrls: ["https://yelp.com/biz/bolt-electric-chicago?osq=x"] };
    expect(verifyItems([bolt], ev, nameOf, pass)).toHaveLength(1);
    expect(verifyItems([{ ...bolt, sourceUrls: ["https://yelp.com/biz/bolt-electric-chicago"] }], ev, nameOf, pass)).toEqual([]);
  });
});
