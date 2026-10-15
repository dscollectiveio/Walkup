import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Pages that host a model call, start after() work that does, or host photo
 * uploads declare the literal `export const maxDuration = 300;` (repairs-spec
 * §2.5, foundation 5.2). Segment config must be a literal.
 */
const LINE = "export const maxDuration = 300;";
const PAGES = [
  "src/app/repairs/page.tsx",
  "src/app/repairs/report/page.tsx",
  "src/app/repairs/find/page.tsx",
  "src/app/maintenance/[ticketId]/page.tsx",
  "src/app/contractors/[vendorId]/page.tsx",
];

const root = path.resolve(__dirname, "../..");

describe("Repairs maxDuration", () => {
  it.each(PAGES)("%s declares maxDuration = 300", (page) => {
    expect(readFileSync(path.join(root, page), "utf8")).toContain(LINE);
  });
});
