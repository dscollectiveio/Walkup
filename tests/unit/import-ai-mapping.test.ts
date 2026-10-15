import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const runStructured = vi.fn();
vi.mock("@/lib/ai/structured", () => ({ runStructured: (...a: unknown[]) => runStructured(...a) }));

import { dropRedundant, verifySuggestion } from "@/lib/import/ai-verify";
import { AI_MAPPING_SYSTEM, buildAiMappingRequest, suggestMapping } from "@/lib/import/ai-mapping";
import { detectColumns } from "@/lib/import/columns";

const HEADERS = ["Unit", "Owner name", "ada@example.com", "SSN", "Cell", "Notes"];
const ROWS = [
  ["Unit 7", "Dee Park", "x", "123-45-6789", "312-555-0142", "owes $1,234.50 since March"],
  ["Unit 8", "Ada Okonkwo", "y", "987-65-4321", "312-555-0143", "pays late"],
];
const SECRETS = ["Dee Park", "Ada Okonkwo", "123-45-6789", "987-65-4321", "312-555-0142", "1,234.50", "owes", "Unit 7"];

describe("what is sent to the model", () => {
  it("contains headers and masks only: no name, email, phone, tax ID or amount from the fixture", () => {
    const { text, sent } = buildAiMappingRequest("units_owners", HEADERS, ROWS);
    for (const s of SECRETS) expect(text, s).not.toContain(s);
    expect(text).toContain("Owner name");
    expect(text).toContain("Cell");
    expect(text).toContain("Xxx Xxxx");
    expect(text).toContain("999-999-9999");
    expect(sent.masks[0]).toEqual(["Xxxx 9", "Xxx Xxxx", "(hidden)", "(hidden)", "999-999-9999", "xxxx $9,999.99 xxxxx Xxx..."]);
  });

  it("replaces a data-looking or sensitive header with a placeholder, and hides its masks", () => {
    const { sent, text } = buildAiMappingRequest("units_owners", HEADERS, ROWS);
    expect(sent.headers).toEqual(["Unit", "Owner name", "[column 3]", "[column 4]", "Cell", "Notes"]);
    expect(text).not.toContain("ada@example.com");
    expect(text).not.toContain("SSN");
    expect(sent.masks.every((r) => r[2] === "(hidden)" && r[3] === "(hidden)")).toBe(true);
  });

  it("sends at most five rows", () => {
    const many = Array.from({ length: 12 }, (_, i) => [`Unit ${i}`, "Name", "", "", "", ""]);
    expect(buildAiMappingRequest("units_owners", HEADERS, many).sent.masks).toHaveLength(5);
  });
});

describe("suggestMapping", () => {
  beforeEach(() => runStructured.mockReset());
  const base = { supabase: {} as never, associationId: "a", kind: "units_owners" as const, headers: HEADERS, sampleRows: ROWS };

  it("calls the document_classify kind with the exact system prompt and low effort, and sends no cell value", async () => {
    runStructured.mockResolvedValue({ ok: true, data: { mappings: [{ field: "unit_label", header: "Unit", confidence: "high" }] } });
    const r = await suggestMapping(base);
    expect(r).toMatchObject({ ok: true, suggestion: [{ field: "unit_label", header: "Unit", index: 0, confidence: "high" }] });
    const call = runStructured.mock.calls[0][0];
    expect(call).toMatchObject({ kind: "document_classify", system: AI_MAPPING_SYSTEM, effort: "low", maxTokens: 1500, timeoutMs: 30_000 });
    expect(AI_MAPPING_SYSTEM).toBe(
      "You match spreadsheet columns to fields. You are given the column names and, for a few rows, a mask of each cell where letters are x or X and digits are 9. You never see the real values. For each field, name the column that holds it, or null when no column fits. Use each column at most once. Reply only with the mapping.",
    );
    const prompt = JSON.stringify(call.content) + call.system;
    for (const s of SECRETS) expect(prompt, s).not.toContain(s);
  });

  it("passes the foundation's failures through: not configured and quota", async () => {
    runStructured.mockResolvedValue({ ok: false, code: "not_configured", reason: "AI help isn't available on this Walkup account, so this part is by hand.", configured: false, counted: false });
    expect(await suggestMapping(base)).toMatchObject({ ok: false, configured: false, code: "not_configured" });
    runStructured.mockResolvedValue({ ok: false, code: "quota", reason: "Limit", configured: true, quota: true, counted: false });
    expect(await suggestMapping(base)).toMatchObject({ ok: false, quota: true, code: "quota" });
  });
});

describe("verifySuggestion", () => {
  const out = (mappings: { field: string; header: string | null; confidence: "high" | "medium" | "low" }[]) => ({ mappings });

  it("drops a hallucinated header, an unknown field and a repeated field", () => {
    const s = verifySuggestion("units_owners", HEADERS, out([
      { field: "unit_label", header: "Unit Number", confidence: "high" },
      { field: "owner_name", header: "Owner name", confidence: "high" },
      { field: "balance", header: "Notes", confidence: "high" },
      { field: "phone", header: "Cell", confidence: "medium" },
      { field: "phone", header: "Notes", confidence: "high" },
      { field: "email", header: null, confidence: "low" },
    ]));
    expect(s).toEqual([
      { field: "owner_name", header: "Owner name", index: 1, confidence: "high" },
      { field: "phone", header: "Cell", index: 4, confidence: "medium" },
    ]);
  });

  it("keeps the higher confidence when a header is used twice", () => {
    const s = verifySuggestion("units_owners", HEADERS, out([
      { field: "mailing_address", header: "Notes", confidence: "low" },
      { field: "owner_name", header: "Notes", confidence: "high" },
    ]));
    expect(s).toEqual([{ field: "owner_name", header: "Notes", index: 5, confidence: "high" }]);
  });

  it("maps a [column N] placeholder back to its column, and drops sensitive columns", () => {
    const s = verifySuggestion("units_owners", HEADERS, out([
      { field: "email", header: "[column 3]", confidence: "high" },
      { field: "dues_amount", header: "[column 4]", confidence: "high" },
      { field: "phone", header: "[column 99]", confidence: "high" },
      { field: "mailing_address", header: "SSN", confidence: "high" },
    ]));
    expect(s).toEqual([{ field: "email", header: "ada@example.com", index: 2, confidence: "high" }]);
  });

  it("shows a suggestion for an already matched field only when it differs", () => {
    const d = detectColumns("units_owners", ["Unit", "Owner name", "Cell"], []);
    const s = verifySuggestion("units_owners", ["Unit", "Owner name", "Cell"], out([
      { field: "unit_label", header: "Unit", confidence: "high" },
      { field: "phone", header: "Cell", confidence: "high" },
      { field: "mailing_address", header: "Owner name", confidence: "low" },
    ]));
    const shown = dropRedundant(s, d.detected);
    // Unit and Cell were already matched by name with full confidence and the model agrees: not shown again.
    expect(shown.map((x) => x.field)).toEqual(["mailing_address"]);
  });
});
