import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * REVIEW-2 #1: classify.ts built its own Anthropic client and skipped
 * claim_ai_call. Only src/lib/ai may import the SDK as a value (`import type`
 * is fine: it makes no call), so every model call is claimed and logged.
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

/** A value import / require / dynamic import of the SDK (not `import type`). */
export const VALUE_SDK_IMPORT =
  /(?:^|\n)\s*import\s+(?!type\b)[^;]*?from\s+["']@anthropic-ai\/sdk[^"']*["']|(?:require|import)\(\s*["']@anthropic-ai\/sdk[^"']*["']\s*\)|(?:^|\n)\s*import\s+["']@anthropic-ai\/sdk[^"']*["']/;

describe("@anthropic-ai/sdk import guard", () => {
  it("is imported as a value only from inside src/lib/ai", () => {
    const offenders = sourceFiles(SRC)
      .filter((f) => !f.startsWith(AI_DIR + path.sep))
      .filter((f) => VALUE_SDK_IMPORT.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it("the pattern catches the usual spellings and allows type imports", () => {
    expect(VALUE_SDK_IMPORT.test('import Anthropic from "@anthropic-ai/sdk";')).toBe(true);
    expect(VALUE_SDK_IMPORT.test('import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";')).toBe(true);
    expect(VALUE_SDK_IMPORT.test('const A = await import("@anthropic-ai/sdk");')).toBe(true);
    expect(VALUE_SDK_IMPORT.test('import type Anthropic from "@anthropic-ai/sdk";')).toBe(false);
    expect(VALUE_SDK_IMPORT.test('import type { X } from "@anthropic-ai/sdk/resources";')).toBe(false);
  });

  it("classify.ts goes through runStructured and has no client of its own", () => {
    const text = readFileSync(path.join(SRC, "lib", "documents", "classify.ts"), "utf8");
    expect(text).toContain("runStructured(");
    expect(text).toContain('kind: "document_classify"');
    expect(text).not.toMatch(/new Anthropic/);
  });
});
