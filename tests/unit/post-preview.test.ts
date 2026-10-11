import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PostPreview, inOutLabel, previewFlags, type PreviewRow } from "@/app/bank-feed/post-preview";

const row = (description: string, amount: number, typicalCents: number | null): PreviewRow => ({
  id: description,
  description,
  amount,
  typicalCents,
});

describe("previewFlags", () => {
  it("names first-time payees and amounts well above the usual, at most three flags", () => {
    const flags = previewFlags([
      row("COMED", -900, 25000),
      row("NEW PLUMBER", -300, null),
      row("ANOTHER NEW", -40, null),
      row("WASTE MGMT", -210, 20000),
      row("LANDSCAPER", -2000, 50000),
      row("ROOFER", -9000, 100000),
    ]);
    expect(flags).toHaveLength(3);
    expect(flags[0]).toBe("2 first-time payees: NEW PLUMBER, ANOTHER NEW");
    expect(flags[1]).toBe("COMED $900.00 is 4× its usual $250");
    expect(flags[2]).toBe("LANDSCAPER $2,000.00 is 4× its usual $500");
  });

  it("is quiet when nothing stands out", () => {
    expect(previewFlags([row("COMED", -260, 25000), row("WASTE MGMT", -210, 20000)])).toEqual([]);
  });
});

describe("PostPreview", () => {
  it("says how many, how much each way, and the flags", () => {
    const rows = [row("COMED", -900, 25000), row("ZELLE J SMITH", 450, 45000), row("NEW PLUMBER", -300, null)];
    expect(inOutLabel(rows)).toBe("$1,200 out · $450 in");
    const html = renderToStaticMarkup(createElement(PostPreview, { rows, onPost: () => {}, onCancel: () => {} }));
    expect(html).toContain("Post 3 transactions?");
    expect(html).toContain("$1,200 out · $450 in");
    expect(html).toContain("First time for this payee: NEW PLUMBER");
    expect(html).toContain(">Post<");
    expect(html).toContain(">Cancel<");
  });
});
