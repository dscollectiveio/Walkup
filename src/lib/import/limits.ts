/** Caps for an import (import-spec decision 3). Pure. */
export const IMPORT_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  maxRows: 5000,
  maxColumns: 40,
  maxCellChars: 2000,
  maxOpenBatches: 5,
  stageChunk: 500,
  maxDistinctCategories: 200,
  staleAfterDays: 14,
} as const;
