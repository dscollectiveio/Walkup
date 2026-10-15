/**
 * Checking what the model said about column names (import-spec 5.3). Pure.
 *
 * The model is shown column names (some replaced by [column N]) and character
 * masks, and answers with field -> column name. Nothing it returns is trusted:
 * every field must exist for the kind, every column must be one of the file's
 * real columns, a column is used once, sensitive columns are dropped.
 */

import { z } from "zod";
import { FIELDS, type ImportKind } from "./kinds";
import { isSensitiveHeader } from "./sensitive";
import type { DetectedColumn } from "./columns";

export const aiMappingSchema = z.object({
  mappings: z
    .array(
      z.object({
        field: z.string(),
        header: z.string().nullable(),
        confidence: z.enum(["high", "medium", "low"]),
      }),
    )
    .max(20),
});

export type AiMappingOutput = z.infer<typeof aiMappingSchema>;
export type Confidence = "high" | "medium" | "low";

export interface AiSuggestion {
  field: string;
  header: string;
  index: number;
  confidence: Confidence;
}

const RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

export function verifySuggestion(kind: ImportKind, headers: string[], output: AiMappingOutput): AiSuggestion[] {
  const fieldKeys = new Set(FIELDS[kind].map((f) => f.key));
  const placeholder = /^\[column (\d+)\]$/;
  const picked = new Map<string, AiSuggestion>(); // by field
  const seenFields = new Set<string>();

  for (const m of output.mappings) {
    if (!fieldKeys.has(m.field) || seenFields.has(m.field)) continue;
    seenFields.add(m.field);
    if (m.header === null) continue;
    let index = -1;
    const ph = placeholder.exec(m.header);
    if (ph) {
      const n = Number(ph[1]) - 1;
      if (Number.isInteger(n) && n >= 0 && n < headers.length) index = n;
    } else {
      index = headers.findIndex((h) => h === m.header);
    }
    if (index < 0) continue; // a column that does not exist
    if (isSensitiveHeader(headers[index])) continue;
    picked.set(m.field, { field: m.field, header: headers[index], index, confidence: m.confidence });
  }

  // A column used by two fields keeps the higher confidence (the earlier field on a tie).
  const byColumn = new Map<number, AiSuggestion>();
  for (const s of picked.values()) {
    const current = byColumn.get(s.index);
    if (!current || RANK[s.confidence] > RANK[current.confidence]) byColumn.set(s.index, s);
  }
  const keep = new Set([...byColumn.values()].map((s) => s.field));
  return [...picked.values()].filter((s) => keep.has(s.field));
}

/** A suggestion for a field already matched by name with full confidence is shown only if it differs. */
export function dropRedundant(suggestion: AiSuggestion[], detected: DetectedColumn[]): AiSuggestion[] {
  return suggestion.filter((s) => {
    const d = detected.find((x) => x.field === s.field);
    return !(d && d.score >= 1 && d.index === s.index);
  });
}
