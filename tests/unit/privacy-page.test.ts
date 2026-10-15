import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The privacy page has to say what the build actually does (foundation-spec
 * 9). Whitespace is collapsed first, because JSX does the same and the copy
 * wraps across source lines.
 */
const source = readFileSync(path.resolve(__dirname, "../../src/app/privacy/page.tsx"), "utf8")
  .replace(/\s+/g, " ");

describe("privacy page", () => {
  it("names Anthropic and the four AI uses", () => {
    expect(source).toContain("Anthropic");
    expect(source).toContain("Reading documents.");
    expect(source).toContain("When anyone in your building reports a problem");
    expect(source).toContain("Writing drafts and summaries.");
    expect(source).toContain("Searching the web.");
  });

  it("lists exactly the web-search details", () => {
    for (const item of [
      "city, state and ZIP code",
      "number of units and stories",
      "year built",
      "construction type",
      "kinds of insurance coverage",
      "kind of work needed",
    ]) {
      expect(source).toContain(item);
    }
    expect(source).toContain("what an owner wrote when reporting a problem is never searched");
  });

  it("names every company in the first sharing paragraph", () => {
    const start = source.indexOf("Only the companies named on this page");
    expect(start).toBeGreaterThan(-1);
    const paragraph = source.slice(start, source.indexOf("</p>", start));
    for (const name of ["Supabase", "Vercel", "Plaid", "Anthropic", "Google", "Photon", "Resend"]) {
      expect(paragraph).toContain(name);
    }
  });

  it("describes email from Walkup, the import's AI mapping and the owner portal's data", () => {
    expect(source).toContain("unsubscribe");
    expect(source).toContain("24 months");
    expect(source).not.toContain("never sends email for you");
    expect(source).toContain("Walkup sends an email only when a board administrator has approved it");
    expect(source).toContain("the column names and a character-by-character mask of a few sample cells");
    expect(source).toContain("never the values themselves");
    expect(source).toContain("Spreadsheets your board imports are read to create records and then removed");
    expect(source).toContain("which owners opened them. The board sees how many owners opened a post, not who");
    expect(source).toContain("A phone number and mailing address you add to your own profile");
  });

  it("mentions uploaded photos and their location data", () => {
    expect(source).toContain("saved without their location data");
  });

  it("uses no em dashes in the new copy", () => {
    const ai = source.slice(source.indexOf("Only the companies named"), source.indexOf("does not endorse anyone"));
    expect(ai).not.toMatch(/—|&mdash;/);
  });
});
