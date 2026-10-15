import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../..");
const TARGETS = [
  "src/app/owner",
  "src/app/announcements",
  "src/components/owner",
  "src/components/board-only.tsx",
  "src/components/board-only-view.tsx",
  "src/lib/owner",
  "src/app/building/owner-invite-actions.ts",
  "src/app/building/invite-to-sign-in.tsx",
];

function files(p: string): string[] {
  const abs = path.join(ROOT, p);
  if (statSync(abs).isFile()) return [p];
  return readdirSync(abs).flatMap((f) => files(path.join(p, f)));
}
const all = TARGETS.flatMap(files).filter((f) => /\.(tsx?|ts)$/.test(f));

describe("owner portal copy", () => {
  it("finds the files", () => {
    expect(all.length).toBeGreaterThan(30);
  });

  it("uses no em dash anywhere (user-facing copy and comments alike)", () => {
    const bad = all.filter((f) => readFileSync(path.join(ROOT, f), "utf8").includes("—"));
    expect(bad).toEqual([]);
  });

  it('never says "vendor" (the word is "contractor")', () => {
    const bad = all.filter((f) => /\bvendors?\b/i.test(readFileSync(path.join(ROOT, f), "utf8")));
    expect(bad).toEqual([]);
  });

  it("never renders announcement text as HTML", () => {
    const bad = all.filter((f) => readFileSync(path.join(ROOT, f), "utf8").includes("dangerouslySetInnerHTML"));
    expect(bad).toEqual([]);
  });

  it("the migration has no em dash in a user-facing error either", () => {
    const sql = readFileSync(path.join(ROOT, "supabase/migrations/0054_owner_portal.sql"), "utf8");
    const raised = [...sql.matchAll(/raise exception '([^']*(?:''[^']*)*)'/g)].map((m) => m[1]);
    expect(raised.length).toBeGreaterThan(20);
    expect(raised.filter((m) => m.includes("—"))).toEqual([]);
  });
});
