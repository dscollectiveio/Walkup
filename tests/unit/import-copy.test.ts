import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

vi.mock("server-only", () => ({}));

import { IMPORT_KINDS, KIND_LABEL, FIELDS } from "@/lib/import/kinds";
import { ERROR_HEADING, GENERIC_IMPORT_ERROR } from "@/lib/import/messages";
import { PARSE_MESSAGES } from "@/lib/import/parse-file";
import { READ_ME } from "@/lib/import/templates";
import { COMMA_DECIMAL_MESSAGE } from "@/lib/import/normalize";
import { AI_MAPPING_SYSTEM } from "@/lib/import/ai-mapping";

const ROOT = path.resolve(import.meta.dirname, "../..");
const EM_DASH = "—";

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("copy", () => {
  const sources = [...files(path.join(ROOT, "src/lib/import")), ...files(path.join(ROOT, "src/app/building/import"))];

  it("has no em dash anywhere in the wizard, its libraries or its messages", () => {
    const offenders = sources.filter((f) => readFileSync(f, "utf8").includes(EM_DASH));
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it("has no em dash in the templates, parse messages, headings, the AI prompt or the read-me text", () => {
    const text = [
      ...Object.values(READ_ME).flat(), ...Object.values(ERROR_HEADING), GENERIC_IMPORT_ERROR, COMMA_DECIMAL_MESSAGE, AI_MAPPING_SYSTEM,
      ...Object.values(PARSE_MESSAGES).map((m) => (typeof m === "function" ? m(5001) : m)),
      ...IMPORT_KINDS.flatMap((k) => [KIND_LABEL[k], ...FIELDS[k].flatMap((f) => [f.label, f.help])]),
    ].join("\n");
    expect(text).not.toContain(EM_DASH);
  });

  it("says contractor, never vendor, in anything a person reads", () => {
    const text = [
      ...Object.values(READ_ME).flat(), ...Object.values(ERROR_HEADING), GENERIC_IMPORT_ERROR,
      ...IMPORT_KINDS.flatMap((k) => [KIND_LABEL[k], ...FIELDS[k].flatMap((f) => [f.label, f.help])]),
    ].join("\n");
    expect(text).not.toMatch(/vendor/i);
    // JSX text and string props in the pages.
    const pages = sources.filter((f) => f.endsWith(".tsx") && f.includes("app/building/import"));
    for (const f of pages) {
      const visible = readFileSync(f, "utf8")
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line) && !/from\("vendors"\)|vendors?:|vendors\b.*=|\bvendor[A-Z_]|\.vendors|vendors\)/.test(line))
        .filter((line) => />[^<>{}]*\bvendors?\b[^<>{}]*</i.test(line) || /(label|title|hint|headline|detail|placeholder|aria-label)=["'][^"']*\bvendors?\b/i.test(line));
      expect(visible, path.relative(ROOT, f)).toEqual([]);
    }
  });

  it("never says best or you should buy, and ends the AI prompt with the instruction to reply only with the mapping", () => {
    expect(AI_MAPPING_SYSTEM.endsWith("Reply only with the mapping.")).toBe(true);
    const visible = sources.map((f) => readFileSync(f, "utf8")).join("\n");
    expect(visible).not.toMatch(/you should buy|we recommend you buy/i);
  });
});
