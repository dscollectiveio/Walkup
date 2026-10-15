import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * internal.ts makes model calls without touching the quota. Only code inside
 * src/lib/ai may import it; area code goes through runStructured/webResearch.
 */

const SRC = path.resolve(__dirname, "../../src");
const AI_DIR = path.join(SRC, "lib", "ai");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|js|jsx|mjs)$/.test(e.name) ? [full] : [];
  });
}

const IMPORTS_INTERNAL = /from\s+["'](?:@\/lib\/ai\/internal|(?:\.{1,2}\/)+(?:[\w-]+\/)*internal|[^"']*lib\/ai\/internal)["']|import\(\s*["'][^"']*\/internal["']\s*\)/;

describe("internal.ts import guard", () => {
  it("is imported only from inside src/lib/ai", () => {
    const offenders = sourceFiles(SRC)
      .filter((f) => !f.startsWith(AI_DIR + path.sep))
      .filter((f) => IMPORTS_INTERNAL.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it("the guard pattern catches the usual spellings", () => {
    expect(IMPORTS_INTERNAL.test('import { callStructured } from "@/lib/ai/internal";')).toBe(true);
    expect(IMPORTS_INTERNAL.test("import { x } from '../../lib/ai/internal';")).toBe(true);
    expect(IMPORTS_INTERNAL.test('import { x } from "./internal";')).toBe(true);
    expect(IMPORTS_INTERNAL.test('import { x } from "@/lib/ai/structured";')).toBe(false);
  });

  it("structured.ts doesn't re-export the unmetered calls", () => {
    const text = readFileSync(path.join(AI_DIR, "structured.ts"), "utf8");
    expect(text).not.toMatch(/export\s*\{[^}]*\b(runStructuredUnmetered|callStructured)\b/);
    expect(text).not.toMatch(/export\s+(async\s+)?function\s+(runStructuredUnmetered|callStructured)\b/);
    expect(text).not.toMatch(/export\s*\*\s*from\s*["']\.\/internal["']/);
  });
});
