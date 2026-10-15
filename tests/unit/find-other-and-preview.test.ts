import { describe, expect, it } from "vitest";
import { scopePhrase, searchPhraseFor, vocabPhrase } from "@/lib/repairs/vocabulary";
import { isSearchableTrade, tradeBySlug } from "@/lib/contractors/trades";
import { previewKind, summaryBullets } from "@/lib/documents/preview";
import { buildCsp } from "@/lib/security/csp";

describe("Other kind of work", () => {
  it("is searchable with a typed scope, though it has no Google query of its own", () => {
    expect(isSearchableTrade(tradeBySlug("other"))).toBe(true);
    expect(isSearchableTrade(tradeBySlug("plumbing"))).toBe(true);
    expect(isSearchableTrade(null)).toBe(false);
  });

  it("keeps the words the board typed, but never digits or punctuation", () => {
    expect(scopePhrase("Attic fan installation 123 Main St.")).toBe("attic fan installation main st");
    expect(scopePhrase("call 312-555-0199 now")).toBe("call now");
  });

  it("caps the scope at eight words and sixty characters", () => {
    expect(scopePhrase("a b c d e f g h i j k").split(" ")).toHaveLength(8);
    expect(scopePhrase("internationalization ".repeat(10)).length).toBeLessThanOrEqual(60);
  });

  it("uses the scope for Other and the repair vocabulary for every other trade", () => {
    expect(searchPhraseFor("other", "chandelier polishing")).toBe("chandelier polishing");
    expect(searchPhraseFor("plumbing", "chandelier polishing leak")).toBe(vocabPhrase("chandelier polishing leak"));
    expect(searchPhraseFor("plumbing", "chandelier polishing leak")).toBe("leak");
  });
});

describe("document preview", () => {
  it("previews PDFs, PNG and JPEG and plain text only", () => {
    expect(previewKind("application/pdf")).toBe("pdf");
    expect(previewKind("image/png")).toBe("image");
    expect(previewKind("IMAGE/JPEG; charset=x")).toBe("image");
    expect(previewKind("text/csv")).toBe("text");
    expect(previewKind("image/svg+xml")).toBeNull();
    expect(previewKind("text/html")).toBeNull();
    expect(previewKind("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBeNull();
    expect(previewKind(null)).toBeNull();
  });

  it("turns a summary into one bullet per sentence, or per line when it already is a list", () => {
    expect(summaryBullets("It is a draft. The price is blank. Nothing is signed.")).toEqual([
      "It is a draft.",
      "The price is blank.",
      "Nothing is signed.",
    ]);
    expect(summaryBullets("- one\n- two")).toEqual(["one", "two"]);
    expect(summaryBullets("Just one sentence")).toEqual(["Just one sentence"]);
  });

  it("lets only the preview route be framed, and only by our own origin", () => {
    const frame = (framedBySelf: boolean) =>
      buildCsp({ nonce: "n", supabaseUrl: undefined, dev: false, framedBySelf })
        .split("; ")
        .find((d) => d.startsWith("frame-ancestors"));
    expect(frame(false)).toBe("frame-ancestors 'none'");
    expect(frame(true)).toBe("frame-ancestors 'self'");
  });
});
