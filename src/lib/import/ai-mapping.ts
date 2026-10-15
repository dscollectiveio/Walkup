import "server-only";
import { runStructured } from "@/lib/ai/structured";
import type { AiFailure } from "@/lib/ai/errors";
import type { Supabase } from "@/lib/ai/usage";
import { aiMappingSchema, verifySuggestion, type AiSuggestion } from "./ai-verify";
import { FIELDS, type ImportKind } from "./kinds";
import { headerForAi, maskRows } from "./shape";
import { isSensitiveHeader } from "./sensitive";

/**
 * Optional AI help with column matching (import-spec 5.3). Server-only.
 *
 * What is sent: the kind's field list (label and help), the column names (a
 * name that looks like data or like a tax ID or account number is replaced by
 * [column N]), and character masks of up to five sample rows. Never a value.
 * It runs as the existing document_classify kind (spec decision 1), so it is
 * metered, logged in ai_calls and limited like every other AI step.
 */

export const AI_MAPPING_SYSTEM =
  "You match spreadsheet columns to fields. You are given the column names and, for a few rows, a mask of each cell where letters are x or X and digits are 9. You never see the real values. For each field, name the column that holds it, or null when no column fits. Use each column at most once. Reply only with the mapping.";

export interface AiPreview {
  headers: string[];
  masks: string[][];
}

/** Exactly what would be sent, as text and as the structure shown to the person. */
export function buildAiMappingRequest(
  kind: ImportKind,
  headers: string[],
  sampleRows: string[][],
): { text: string; sent: AiPreview } {
  const sentHeaders = headers.map((h, i) => headerForAi(h, i));
  const hidden = headers.map((h, i) => sentHeaders[i] !== h || isSensitiveHeader(h));
  const masks = maskRows(sampleRows, 5).map((row) =>
    // A hidden column's cells are not even shaped.
    headers.map((_, i) => (hidden[i] ? "(hidden)" : (row[i] ?? ""))),
  );
  const fields = FIELDS[kind].map((f) => `- ${f.key}: ${f.label}${f.help ? `. ${f.help}` : ""}`).join("\n");
  const cols = sentHeaders.map((h, i) => `${i + 1}. ${h}`).join("\n");
  const maskLines = masks.map((r, i) => `Row ${i + 1}: ${r.join(" | ")}`).join("\n");
  const text = `Fields to find:\n${fields}\n\nColumns:\n${cols}\n\nMasked sample rows:\n${maskLines}`;
  return { text, sent: { headers: sentHeaders, masks } };
}

export async function suggestMapping(opts: {
  supabase: Supabase;
  associationId: string;
  kind: ImportKind;
  headers: string[];
  sampleRows: string[][];
}): Promise<{ ok: true; suggestion: AiSuggestion[]; sent: AiPreview } | AiFailure> {
  // The masks are computed here, from the real rows, and only the masks leave this function.
  const request = buildAiMappingRequest(opts.kind, opts.headers, opts.sampleRows);
  const r = await runStructured({
    kind: "document_classify",
    supabase: opts.supabase,
    associationId: opts.associationId,
    system: AI_MAPPING_SYSTEM,
    content: [{ type: "text", text: request.text }],
    schema: aiMappingSchema,
    effort: "low",
    maxTokens: 1500,
    timeoutMs: 30_000,
  });
  if (!r.ok) return r;
  return { ok: true, suggestion: verifySuggestion(opts.kind, opts.headers, r.data), sent: request.sent };
}
