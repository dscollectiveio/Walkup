// Regression tests for docs/security/REVIEW-2-server.md findings 3, 4, 5, 6 and 22: the anti-fabrication
// verifiers must not keep what a source did not say. Each case is a proof from the review.
import { describe, expect, it } from "vitest";
import * as V from "@/lib/ai/verify";
import * as MV from "@/lib/insurance/market-verify";
import * as WV from "@/lib/contractors/web-verify";
import { safeHttpUrl } from "@/lib/security/safe-url";
import { scrubForModel } from "@/lib/repairs/scrub";

const cite = (url: string, citedText: string, title: string | null = null) => ({ url, title, citedText });

describe("3. an agency's website is http(s) only and never the model's own spelling", () => {
  const u = "https://acmeagency.com/about";
  const searchUrls = new Set([V.normaliseUrl(u)]);
  const mk = (website: string): MV.AgencyItem => ({
    name: "Acme Insurance Agency", website, city: null, state: null, phone: null, email: null, lines: [],
    worksWithAssociations: false, independent: null, about: null, sourceUrls: [u],
  });
  const citations = [cite(u, "Acme Insurance Agency helps condominium associations.")];

  it("drops javascript:, data:, file: and ftp: URLs that carry a searched host", () => {
    for (const w of [
      "javascript://acmeagency.com/%0Aalert(document.domain)",
      "data://acmeagency.com/",
      "file://acmeagency.com/etc/passwd",
      "ftp://acmeagency.com/",
    ]) {
      expect(MV.verifyAgency(mk(w), { searchUrls, citations })?.website ?? null, w).toBeNull();
    }
  });

  it("drops a query string, fragment or other path on a searched host", () => {
    const out = MV.verifyAgency(mk("https://acmeagency.com/anything?redirect=https://evil.example"), { searchUrls, citations });
    expect(out?.website ?? null).toBeNull();
    const same = MV.verifyAgency(mk("https://acmeagency.com/about?x=https://evil.example#frag"), { searchUrls, citations });
    expect(same?.website).toBe("https://acmeagency.com/about");
  });

  it("does not approve any path on a shared platform just because one page of it was in the results", () => {
    const u2 = "https://medium.com/@someone/acme-insurance-agency-review";
    const item: MV.AgencyItem = { ...mk("https://medium.com/@attacker/pay-here"), sourceUrls: [u2] };
    const out = MV.verifyAgency(item, {
      searchUrls: new Set([V.normaliseUrl(u2)]),
      searchUrlsExact: new Set([V.normaliseUrlExact(u2)]),
      citations: [cite(u2, "Acme Insurance Agency is a local agency.")],
    });
    expect(out?.website ?? null).toBeNull();
  });

  it("treats the usual social, blogging and link-shortener hosts as aggregators", () => {
    for (const h of ["x.com", "twitter.com", "youtube.com", "github.com", "medium.com", "reddit.com", "pinterest.com",
      "tiktok.com", "linktr.ee", "bit.ly", "t.co", "wixsite.com", "fb.com", "g.page", "business.site"]) {
      expect(V.isAggregatorHost(h), h).toBe(true);
    }
  });

  it("safeHttpUrl is the guard at the render site", () => {
    expect(safeHttpUrl("https://acme.example/x")).toBe("https://acme.example/x");
    for (const bad of ["javascript:alert(1)", "javascript://x.com/%0Aalert(1)", "data:text/html,x", "file:///etc/passwd",
      "ftp://x.com", "//x.com", "/relative", "https://u:p@x.com", "https://x.com/ a", null, undefined, ""]) {
      expect(safeHttpUrl(bad as string | null), String(bad)).toBeNull();
    }
  });
});

describe("4. an AM Best grade needs the insurer, AM Best and a rating in one sentence", () => {
  const url = "https://acmemutual.com/about";
  const searchUrls = new Set([V.normaliseUrl(url)]);
  const where = { state: "IL", stateName: "Illinois" };
  const item: MV.InsurerItem = {
    name: "Acme Mutual Insurance", website: url, writesAssociations: false, writesInState: null, lines: [],
    amBestRating: "A", amBestSourceUrl: url, about: null, sourceUrls: [url],
  };
  const run = (text: string, rating = "A") =>
    MV.verifyInsurer({ ...item, amBestRating: rating }, { searchUrls, citations: [cite(url, text)] }, where);

  it("the article 'A' and the 'A' of 'A.M. Best' are not a grade", () => {
    const out = run("A.M. Best is an insurance rating agency. A mutual company, Acme Mutual Insurance writes condo master policies.");
    expect(out?.amBestRating ?? null).toBeNull();
    expect(out?.verified.rating).toBe(false);
  });

  it("another insurer's grade in the same snippet is not this insurer's", () => {
    const out = run("A.M. Best rates Zenith Mutual A+. Acme Mutual Insurance is a regional carrier.", "A+");
    expect(out?.amBestRating ?? null).toBeNull();
  });

  it("keeps the grade when one sentence names the insurer, AM Best and the rating", () => {
    expect(run("A.M. Best rates Acme Mutual Insurance A (Excellent).")?.amBestRating).toBe("A");
    expect(run("Acme Mutual Insurance holds an A.M. Best financial strength rating of A+.", "A+")?.amBestRating).toBe("A+");
  });

  it("verifyRating: a one-letter label matches nothing, and the grade is never the A of A.M. Best", () => {
    expect(V.verifyRating({ value: "4.9", label: "a", reviews: null }, [cite("https://x.com", "Release notes: version 4.9 shipped today.")])).toBeNull();
    expect(V.verifyRating({ value: "A+", label: "e", reviews: null }, [cite("https://x.com", "Zenith earned an A+ last year; Acme was not rated.")])).toBeNull();
    expect(V.verifyRating({ value: "A", label: "AM Best", reviews: null }, [cite("https://x.com", "A.M. Best publishes financial strength ratings for insurers.")])).toBeNull();
    expect(V.verifyRating({ value: "A", label: "AM Best", reviews: null }, [cite("https://x.com", "AM Best rating: A (Excellent)")])?.value).toBe("A");
  });

  it("verifyRating: a bare number needs a rating cue beside it", () => {
    expect(V.verifyRating({ value: "4.9", label: "Google", reviews: null }, [cite("https://x.com", "Google Chrome version 4.9 shipped.")])).toBeNull();
    expect(V.verifyRating({ value: "4.9", label: "Google", reviews: null }, [cite("https://x.com", "Google rating: 4.9 stars")])?.value).toBe("4.9");
  });
});

describe("5. a contractor's rating needs rating context and a named source", () => {
  const url = "https://acmeplumbing.com/";
  const ctx = (citations: V.Citation[]) => ({
    searchUrls: new Set([V.normaliseUrl(url)]),
    searchUrlsExact: new Set([V.normaliseUrlExact(url)]),
    citations,
  });
  const item = (over: Partial<WV.WebContractor>): WV.WebContractor => ({
    name: "Acme Plumbing", websiteUrl: url, cityOrArea: null, phone: null, email: null, rating: 4.5, reviewCount: 14, ratingSource: "Google",
    emergencyService: null, mentionsCondoWork: null, smallJobsWelcome: null, freeEstimates: null, snippet: null, sourceUrls: [url], ...over,
  });

  it("two numbers that merely sit near each other are not a rating", () => {
    const c = [cite(url, "Acme Plumbing serves Chicago since 2010 with 14 technicians. Our shop is 4.5 miles from the Loop.", "Acme Plumbing")];
    const out = WV.verifyWebContractor(item({}), ctx(c));
    expect(out?.rating ?? null).toBeNull();
    expect(out?.reviewCount ?? null).toBeNull();
    expect(out?.ratingSource ?? null).toBeNull();
  });

  it("a rating printed on the contractor's own site is not shown as Google's", () => {
    const c = [cite(url, "Acme Plumbing - rated 5.0 by 500 happy customers", "Acme Plumbing")];
    const out = WV.verifyWebContractor(item({ rating: 5, reviewCount: 500, ratingSource: "Google" }), ctx(c));
    expect(out?.rating ?? null).toBeNull();
    const own = [cite(url, "Acme Plumbing: Google rating 5.0 stars (500 reviews)", "Acme Plumbing")];
    expect(WV.verifyWebContractor(item({ rating: 5, reviewCount: 500, ratingSource: "Google" }), ctx(own))?.rating ?? null).toBeNull();
  });

  it("keeps a rating on a review site that names itself, with stars and a review count", () => {
    const yelp = "https://www.yelp.com/biz/acme-plumbing-chicago";
    const c = [cite(yelp, "Acme Plumbing 4.5 stars (14 reviews) Chicago, IL", "Acme Plumbing - Yelp")];
    const out = WV.verifyWebContractor(item({ websiteUrl: null, ratingSource: "Yelp", sourceUrls: [yelp] }), {
      searchUrls: new Set([V.normaliseUrl(yelp)]), searchUrlsExact: new Set([V.normaliseUrlExact(yelp)]), citations: c,
    });
    expect([out?.rating, out?.reviewCount, out?.ratingSource]).toEqual([4.5, 14, "Yelp"]);
    // ...but not under another site's name
    const wrong = WV.verifyWebContractor(item({ websiteUrl: null, ratingSource: "Google", sourceUrls: [yelp] }), {
      searchUrls: new Set([V.normaliseUrl(yelp)]), searchUrlsExact: new Set([V.normaliseUrlExact(yelp)]), citations: c,
    });
    expect(wrong?.rating ?? null).toBeNull();
  });
});

describe("6. contact details come from the right business and are one plain mailbox", () => {
  it("isSingleMailbox refuses mailto parameters, lists and second addresses", () => {
    expect(V.isSingleMailbox("info@acmeplumbing.com")).toBe(true);
    for (const bad of ["info@acme.example?bcc=attacker@evil.example", "a@b.com,c@d.com", "a@b.com;c@d.com", "a b@c.com",
      "a@b@c.com", "<a@b.com>", "a@b.com&subject=x", "a@b", ""]) {
      expect(V.isSingleMailbox(bad), bad).toBe(false);
    }
  });

  it("a contractor email with mailto parameters is dropped even when the page prints it", () => {
    const url = "https://acmeplumbing.com/";
    const email = "info@acmeplumbing.com?bcc=attacker@evil.example";
    const out = WV.verifyWebContractor(
      { name: "Acme Plumbing", websiteUrl: url, cityOrArea: null, phone: null, email, rating: null, reviewCount: null, ratingSource: null,
        emergencyService: null, mentionsCondoWork: null, smallJobsWelcome: null, freeEstimates: null, snippet: null, sourceUrls: [url] },
      { searchUrls: new Set([V.normaliseUrl(url)]), searchUrlsExact: new Set([V.normaliseUrlExact(url)]),
        citations: [cite(url, `Acme Plumbing - email ${email} for estimates`, "Acme Plumbing")] },
    );
    expect(out?.email ?? null).toBeNull();
  });

  it("an agency email with mailto parameters is dropped", () => {
    const u = "https://acmeagency.com/about";
    const email = "info@acmeagency.com?bcc=attacker@evil.example";
    const out = MV.verifyAgency(
      { name: "Acme Insurance Agency", website: null, city: null, state: null, phone: null, email, lines: [], worksWithAssociations: false,
        independent: null, about: null, sourceUrls: [u] },
      { searchUrls: new Set([V.normaliseUrl(u)]), citations: [cite(u, `Acme Insurance Agency: ${email}`)] },
    );
    expect(out?.email ?? null).toBeNull();
  });

  it("an agency does not keep the neighbouring listing's phone", () => {
    const u = "https://chamber.example.org/members";
    const item: MV.AgencyItem = {
      name: "Acme Insurance Agency", website: null, city: null, state: null, phone: "(312) 555-0199", email: null, lines: [],
      worksWithAssociations: false, independent: null, about: null, sourceUrls: [u],
    };
    const citations = [cite(u, "Acme Insurance Agency (312) 555-0100. Baker Insurance Agency (312) 555-0199.")];
    const out = MV.verifyAgency(item, { searchUrls: new Set([V.normaliseUrl(u)]), citations });
    expect(out?.phone ?? null).toBeNull();
    expect(out?.verified.phone).toBe(false);
    const own = MV.verifyAgency({ ...item, phone: "(312) 555-0100" }, { searchUrls: new Set([V.normaliseUrl(u)]), citations });
    expect(own?.phone).toBe("(312) 555-0100");
  });
});

describe("22. generic names and host matching", () => {
  it("a name made only of trade and place words is not a business", () => {
    const u = "https://chicagolist.example.org/plumbers";
    const ev: V.Evidence = {
      searchUrls: new Set([V.normaliseUrl(u)]), searchUrlsExact: new Set([V.normaliseUrlExact(u)]),
      results: [{ url: u, title: "Best plumbing contractors in Chicago" }],
      citations: [cite(u, "Plumbing contractors in Chicago: Alpha Rooter, Beta Pipe and others serve the city.", "Plumbing contractors in Chicago")],
      notes: "", sources: [], searchErrors: [],
    };
    const items: WV.WebContractor[] = [{
      name: "Plumbing Contractors", websiteUrl: null, cityOrArea: null, phone: null, email: null, rating: null, reviewCount: null,
      ratingSource: null, emergencyService: null, mentionsCondoWork: null, smallJobsWelcome: null, freeEstimates: null, snippet: null, sourceUrls: [u],
    }];
    const out = V.verifyItems(items, ev, (i) => i.name, (i, ctx) => WV.verifyWebContractor(i, ctx as never));
    expect(out).toEqual([]);
    expect(WV.isGenericName("Chicago Plumbing Contractors")).toBe(true);
    expect(WV.isGenericName("Alpha Rooter")).toBe(false);
  });

  it("hostCarriesName matches whole labels, not substrings", () => {
    expect(WV.hostCarriesName("acmeplumbing.com", "Acme Plumbing")).toBe(true);
    expect(WV.hostCarriesName("www.acme-plumbing.com", "Acme Plumbing")).toBe(true);
    expect(WV.hostCarriesName("blog.acme.com", "Acme Plumbing")).toBe(true);
    expect(WV.hostCarriesName("palace-pro-reviews.com", "Ace Pro Plumbing")).toBe(false);
    expect(WV.hostCarriesName("allthingsplumbing.net", "All Pro Plumbing")).toBe(false);
  });
});

describe("11. text bound for a model", () => {
  it("scrubWebTask removes the address variants, spelled-out units, spelled phones and obfuscated emails", () => {
    const red = { names: ["Jane Doe", "Doe", "Jane"], addresses: ["415 W. Oakdale Ave"], keep: ["Chicago", "IL", "Illinois"] };
    expect(V.scrubWebTask("415 W Oakdale Avenue entry", red)).not.toMatch(/Oakdale/);
    expect(V.scrubWebTask("Doe's building at 415 W. Oakdale", red)).not.toMatch(/Oakdale/);
    expect(V.scrubWebTask("Jane lives in apartment two", red)).not.toMatch(/apartment two/i);
    expect(V.scrubWebTask("call three one two five five five zero one four two", red)).not.toMatch(/three one two/i);
    expect(V.scrubWebTask("write jane at gmail dot com", red)).not.toMatch(/gmail/i);
    expect(V.scrubWebTask("1900 N Clark, second floor rear", red)).not.toMatch(/Clark/);
  });

  it("scrubForModel drops a person's name as well", () => {
    const out = scrubForModel("Jane Doe's radiator is cold at 1900 N Clark, call jane at gmail dot com", 2000);
    expect(out).not.toMatch(/Jane|Doe|Clark|gmail/);
    expect(out).toContain("radiator is cold");
    expect(scrubForModel("Radiator cold in the back bedroom", 2000)).toBe("Radiator cold in the back bedroom");
  });
});
