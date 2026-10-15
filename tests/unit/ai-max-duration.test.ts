import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AI_JOB_SECONDS } from "@/lib/ai/jobs";

/**
 * Pages whose server actions call the model (or start after() work that
 * does) declare `export const maxDuration = 300;` (foundation-spec 5.2).
 * Segment config must be a literal, so this keeps them in step with
 * AI_JOB_SECONDS. Area workstreams add their pages to this list.
 */
const PAGES = [
  "src/app/documents/page.tsx",
  "src/app/documents/[documentId]/page.tsx",
  "src/app/repairs/page.tsx",
  "src/app/repairs/report/page.tsx",
  "src/app/repairs/find/page.tsx",
  "src/app/maintenance/[ticketId]/page.tsx",
  "src/app/contractors/[vendorId]/page.tsx",
  "src/app/units/[unitId]/page.tsx",
];

describe("maxDuration", () => {
  it("AI_JOB_SECONDS is 300", () => {
    expect(AI_JOB_SECONDS).toBe(300);
  });

  it.each(PAGES)("%s declares maxDuration = 300", (page) => {
    const text = readFileSync(path.resolve(__dirname, "../..", page), "utf8");
    expect(text).toContain(`export const maxDuration = ${AI_JOB_SECONDS};`);
  });
});
