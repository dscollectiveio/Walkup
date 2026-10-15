import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AI_JOB_SECONDS } from "@/lib/ai/jobs";

/**
 * insurance-spec §3.1: a server action runs under the maxDuration of the page
 * it was invoked from, so every insurance page that can invoke an action that
 * calls the model or starts after() model work declares the literal
 * `export const maxDuration = 300;`. Found by following each page's local
 * imports (the components it renders) to the action modules.
 */

const ROOT = path.resolve(__dirname, "../..");
const INSURANCE = path.join(ROOT, "src/app/insurance");
const ACTION_MODULES = ["import-actions", "policy-actions", "quote-actions", "request-actions", "message-actions", "market-actions"];
const LITERAL = `export const maxDuration = ${AI_JOB_SECONDS};`;

/** The §3.1 table (pages under src/app/insurance), checked whenever the page exists. */
const TABLE = [
  "page.tsx",
  "import/page.tsx",
  "import/[readId]/page.tsx",
  "import/[readId]/[index]/page.tsx",
  "policies/new/page.tsx",
  "policies/[id]/page.tsx",
  "policies/[id]/edit/page.tsx",
  "policies/[id]/renew/page.tsx",
  "quotes/new/page.tsx",
  "quotes/[id]/edit/page.tsx",
  "emails/new/page.tsx",
  "contacts/[id]/page.tsx",
  "compare/page.tsx",
  "quotes/[id]/page.tsx",
  "review/[documentId]/page.tsx",
];

function pages(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...pages(full));
    else if (name === "page.tsx") out.push(full);
  }
  return out;
}

function resolveLocal(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/app/insurance")) base = path.join(ROOT, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  if (!base.startsWith(INSURANCE)) return null;
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const f = base + ext;
    if (existsSync(f) && statSync(f).isFile()) return f;
  }
  return null;
}

/** True when the file, or anything it imports from the insurance area, imports an action module. */
function reachesActions(file: string, seen = new Set<string>()): boolean {
  if (seen.has(file)) return false;
  seen.add(file);
  const text = readFileSync(file, "utf8");
  const specs = [...text.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
  for (const spec of specs) {
    const last = spec.split("/").pop() ?? "";
    if (ACTION_MODULES.includes(last) && (spec.startsWith(".") || spec.startsWith("@/app/insurance"))) return true;
    const next = resolveLocal(file, spec);
    if (next && !ACTION_MODULES.some((m) => next.endsWith(`${m}.ts`)) && reachesActions(next, seen)) return true;
  }
  return false;
}

describe("insurance pages declare maxDuration", () => {
  const all = pages(INSURANCE);

  it("finds the insurance pages", () => {
    expect(all.length).toBeGreaterThan(5);
  });

  // The explicit table drives this: a page that is renamed or deleted fails here instead of passing by not existing.
  it.each(TABLE)("§3.1 table: %s exists and declares it", (rel) => {
    const file = path.join(INSURANCE, rel);
    expect(existsSync(file), `${rel} is in the §3.1 table but not on disk`).toBe(true);
    expect(readFileSync(file, "utf8")).toContain(LITERAL);
  });

  it("every other page that can reach a model action is in the table (so a new one cannot slip past)", () => {
    const inTable = new Set(TABLE.map((rel) => path.join(INSURANCE, rel)));
    const reaching = all.filter((file) => reachesActions(file));
    expect(reaching.length).toBeGreaterThan(3); // the walk itself works
    const unlisted = reaching.filter((file) => !inTable.has(file)).map((file) => path.relative(INSURANCE, file));
    expect(unlisted).toEqual([]);
    for (const file of reaching) expect(readFileSync(file, "utf8")).toContain(LITERAL);
  });

  it("follows components: the Overview reaches import-actions through the uploader", () => {
    expect(reachesActions(path.join(INSURANCE, "page.tsx"))).toBe(true);
  });
});
