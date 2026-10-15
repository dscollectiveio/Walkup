import { describe, expect, it } from "vitest";
import { postgrestIlikeValue, referenceFromQuery } from "@/lib/repairs/search";

describe("postgrestIlikeValue", () => {
  it("wraps plain text in %…% and double quotes", () => {
    expect(postgrestIlikeValue("leak")).toBe('"%leak%"');
  });

  it("matches the spec example: a,b \"c\"", () => {
    expect(postgrestIlikeValue('a,b "c"')).toBe('"%a,b \\"c\\"%"');
  });

  it("keeps PostgREST's reserved characters inside the quotes", () => {
    expect(postgrestIlikeValue("roof (north)")).toBe('"%roof (north)%"');
    expect(postgrestIlikeValue("a.b:c")).toBe('"%a.b:c%"');
  });

  it("escapes LIKE wildcards so they match themselves", () => {
    // % -> \% for LIKE, then the backslash doubled for the quoted value.
    expect(postgrestIlikeValue("50%")).toBe('"%50\\\\%%"');
    expect(postgrestIlikeValue("a_b")).toBe('"%a\\\\_b%"');
  });

  it("escapes a backslash twice: once for LIKE, once for the quoting", () => {
    expect(postgrestIlikeValue("a\\b")).toBe('"%a\\\\\\\\b%"');
  });
});

describe("referenceFromQuery", () => {
  it("reads #12 and 12 as problem numbers", () => {
    expect(referenceFromQuery("#12")).toBe(12);
    expect(referenceFromQuery(" 12 ")).toBe(12);
    expect(referenceFromQuery("# 7")).toBe(7);
  });

  it("anything else is text", () => {
    expect(referenceFromQuery("12 leaks")).toBeNull();
    expect(referenceFromQuery("#0")).toBeNull();
    expect(referenceFromQuery("")).toBeNull();
  });
});
